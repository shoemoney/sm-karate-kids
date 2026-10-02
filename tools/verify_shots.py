#!/usr/bin/env python3
"""
The capture gate, from the triple-A loop's failure mode 1.

`SAVED` proves nothing. That script has printed SAVED for every frame of a run
where the harness wrote byte-identical black PNGs, and the reviewer then judged
a picture of nothing and described the developer's comments back at us.

This is the same gate applied to this project's frames:

  identical   — every frame byte-identical, so nothing rendered
  flat        — a real PNG of one colour, i.e. a blank canvas
  no motion   — a bout that is not being played

**The motion check reads a burst, not the set. r155.**
This used to be the mean inter-frame luma delta over `sorted(glob("*.png"))`,
thresholded at 2.6. That was disarmable, and it was disarmed: every shot in the
set is a cold page load in its own browser context, so no two frames share a
page and filename adjacency is not time. Measured on a set of eight real,
distinct, richly-coloured frames containing **no gameplay at all** — a boot
card, a title, a technique reference, two settings screens, a bracket and a
ladder — it reported `motion 12.08` and exited 0. Its largest contributors were
a settings menu (32.32) and a bracket; the real gameplay pair `fight -> strike`
scored 0.67. It was measuring the brightness difference between unrelated
screens and labelling it motion.

Per-pixel change does not rescue it either: measured across unrelated static
screens it read 76.67% for two settings menus and 1.90% for two brackets. The
information is not in the pixels — it is in knowing two frames came from one
continuous capture. So the harness now writes `burst/`, eight frames taken back
to back from a single played bout plus the simulation tick and fighter
positions at each, and that is what this gate measures.

Measured arms, three independent runs each, all off pixels:

  arm                 mean px delta   distinct position pairs   ticks
  played burst              12.6%                    6 of 8      advance
  unplayed burst             0.59%                   1 of 8      advance

The ticks advance in both, which is why a clock alone is not evidence: the sim
runs at 60Hz whether or not anyone is playing. A factor of 21 separates them on
per-pixel change and 6x on moved positions.

The old constant, 2.6, was never the defect — computed over the right
population it would have worked. It was being asked the right question about the
wrong frames.

Exit 0 = real frames from a bout that was actually played. Exit 1 = refuse, and
say which check failed.

Usage: python3 tools/verify_shots.py /tmp/smkk-loop [--min-shots N]
"""
from __future__ import annotations

import argparse
import json
import pathlib
import statistics
import sys

MIN_COLORS = 12
MIN_FRAMES = 8

# Burst thresholds. `MIN_BURST_MOTION` sits 6.8x above the unplayed arm and 3.2x
# below the played one; `MIN_BURST_POS` sits between 1 and 6. Both are set from
# the measured arms above, not chosen for looks.
MIN_BURST_FRAMES = 6
MIN_BURST_MOTION = 4.0
MIN_BURST_POS = 3
PIXEL_EPSILON = 8  # a channel delta below this counts as unchanged


def _pixels(im):
    """Pillow >= 11 deprecates `getdata`; the replacement is not on older builds."""
    try:
        return im.get_flattened_data()
    except AttributeError:
        return im.getdata()


def luma(path: pathlib.Path) -> float:
    from PIL import Image

    with Image.open(path) as im:
        # `convert("L")` yields ints, not triples — and unpacking an int is
        # exactly the kind of thing that only fails once the gate is the only
        # thing standing between a blank run and a review of it.
        return statistics.mean(_pixels(im.convert("L")))


def changed_fraction(a: pathlib.Path, b: pathlib.Path) -> float | None:
    """Percentage of pixels differing by more than PIXEL_EPSILON, or None if the
    two frames are not the same size and therefore not comparable."""
    from PIL import Image, ImageChops

    with Image.open(a) as ia, Image.open(b) as ib:
        if ia.size != ib.size:
            return None
        hist = ImageChops.difference(ia.convert("L"), ib.convert("L")).histogram()
    return 100.0 * sum(hist[PIXEL_EPSILON:]) / sum(hist)


def check_set(files: list[pathlib.Path]) -> str | None:
    """Checks that are valid on a heterogeneous set: is this a real render?"""
    digests = {f.read_bytes() for f in files}
    if len(digests) < len(files):
        return f"{len(files) - len(digests)} duplicate frame(s) — nothing re-rendered"

    from PIL import Image

    for f in files:
        with Image.open(f) as im:
            if len(im.convert("RGB").getcolors(maxcolors=1 << 22) or []) < MIN_COLORS:
                return f"{f.name} is a flat fill ({MIN_COLORS} colours is a real frame)"
    return None


def check_burst(shots: pathlib.Path) -> tuple[str | None, str]:
    """The motion check. Reads `burst/` — the only frames where adjacency is time."""
    burst_dir = shots / "burst"
    manifest = burst_dir / "frames.json"
    if not manifest.is_file():
        return (
            f"no burst/frames.json — the set cannot show the game was played "
            f"(r155: the cross-screen metric passed a set with no gameplay in it)",
            "no burst",
        )

    meta = json.loads(manifest.read_text())
    if len(meta) < MIN_BURST_FRAMES:
        return f"burst has {len(meta)} frames, want {MIN_BURST_FRAMES}", "burst too short"

    paths = []
    for m in meta:
        p = burst_dir / m["file"]
        if not p.is_file():
            return f"burst frame {m['file']} named but not written", "burst frame missing"
        paths.append(p)

    ticks = [m.get("tick") for m in meta]
    if not all(isinstance(t, int) for t in ticks):
        return "burst has no simulation ticks — motion cannot be established", "no ticks"
    if not all(b > a for a, b in zip(ticks, ticks[1:])):
        return (
            f"burst ticks do not advance ({', '.join(str(t) for t in ticks)}) — "
            f"the simulation was not running",
            "ticks frozen",
        )

    if len({p.read_bytes() for p in paths}) < len(paths):
        return "burst frames are byte-identical — the renderer drew nothing", "burst frozen"

    deltas = []
    for a, b in zip(paths, paths[1:]):
        d = changed_fraction(a, b)
        if d is None:
            return "burst frames differ in size and cannot be compared", "burst size mismatch"
        deltas.append(d)
    motion = statistics.mean(deltas)

    positions = {tuple(m["positions"]) for m in meta if m.get("positions") is not None}
    if len(positions) < MIN_BURST_POS:
        return (
            f"fighters held {len(positions)} position(s) across {len(meta)} burst "
            f"frames — a running clock on a still scene is not a played bout",
            "world static",
        )

    if motion < MIN_BURST_MOTION:
        return (
            f"burst mean pixel change {motion:.2f}% < {MIN_BURST_MOTION}% — "
            f"the bout is not being played",
            "no motion",
        )

    detail = (
        f"burst {len(paths)} frames, ticks {ticks[0]}..{ticks[-1]}, "
        f"{len(positions)} positions, motion {motion:.2f}%"
    )
    return None, detail


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("shots")
    ap.add_argument("--min-shots", type=int, default=MIN_FRAMES)
    a = ap.parse_args()

    shots = pathlib.Path(a.shots)
    files = sorted(shots.glob("*.png"))
    if len(files) < a.min_shots:
        print(f"FAIL only {len(files)} frames, want {a.min_shots}")
        return 1

    bad = check_set(files)
    if bad:
        print(f"FAIL {bad}")
        return 1

    bad, detail = check_burst(shots)
    if bad:
        print(f"FAIL {bad}")
        return 1

    print(f"OK  {len(files)} frames, {len({f.read_bytes() for f in files})} distinct; {detail}")
    return 0


if __name__ == "__main__":
    sys.exit(main())