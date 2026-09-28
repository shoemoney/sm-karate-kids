#!/usr/bin/env python3
"""Sprite-atlas authoring pipeline for the karate fighters.

Reads the six-frame contact sheets under `assets/<move_id>/{white,red}-sheet.png`
(plus the single-pose `assets/guard/{white,red}.png` idle art), segments each sheet
into individual frames from the alpha channel guided by each sheet's own
`animation.json` grid, re-anchors every frame onto a shared foot-baseline and a
shared body scale, packs the results into WebP atlas pages, and writes
`apps/game/public/fighters/manifest.json` plus provenance records.

See docs/sprite-pipeline.md for the full write-up of the approach.

Usage:
    python3 tools/build-fighter-atlas.py [--source DIR] [--out DIR] [--dry-run]
"""

from __future__ import annotations

import argparse
import io
import json
import statistics
import sys
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SOURCE = REPO_ROOT / "assets"
DEFAULT_OUT = REPO_ROOT / "apps/game/public/fighters"
PROVENANCE_PATH = REPO_ROOT / "apps/game/public/brand/PROVENANCE.json"

# Canonical 20-move grammar, in packages/sim/src/grammar.ts allMoveIds() order.
# Keep this in sync with grammar.ts by hand -- it is a small, stable, hand-authored
# table there, not something worth importing a TS runtime for.
CANONICAL_MOVES = [
    "lunge_punch", "jumping_punch", "crouching_punch", "stepping_lunge_punch", "back_fist",
    "reverse_punch", "somersault_kick", "crouching_reverse_punch", "back_kick", "spinning_back_kick",
    "front_kick", "jumping_front_kick", "rising_knee", "roundhouse_kick", "high_block",
    "foot_sweep", "jumping_sweep_kick", "low_sweep", "leg_sweep", "low_block",
]

FIGHTERS = {"shiro": "white", "aka": "red"}
MIRROR = {"shiro": False, "aka": True}  # red source art faces left; mirror it to face right.
FACING = "right"

ALPHA_THRESH = 16
ROW_OCC_MIN_PIXELS = 3
ROW_GAP_TOLERANCE = 3
DEFAULT_GRID_COLS, DEFAULT_GRID_ROWS = 2, 3  # used only if a sheet has no animation.json
FRAMES_PER_MOVE = 6
LOWER_BODY_FRACTION = 0.55  # bottom fraction of a frame's own bbox used for the horizontal anchor

# A sheet meant to hold ONE fighter's solo technique but that was actually
# generated as a two-person sparring shot shows a large blob of the OTHER
# fighter's gi colour. These thresholds were picked empirically against every
# sheet on hand on 2026-09-27 (see docs/sprite-pipeline.md): skin/hair tone
# false-positives sit far below them, genuine contamination sits far above.
WHITE_SHEET_CONTAM_THRESH = 0.30  # fraction of opaque px that read "reddish"
RED_SHEET_CONTAM_THRESH = 0.05    # fraction of opaque px that read "whitish"

CROP_PAD = 4          # native-resolution px padding kept around each tight bbox
CELL_PAD = 8          # output px padding kept around the measured extents
STANDING_TARGET_PX = 260  # desired output height (px) of the guard/idle standing pose
# Measured 2026-09-27 on the full atlas: method 6 alone cuts ~16% at the same
# quality, and 62 is indistinguishable from 82 at phone scale. 3.2MB -> ~2.1MB.
WEBP_QUALITY = 62
WEBP_METHOD = 6
WEBP_ALPHA_QUALITY = 80
PAGE_BUDGET_BYTES = 480 * 1024
ATLAS_COLS = 11


def log(msg: str) -> None:
    print(msg, file=sys.stderr)


# ---------------------------------------------------------------------------
# Contamination check
# ---------------------------------------------------------------------------

def color_fraction_check(im: Image.Image, expect_color: str) -> float:
    """Fraction of opaque pixels that look like the OTHER fighter's gi colour."""
    rgb = np.asarray(im.convert("RGB")).astype(np.int16)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    alpha = np.asarray(im.getchannel("A")) > ALPHA_THRESH
    if expect_color == "white":
        opposite = (r - g > 45) & (r - b > 30)  # reddish
    else:
        opposite = (np.abs(r - g) < 18) & (np.abs(g - b) < 18) & (r > 140)  # whitish
    opp_and_alpha = opposite & alpha
    total = int(alpha.sum())
    return float(opp_and_alpha.sum()) / total if total else 0.0


def is_contaminated(sheet_path: Path, color: str) -> tuple[bool, float]:
    with Image.open(sheet_path) as im:
        im = im.convert("RGBA")
        frac = color_fraction_check(im, color)
    thresh = WHITE_SHEET_CONTAM_THRESH if color == "white" else RED_SHEET_CONTAM_THRESH
    return frac > thresh, frac


# ---------------------------------------------------------------------------
# Segmentation
# ---------------------------------------------------------------------------

def alpha_mask(im: Image.Image) -> np.ndarray:
    return np.asarray(im.getchannel("A")) > ALPHA_THRESH


def contiguous_bands(occ: np.ndarray, gap_tol: int) -> list[list[int]]:
    bands: list[list[int]] = []
    start = None
    last_on = None
    gap = 0
    for y, on in enumerate(occ):
        if on:
            if start is None:
                start = y
            last_on = y
            gap = 0
        elif start is not None:
            gap += 1
            if gap > gap_tol:
                bands.append([start, last_on])
                start = None
    if start is not None:
        bands.append([start, last_on])
    return [b for b in bands if b[1] > b[0]]


def deepest_minimum(profile: np.ndarray, lo: int, hi: int) -> tuple[int, float]:
    if hi <= lo:
        idx = (lo + hi) // 2
        return idx, 0.0
    seg = profile[lo:hi]
    idx = int(np.argmin(seg)) + lo
    peak = max(float(profile[lo:hi].max()), 1.0)
    confidence = 1.0 - float(profile[idx]) / peak
    return idx, confidence


def split_band_into_n(profile: np.ndarray, y0: int, y1: int, n: int) -> tuple[list[tuple[int, int]], list[float]]:
    if n == 1:
        return [(y0, y1)], [1.0]
    height = y1 - y0 + 1
    nominal = height / n
    splits: list[int] = []
    split_confidences: list[float] = []
    for k in range(1, n):
        center = y0 + round(nominal * k)
        window = max(8, int(nominal * 0.3))
        lo = max(y0 + 1, center - window)
        hi = min(y1, center + window)
        idx, conf = deepest_minimum(profile, lo, hi)
        splits.append(idx)
        split_confidences.append(conf)
    bounds = [y0] + splits + [y1]
    bands = [(bounds[i], bounds[i + 1]) for i in range(n)]
    band_confidences: list[float] = []
    for i in range(n):
        if n == 1:
            band_confidences.append(1.0)
        elif i == 0:
            band_confidences.append(split_confidences[0])
        elif i == n - 1:
            band_confidences.append(split_confidences[-1])
        else:
            band_confidences.append(min(split_confidences[i - 1], split_confidences[i]))
    return bands, band_confidences


def find_row_bands(mask: np.ndarray, expect: int) -> tuple[list[tuple[int, int]], list[float], bool]:
    height = mask.shape[0]
    row_profile = mask.sum(axis=1)
    occ = row_profile > ROW_OCC_MIN_PIXELS
    raw_bands = contiguous_bands(occ, ROW_GAP_TOLERANCE)
    total_mass = max(int(row_profile.sum()), 1)
    raw_bands = [b for b in raw_bands if row_profile[b[0]:b[1] + 1].sum() > 0.01 * total_mass]

    nominal_h = height / expect
    fallback = False
    final_bands: list[tuple[int, int]] = []
    confidences: list[float] = []

    if len(raw_bands) == expect:
        final_bands = [(b[0], b[1]) for b in raw_bands]
        confidences = [1.0] * expect
    else:
        counts = [max(1, round((b[1] - b[0] + 1) / nominal_h)) for b in raw_bands]
        if raw_bands and sum(counts) == expect:
            for b, c in zip(raw_bands, counts):
                if c == 1:
                    final_bands.append((b[0], b[1]))
                    confidences.append(1.0)
                else:
                    subbands, subconf = split_band_into_n(row_profile, b[0], b[1], c)
                    final_bands.extend(subbands)
                    confidences.extend(subconf)
        else:
            fallback = True

    if fallback or len(final_bands) != expect:
        final_bands = [(round(height * i / expect), round(height * (i + 1) / expect) - 1) for i in range(expect)]
        confidences = [0.0] * expect
        fallback = True

    return final_bands, confidences, fallback


def split_columns_into_n(mask: np.ndarray, y0: int, y1: int, width: int, n: int) -> tuple[list[tuple[int, int]], list[float]]:
    """Deepest-minima column split, generalised to an arbitrary column count
    (some sheets pack 3x2 instead of the usual 2x3 -- see animation.json)."""
    band = mask[y0:y1 + 1, :]
    colsum = band.sum(axis=0)
    return split_band_into_n(colsum, 0, width - 1, n)


def tight_bbox(mask: np.ndarray, x0: int, y0: int, x1: int, y1: int) -> tuple[int, int, int, int] | None:
    sub = mask[y0:y1 + 1, x0:x1 + 1]
    ys, xs = np.where(sub)
    if len(xs) == 0:
        return None
    return (x0 + int(xs.min()), y0 + int(ys.min()), x0 + int(xs.max()), y0 + int(ys.max()))


@dataclass
class FrameData:
    """A single extracted, already-mirrored-if-needed frame, expressed entirely
    in coordinates relative to its OWN source cell (never absolute sheet
    coordinates -- different cells of a grid sheet live at wildly different
    absolute positions, so mixing the two silently breaks cross-frame
    alignment)."""
    local: Image.Image          # RGBA image, same size as the source cell, mirrored if needed
    bbox: tuple[float, float, float, float]   # (left, top, right, bottom), cell-relative
    anchor_x: float              # lower-body horizontal anchor, cell-relative
    confidence: float
    contaminated: bool = False


def lower_body_centroid_x(mask: np.ndarray, x0: int, y0: int, x1: int, y1: int,
                           bbox_abs: tuple[int, int, int, int]) -> float:
    left, top, right, bottom = bbox_abs
    cut = top + round((bottom - top) * (1 - LOWER_BODY_FRACTION))
    sub = mask[cut:bottom + 1, x0:x1 + 1]
    ys, xs = np.where(sub)
    if len(xs) == 0:
        return (left + right) / 2.0
    return float(x0 + xs.mean())


def build_local_frame(im: Image.Image, mask: np.ndarray, x0: int, y0: int, x1: int, y1: int,
                       mirror: bool) -> FrameData | None:
    bbox_abs = tight_bbox(mask, x0, y0, x1, y1)
    if bbox_abs is None:
        return None
    left, top, right, bottom = bbox_abs
    pl = max(x0, left - CROP_PAD)
    pt = max(y0, top - CROP_PAD)
    pr = min(x1, right + CROP_PAD)
    pb = min(y1, bottom + CROP_PAD)
    crop = im.crop((pl, pt, pr + 1, pb + 1))

    cell_w = x1 - x0
    cell_h = y1 - y0
    local = Image.new("RGBA", (cell_w + 1, cell_h + 1), (0, 0, 0, 0))
    local.alpha_composite(crop, (pl - x0, pt - y0))

    anchor_abs = lower_body_centroid_x(mask, x0, y0, x1, y1, bbox_abs)

    rel_left, rel_top, rel_right, rel_bottom = left - x0, top - y0, right - x0, bottom - y0
    rel_anchor = anchor_abs - x0

    if mirror:
        local = local.transpose(Image.FLIP_LEFT_RIGHT)
        width = cell_w
        rel_left, rel_right = width - rel_right, width - rel_left
        rel_anchor = width - rel_anchor

    return FrameData(local, (rel_left, rel_top, rel_right, rel_bottom), rel_anchor, 1.0)


def read_animation_grid(move_dir: Path, color: str, report: dict) -> tuple[int, int, str]:
    """Reads (columns, rows, facing) for this fighter's sheet from animation.json,
    falling back to the historical 2x3 layout (and a colour-based facing guess)
    when the file is missing."""
    anim_path = move_dir / "animation.json"
    if not anim_path.exists():
        report.setdefault("missing_animation_json", []).append(str(anim_path))
        return DEFAULT_GRID_COLS, DEFAULT_GRID_ROWS, ("left" if color == "red" else "right")
    data = json.loads(anim_path.read_text())
    fighter = data.get("fighters", {}).get(color, {})
    grid = fighter.get("grid", {})
    cols = int(grid.get("columns", DEFAULT_GRID_COLS))
    rows = int(grid.get("rows", DEFAULT_GRID_ROWS))
    facing = fighter.get("facing", "left" if color == "red" else "right")
    return cols, rows, facing


def extract_move_frames(sheet_path: Path, mirror: bool, grid_cols: int, grid_rows: int,
                         report: dict) -> list[FrameData] | None:
    with Image.open(sheet_path) as im:
        im = im.convert("RGBA")
        mask = alpha_mask(im)
        height, width = mask.shape

        row_bands, row_conf, row_fallback = find_row_bands(mask, grid_rows)
        if row_fallback:
            report.setdefault("row_fallback", []).append(str(sheet_path))

        frames: list[FrameData] = []
        for band_idx, (y0, y1) in enumerate(row_bands):
            columns, col_confs = split_columns_into_n(mask, y0, y1, width, grid_cols)
            for col_idx_check, conf in enumerate(col_confs):
                if conf < 0.15:
                    report.setdefault("low_col_confidence", []).append(
                        f"{sheet_path} row{band_idx} col{col_idx_check} conf={conf:.2f}")
            for col_idx, (x0, x1) in enumerate(columns):
                frame = build_local_frame(im, mask, x0, y0, x1, y1, mirror)
                if frame is None:
                    report.setdefault("empty_frames", []).append(f"{sheet_path} r{band_idx}c{col_idx}")
                    blank = Image.new("RGBA", (max(1, x1 - x0), max(1, y1 - y0)), (0, 0, 0, 0))
                    frame = FrameData(blank, (0, 0, 1, 1), 0.5, 0.0)
                else:
                    frame.confidence = min(row_conf[band_idx], col_confs[col_idx])
                frames.append(frame)
        return frames


def extract_guard_frame(guard_path: Path, mirror: bool) -> FrameData:
    with Image.open(guard_path) as im:
        im = im.convert("RGBA")
        mask = alpha_mask(im)
        height, width = mask.shape
        frame = build_local_frame(im, mask, 0, 0, width - 1, height - 1, mirror)
        if frame is None:
            raise ValueError(f"{guard_path}: no opaque pixels found")
        return frame


# ---------------------------------------------------------------------------
# Alignment
# ---------------------------------------------------------------------------

@dataclass
class PoseFrames:
    move_id: str
    frames: list[FrameData]


def move_shift(frames: list[FrameData], scale: float) -> tuple[float, float]:
    """Median-based shift so this pose's typical foot row / body anchor line up
    with the shared baseline & centre, while preserving each frame's own motion
    relative to that median (so a real jump arc is not flattened away)."""
    feet = [f.bbox[3] * scale for f in frames]
    anchors = [f.anchor_x * scale for f in frames]
    return statistics.median(feet), statistics.median(anchors)


def relative_extents(frames: list[FrameData], scale: float, median_foot: float, median_anchor: float):
    rel = []
    for f in frames:
        left, top, right, bottom = f.bbox
        # Measured against this frame's own feet, matching how it is rendered.
        rel.append({
            "top": top * scale - bottom * scale,
            "bottom": 0.0,
            "left": left * scale - median_anchor,
            "right": right * scale - median_anchor,
        })
    return rel


# ---------------------------------------------------------------------------
# Main pipeline
# ---------------------------------------------------------------------------

def discover_moves(source: Path, report: dict) -> tuple[list[str], list[str]]:
    """Returns (canonical_move_ids, extra_move_ids). Extra ids are folders with a
    complete pair of sheets that aren't part of the grammar's 20 moves (e.g.
    high_kick) -- packed as bonus poses, called out separately in the report."""
    present = []
    for move_id in CANONICAL_MOVES:
        move_dir = source / move_id
        white = move_dir / "white-sheet.png"
        red = move_dir / "red-sheet.png"
        if white.exists() and red.exists():
            present.append(move_id)
        elif white.exists() or red.exists():
            report.setdefault("partial_moves", []).append(move_id)
        else:
            report.setdefault("missing_moves", []).append(move_id)

    extra = []
    for child in sorted(source.iterdir()):
        if not child.is_dir() or child.name in CANONICAL_MOVES or child.name == "guard":
            continue
        white = child / "white-sheet.png"
        red = child / "red-sheet.png"
        if white.exists() and red.exists():
            extra.append(child.name)
            report.setdefault("extra_non_grammar_moves", []).append(child.name)
        else:
            report.setdefault("ignored_dirs", []).append(child.name)
    return present, extra


def build_pose_library(source: Path, move_ids: list[str], report: dict):
    """Returns ({fighter_key: {"idle": PoseFrames, move_id: PoseFrames, ...}}, fps_by_move).
    A (fighter, move) whose sheet is a two-person sparring shot instead of a solo
    contact sheet is dropped for that fighter and reported, not silently packed."""
    library: dict[str, dict[str, PoseFrames]] = {k: {} for k in FIGHTERS}
    fps_by_move: dict[str, int] = {}

    for fighter_key, color in FIGHTERS.items():
        mirror = MIRROR[fighter_key]
        guard_path = source / "guard" / f"{color}.png"
        if not guard_path.exists():
            raise FileNotFoundError(f"missing required idle art: {guard_path}")
        idle_frame = extract_guard_frame(guard_path, mirror)
        library[fighter_key]["idle"] = PoseFrames("idle", [idle_frame])

    for move_id in move_ids:
        move_dir = source / move_id
        anim_path = move_dir / "animation.json"
        if anim_path.exists():
            fps_by_move[move_id] = int(json.loads(anim_path.read_text()).get("fps", 12))
        for fighter_key, color in FIGHTERS.items():
            mirror = MIRROR[fighter_key]
            sheet_path = move_dir / f"{color}-sheet.png"
            contaminated, frac = is_contaminated(sheet_path, color)
            if contaminated:
                report.setdefault("contaminated_sheets", []).append(
                    f"{sheet_path} ({color} sheet is {frac:.0%} the other fighter's gi colour -- "
                    f"looks like a two-person sparring shot, not a solo sheet)")
                continue
            grid_cols, grid_rows, facing = read_animation_grid(move_dir, color, report)
            expected_facing = "left" if color == "red" else "right"
            if facing != expected_facing:
                report.setdefault("unexpected_facing", []).append(
                    f"{sheet_path}: animation.json says facing={facing}, expected {expected_facing}")
            frames = extract_move_frames(sheet_path, mirror, grid_cols, grid_rows, report)
            if frames is None or len(frames) != FRAMES_PER_MOVE:
                report.setdefault("segmentation_failed", []).append(str(sheet_path))
                continue
            library[fighter_key][move_id] = PoseFrames(move_id, frames)

    return library, fps_by_move


def compute_pose_scales(library) -> dict[str, dict[str, float]]:
    """One scale factor per (fighter, pose), not one shared global scale.

    Each source sheet -- and the guard/idle hero shot -- was generated at its
    OWN zoom level (the guard portrait is framed far tighter than a 6-frame
    action sheet, ~3x tighter in practice), so a single global scale makes the
    idle pose balloon to 3x the size of every technique. Instead, each pose's
    scale is picked so that pose's own tallest frame (its closest approach to
    a normal standing height) renders at STANDING_TARGET_PX, which normalises
    apparent character size across moves while preserving the relative height
    differences *within* one move's 6 frames (a crouch still reads shorter
    than its own sheet's tallest frame)."""
    scales: dict[str, dict[str, float]] = {k: {} for k in FIGHTERS}
    for fighter_key in FIGHTERS:
        for pose_id, pose in library[fighter_key].items():
            tallest = max(f.bbox[3] - f.bbox[1] for f in pose.frames)
            scales[fighter_key][pose_id] = STANDING_TARGET_PX / tallest
    return scales


def measure_cell_extents(library, scales: dict[str, dict[str, float]]):
    """Returns (cell_w, cell_h, baseline_y, center_x, per_pose_shift) with zero
    clipping, given each pose's own scale factor."""
    max_above = 0.0
    max_below = 0.0
    max_left = 0.0
    max_right = 0.0
    shifts: dict[str, dict[str, tuple[float, float]]] = {k: {} for k in FIGHTERS}

    for fighter_key in FIGHTERS:
        for pose_id, pose in library[fighter_key].items():
            scale = scales[fighter_key][pose_id]
            median_foot, median_anchor = move_shift(pose.frames, scale)
            shifts[fighter_key][pose_id] = (median_foot, median_anchor)
            for rel in relative_extents(pose.frames, scale, median_foot, median_anchor):
                max_above = max(max_above, -rel["top"])
                max_below = max(max_below, rel["bottom"])
                max_left = max(max_left, -rel["left"])
                max_right = max(max_right, rel["right"])

    half_width = max(max_left, max_right)
    cell_w = int(np.ceil(2 * half_width + 2 * CELL_PAD))
    cell_h = int(np.ceil(max_above + max_below + 2 * CELL_PAD))
    baseline_y = int(np.ceil(max_above + CELL_PAD))
    center_x = cell_w / 2.0
    cell_w += cell_w % 2
    cell_h += cell_h % 2
    return cell_w, cell_h, baseline_y, center_x, shifts


def render_frame(frame: FrameData, scale: float, shift_y: float, shift_x: float,
                  center_x: float, baseline_y: float, cell_w: int, cell_h: int) -> Image.Image:
    new_w = max(1, round(frame.local.width * scale))
    new_h = max(1, round(frame.local.height * scale))
    resized = frame.local.resize((new_w, new_h), Image.LANCZOS)

    # frame.local's own (0, 0) IS the cell-relative origin, so scaling it and
    # placing that origin at (center_x - shift_x, baseline_y - shift_y) lines
    # every frame's own coordinate system up with the shared output frame.
    target_left = center_x - shift_x
    target_top = baseline_y - shift_y

    canvas = Image.new("RGBA", (cell_w, cell_h), (0, 0, 0, 0))
    canvas.alpha_composite(resized, (round(target_left), round(target_top)))
    return canvas


def reach_curve(pose: PoseFrames, scale: float, median_anchor: float) -> list[float]:
    """Per-frame horizontal reach from the pose's own body anchor -- how far the
    furthest edge of the frame's bbox sits from the stationary torso/hip line."""
    curve = []
    for f in pose.frames:
        left, _, right, _ = f.bbox
        curve.append(max(right * scale - median_anchor, median_anchor - left * scale))
    return curve


def pack_pages(cell_images: list[Image.Image], cols: int, cell_w: int, cell_h: int, rows_per_page: int):
    capacity = cols * rows_per_page
    pages = []
    for start in range(0, len(cell_images), capacity):
        chunk = cell_images[start:start + capacity]
        page = Image.new("RGBA", (cols * cell_w, rows_per_page * cell_h), (0, 0, 0, 0))
        for i, img in enumerate(chunk):
            c = i % cols
            r = i // cols
            page.paste(img, (c * cell_w, r * cell_h))
        pages.append(page)
    return pages


def encode_webp(im: Image.Image) -> bytes:
    buf = io.BytesIO()
    im.save(buf, format="WEBP", quality=WEBP_QUALITY, method=WEBP_METHOD, alpha_quality=WEBP_ALPHA_QUALITY)
    return buf.getvalue()


def find_rows_per_page(cell_images: list[Image.Image], cols: int, cell_w: int, cell_h: int) -> tuple[int, list[bytes]]:
    max_rows = int(np.ceil(len(cell_images) / cols))
    for rows_per_page in range(max_rows, 0, -1):
        pages = pack_pages(cell_images, cols, cell_w, cell_h, rows_per_page)
        encoded = [encode_webp(p) for p in pages]
        if all(len(b) < PAGE_BUDGET_BYTES for b in encoded):
            return rows_per_page, encoded
    raise RuntimeError("could not fit even a single row per page under the byte budget")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    report: dict = {}
    move_ids, extra_move_ids = discover_moves(args.source, report)
    log(f"Discovered {len(move_ids)}/{len(CANONICAL_MOVES)} canonical moves with both sheets.")
    if report.get("missing_moves"):
        log(f"  missing (skipped, will pick up later): {report['missing_moves']}")
    if report.get("partial_moves"):
        log(f"  partial (only one fighter's sheet found, skipped): {report['partial_moves']}")
    if extra_move_ids:
        log(f"  extra non-grammar poses packed anyway: {extra_move_ids}")
    if report.get("ignored_dirs"):
        log(f"  ignored dirs (incomplete, not part of the grammar): {report['ignored_dirs']}")

    all_move_ids = move_ids + extra_move_ids
    library, fps_by_move = build_pose_library(args.source, all_move_ids, report)
    if report.get("contaminated_sheets"):
        log("Two-person sparring shots found where a solo sheet was expected (that fighter falls "
            "back to idle for this pose):")
        for s in report["contaminated_sheets"]:
            log(f"  - {s}")
    if report.get("unexpected_facing"):
        log("Sheets whose animation.json facing didn't match the white=right/red=left assumption:")
        for s in report["unexpected_facing"]:
            log(f"  - {s}")

    # Drop any pose neither fighter ended up with usable art for.
    produced_move_ids = [
        m for m in all_move_ids
        if m in library["shiro"] or m in library["aka"]
    ]
    dropped = sorted(set(all_move_ids) - set(produced_move_ids))
    if dropped:
        log(f"Dropping pose(s) with no clean source for EITHER fighter: {dropped}")
        report["dropped_poses"] = dropped

    library_idle_only = {
        m for m in produced_move_ids
        if (m not in library["shiro"]) != (m not in library["aka"])
    }
    if library_idle_only:
        log(f"Pose(s) clean for only one fighter (other fighter shows idle): {sorted(library_idle_only)}")

    scales = compute_pose_scales(library)
    cell_w, cell_h, baseline_y, center_x, shifts = measure_cell_extents(library, scales)
    log(f"Standing-pose target height: {STANDING_TARGET_PX}px output "
        f"({100 * STANDING_TARGET_PX / cell_h:.0f}% of cell height)")
    log(f"Cell size: {cell_w}x{cell_h}, baseline row {baseline_y}, center col {center_x:.0f}")

    metres_per_cell = round(1.7 * (cell_h / STANDING_TARGET_PX), 4)

    manifest = {
        "version": 1,
        "cell": {"w": cell_w, "h": cell_h},
        "baseline": baseline_y,
        "metresPerCell": metres_per_cell,
        "facing": FACING,
        "fighters": {},
        "poses": {},
    }

    pose_order = ["idle"] + produced_move_ids
    global_frames: dict[str, list[Image.Image]] = {k: [] for k in FIGHTERS}
    pose_defs: dict[str, dict] = {}
    frame_cursor = 0

    for pose_id in pose_order:
        n_frames = 1 if pose_id == "idle" else FRAMES_PER_MOVE
        frame_indices = list(range(frame_cursor, frame_cursor + n_frames))
        frame_cursor += n_frames
        combined_reach = [0.0] * n_frames
        for fighter_key in FIGHTERS:
            pose = library[fighter_key].get(pose_id)
            if pose is None:
                # No clean source for this fighter's version of this pose: hold
                # on the idle frame rather than showing a blank/garbage cell.
                # (Excluded from the contact vote below -- a repeated idle frame
                # has no real reach signal to contribute.)
                idle_pose = library[fighter_key]["idle"]
                idle_scale = scales[fighter_key]["idle"]
                idle_shift = shifts[fighter_key]["idle"]
                for _ in range(n_frames):
                    img = render_frame(idle_pose.frames[0], idle_scale, idle_pose.frames[0].bbox[3] * idle_scale, idle_shift[1],
                                        center_x, baseline_y, cell_w, cell_h)
                    global_frames[fighter_key].append(img)
                continue
            scale = scales[fighter_key][pose_id]
            median_foot, median_anchor = shifts[fighter_key][pose_id]
            for f in pose.frames:
                # Every frame stands on the floor on its own. A pose-level
                # median shift kept frame-to-frame drift from the generator as
                # if it were motion, and lifted whole grid rows whenever the
                # segmenter measured a row from the figure instead of the cell.
                # Real altitude comes from the simulation (heightOf), so art
                # that also "jumps" would count the lift twice.
                img = render_frame(f, scale, f.bbox[3] * scale, median_anchor, center_x, baseline_y, cell_w, cell_h)
                global_frames[fighter_key].append(img)
            if pose_id != "idle":
                # Both fighters perform the same choreographed technique, so
                # their reach curves should agree; summing (rather than letting
                # whichever fighter is processed last silently win) picks the
                # frame that is jointly furthest extended for BOTH fighters.
                for i, r in enumerate(reach_curve(pose, scale, median_anchor)):
                    combined_reach[i] += r
        contact = int(np.argmax(combined_reach)) if pose_id != "idle" else 0
        # Gedan barai finishes downward. Its return can project farther sideways,
        # so horizontal reach alone can select the wrong scoring frame.
        if pose_id == "low_block":
            contact = 3
        pose_def = {"frames": frame_indices, "contact": contact}
        if pose_id in fps_by_move:
            pose_def["fps"] = fps_by_move[pose_id]
        pose_defs[pose_id] = pose_def

    manifest["poses"] = pose_defs

    provenance_updates: dict[str, dict] = {}
    total_bytes = 0
    for fighter_key in FIGHTERS:
        cells = global_frames[fighter_key]
        rows_per_page, encoded_pages = find_rows_per_page(cells, ATLAS_COLS, cell_w, cell_h)
        pages_names = [f"{fighter_key}-{i}.webp" for i in range(len(encoded_pages))]
        manifest["fighters"][fighter_key] = {
            "pages": pages_names,
            "cols": ATLAS_COLS,
            "rows": rows_per_page,
        }
        for name, data in zip(pages_names, encoded_pages):
            total_bytes += len(data)
            log(f"  {fighter_key}: {name} = {len(data)} bytes ({len(data)/1024:.1f} KB)")
            if not args.dry_run:
                (args.out / name).write_bytes(data)
            provenance_updates[f"fighters/{name}"] = {
                "source": (
                    "Packed by tools/build-fighter-atlas.py from Jeremy Schoemaker's own "
                    "karateka artwork, which carries the ShoeMoney emblem"
                ),
                "license": "Proprietary artwork of Jeremy Schoemaker. NOT covered by this repository's MIT grant.",
                "holder": "Jeremy Schoemaker",
                "approved": True,
                "notes": f"Sprite atlas page for the {fighter_key} fighter. See docs/sprite-pipeline.md.",
            }

    manifest_bytes = json.dumps(manifest, indent=2).encode("utf-8") + b"\n"
    log(f"manifest.json = {len(manifest_bytes)} bytes")
    if not args.dry_run:
        (args.out / "manifest.json").write_bytes(manifest_bytes)
    provenance_updates["fighters/manifest.json"] = {
        "source": "Generated by tools/build-fighter-atlas.py from the sprite atlas it just built",
        "license": "Proprietary, describes Jeremy Schoemaker's artwork. NOT covered by this repository's MIT grant.",
        "holder": "Jeremy Schoemaker",
        "approved": True,
        "notes": "Frame/pose index for apps/game/public/fighters/*.webp.",
    }

    # A rebuild that needs fewer pages than the last one must remove the rest.
    # Left in place, stale pages still ship in the bundle and keep their
    # provenance entries, so nothing flags them.
    current_pages = {name for m in manifest["fighters"].values() for name in m["pages"]}
    stale_pages = sorted(
        f.name for f in args.out.glob("*.webp") if f.name not in current_pages
    ) if args.out.exists() else []
    if stale_pages:
        log(f"Removing {len(stale_pages)} stale page(s) from a previous build: {stale_pages}")

    if not args.dry_run:
        for name in stale_pages:
            (args.out / name).unlink()
        existing = json.loads(PROVENANCE_PATH.read_text()) if PROVENANCE_PATH.exists() else {}
        for key in [k for k in existing if k.startswith("fighters/") and k.endswith(".webp")]:
            if key.removeprefix("fighters/") not in current_pages:
                del existing[key]
        existing.update(provenance_updates)
        PROVENANCE_PATH.write_text(json.dumps(existing, indent=2) + "\n")

    log("")
    log(f"Total atlas bytes: {total_bytes} ({total_bytes/1024:.1f} KB) across "
        f"{sum(len(m['pages']) for m in manifest['fighters'].values())} page(s)")
    if report.get("row_fallback"):
        log(f"Row-segmentation fallback used for {len(report['row_fallback'])} sheet(s):")
        for s in report["row_fallback"]:
            log(f"  - {s}")
    if report.get("low_col_confidence"):
        log(f"Low column-split confidence on {len(report['low_col_confidence'])} band(s):")
        for s in report["low_col_confidence"]:
            log(f"  - {s}")
    if report.get("empty_frames"):
        log(f"Empty frames encountered: {report['empty_frames']}")
    if report.get("missing_animation_json"):
        log(f"Sheets with no animation.json (used {DEFAULT_GRID_COLS}x{DEFAULT_GRID_ROWS} fallback grid): "
            f"{report['missing_animation_json']}")
    log("")
    log(f"Canonical grammar poses produced: {len(set(produced_move_ids) & set(CANONICAL_MOVES))}/{len(CANONICAL_MOVES)}")
    log(f"Extra non-grammar poses produced (harmless, unused by the grammar): {extra_move_ids or 'none'}")
    if dropped:
        log(f"Poses dropped entirely (no clean source for either fighter): {dropped}")

    if args.dry_run:
        log("")
        log("DRY RUN: nothing written.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
