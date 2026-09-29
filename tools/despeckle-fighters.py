#!/usr/bin/env python3
"""Erase detached fragments from the fighter atlases.

The segmented sheets leave small islands of keyed artwork floating beside the
fighter: most often the back hand, drawn as its own component because the
keyer separated it from the sleeve. In several frames the figure already has
both fists up in guard, so the island is a *duplicate* of a hand that is
present — which is why it reads to a viewer as a severed limb in mid-air.

Five vision reviewers across four rounds reported it and none of them could
name it. grok-4.7 called it "the bare foot draws out the far side of his
torso", fugu-max a "severed foot sprite", qwen3.8-max-0902 a "floating limb
fragment", claude-opus-5.5 a "detached fist floating behind Asmongold",
seed-2.0-lite a "detached floating hand". The names they reached for are all
body parts, because that is what a fragment of a hand looks like when it is not
attached to anything.

Round 22 of the review loop refuted this on the *back* kick, correctly, and a
correct refutation of one frame was allowed to dismiss a finding about
fourteen.

The rule is deliberately blunt: within each cell of each page, keep the largest
connected component of opaque pixels and erase every other one. The bodies run
14000-26000px; the largest fragment is 550px, so a single "keep the biggest"
rule separates them with a factor of 25 to spare and needs no per-frame tuning.

Run it after build-fighter-atlas.py, before the asset gates.

    python3 tools/despeckle-fighters.py [--check]

--check reports what it would erase and changes nothing, and exits non-zero if
there is anything to do — so it doubles as the regression test.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import sys

import numpy as np
from PIL import Image

try:
    from scipy import ndimage
except ImportError:  # pragma: no cover
    sys.exit("despeckle-fighters.py needs scipy (pip install scipy)")

ROOT = pathlib.Path(__file__).resolve().parent.parent
FIGHTERS = ROOT / "apps" / "game" / "public" / "fighters"
ALPHA_THRESHOLD = 40


def cells_of(manifest: dict, fighter: str) -> tuple[int, int, int]:
    entry = manifest["fighters"][fighter]
    cols, rows = entry["cols"], entry["rows"]
    return manifest["cell"]["w"], manifest["cell"]["h"], cols


def fragment_report(page: Image.Image, cw: int, ch: int, cols: int) -> list[tuple[int, int, int]]:
    """(cell, n_pixels, box) for every non-largest component, per cell."""
    found: list[tuple[int, int, int]] = []
    rows = page.height // ch
    for row in range(rows):
        for col in range(cols):
            local = row * cols + col
            box = (col * cw, row * ch, col * cw + cw, row * ch + ch)
            alpha = np.array(page.convert("RGBA").crop(box).split()[3])
            mask = alpha > ALPHA_THRESHOLD
            if not mask.any():
                continue
            labels, count = ndimage.label(mask, structure=np.ones((3, 3)))
            if count <= 1:
                continue
            sizes = ndimage.sum_labels(mask, labels, index=range(1, count + 1))
            keep = int(np.argmax(sizes)) + 1
            for i in range(1, count + 1):
                if i == keep:
                    continue
                ys, xs = np.nonzero(labels == i)
                found.append((local, int(len(ys)), int(xs.max() - xs.min() + 1)))
    return found


def despeckle(path: pathlib.Path, cw: int, ch: int, cols: int) -> list[tuple[int, int, int]]:
    page = Image.open(path).convert("RGBA")
    arr = np.array(page)
    rows = page.height // ch
    removed = 0
    for row in range(rows):
        for col in range(cols):
            local = row * cols + col
            y0, x0 = row * ch, col * cw
            tile = arr[y0 : y0 + ch, x0 : x0 + cw]
            mask = tile[:, :, 3] > ALPHA_THRESHOLD
            if not mask.any():
                continue
            labels, count = ndimage.label(mask, structure=np.ones((3, 3)))
            if count <= 1:
                continue
            sizes = ndimage.sum_labels(mask, labels, index=range(1, count + 1))
            keep = int(np.argmax(sizes)) + 1
            for i in range(1, count + 1):
                if i == keep:
                    continue
                tile[:, :, 3] = np.where(labels == i, 0, tile[:, :, 3])
                removed += 1
    out = Image.fromarray(arr, "RGBA")
    # Re-encoded, not lossless. Lossless WebP put the atlases at 1.8MB and the
    # 512KB asset gate rejected every one of them; the shipped atlases are
    # lossy at ~430KB and this lands in the same place. alpha_quality stays at
    # 100 so the keying is not degraded by the RGB pass — the alpha channel is
    # what the alphaTest and the silhouette both depend on.
    out.save(path, "WEBP", quality=82, alpha_quality=100, method=6)
    return [(0, removed, 0)] if removed else []


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--check", action="store_true", help="report only, change nothing")
    args = ap.parse_args()

    manifest = json.loads((FIGHTERS / "manifest.json").read_text())
    total = 0
    for fighter, entry in manifest["fighters"].items():
        cw, ch, cols = cells_of(manifest, fighter)
        for page in entry["pages"]:
            path = FIGHTERS / page
            if args.check:
                report = fragment_report(Image.open(path), cw, ch, cols)
                for local, n, _w in report:
                    print(f"{page} cell {local}: detached fragment of {n}px")
                total += len(report)
            else:
                total += sum(r[1] for r in despeckle(path, cw, ch, cols))
                print(f"{page}: despeckled")

    if args.check:
        print(f"\n{total} detached fragment(s)")
        return 1 if total else 0
    print(f"\nerased {total} fragment(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
