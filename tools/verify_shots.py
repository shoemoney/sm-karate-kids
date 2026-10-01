#!/usr/bin/env python3
"""
The capture gate, from the triple-A loop's failure mode 1.

`SAVED` proves nothing. That script has printed SAVED for every frame of a run
where the harness wrote byte-identical black PNGs, and the reviewer then judged a
picture of nothing and described the developer's comments back at us.

This is the same gate applied to this project's frames:

  identical   — every frame byte-identical, so nothing rendered
  flat        — a real PNG of one colour, i.e. a blank canvas
  no motion   — real, distinct, richly-coloured frames of a game that is not
                being played. Caught 45 cycles of a Godot run judging a bot
                dying in sector 1, and it is the reason MIN_MOTION exists.

Exit 0 = real frames. Exit 1 = refuse, and say which check failed.

Usage: python3 tools/verify_shots.py /tmp/smkk-loop [--min-shots N] [--min-motion F]
"""
from __future__ import annotations

import argparse
import pathlib
import statistics
import sys

MIN_COLORS = 12
MIN_MOTION = 2.6      # an unplayed run measures ~1.9; a played one, far higher
MIN_FRAMES = 8


def luma(path: pathlib.Path) -> float:
    from PIL import Image

    with Image.open(path) as im:
        # `convert("L")` yields ints, not triples — and unpacking an int is
        # exactly the kind of thing that only fails once the gate is the only
        # thing standing between a blank run and a review of it.
        return statistics.mean(im.convert("L").getdata())


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("shots")
    ap.add_argument("--min-shots", type=int, default=MIN_FRAMES)
    ap.add_argument("--min-motion", type=float, default=MIN_MOTION)
    a = ap.parse_args()

    files = sorted(pathlib.Path(a.shots).glob("*.png"))
    if len(files) < a.min_shots:
        print(f"FAIL only {len(files)} frames, want {a.min_shots}")
        return 1

    # 1. not identical
    digests = {f.read_bytes() for f in files}
    if len(digests) < len(files):
        print(f"FAIL {len(files) - len(digests)} duplicate frame(s) — nothing re-rendered")
        return 1

    # 2. not flat
    from PIL import Image

    for f in files:
        with Image.open(f) as im:
            if len(im.convert("RGB").getcolors(maxcolors=1 << 22) or []) < MIN_COLORS:
                print(f"FAIL {f.name} is a flat fill ({MIN_COLORS} colours is a real frame)")
                return 1

    # 3. not motionless
    lums = [luma(f) for f in files]
    deltas = [abs(lums[i + 1] - lums[i]) for i in range(len(lums) - 1)]
    motion = statistics.mean(deltas)
    if motion < a.min_motion:
        print(f"FAIL mean inter-frame luma delta {motion:.2f} < {a.min_motion} — the game is not being played")
        return 1

    print(f"OK  {len(files)} frames, {len(digests)} distinct, motion {motion:.2f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
