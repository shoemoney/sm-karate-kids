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

**The coverage check. r171.** Everything above asks "is this a real render from
a played bout?", which is a question about the frames that ARE there. Nothing
asked whether every frame that should be there still is, and `MIN_FRAMES` is a
floor on a *count* — so the set could be gutted and the gate would not notice.

Measured on this game's own set, this round:

    delete 13 of 22 declared frames -> `OK 9 frames, 9 distinct; burst ...`
    exit 0.

Gone in that pass: the techniques sheet, the result card, desktop entirely, the
high-contrast mode, the tournament bracket, the impact frame, the airborne
fighter, the ladder, the returning-player control, the mixed-settings state, the
live HUD and the scored result. Those are the frames rounds 96-154 are findings
*about*. A reviewer would have judged a third of the game and the gate would
have called the set good.

And it is not a hypothetical that frames go missing — it happened on the very
run that found this. Two captures carry a guard that `return`s without writing a
file, and both fired:

    19-phone-half-point: no half landed, frame not written
    21-phone-kick-open: no active kick observed, frame not written

`verify_shots.py` returned **0** on that set. The half-point frame is r148's
entire round; the kick-open frame exists because r154 recorded that nothing had
ever photographed it.

So the gate now reads `tools/review-frames.tsv` — the list of states the set is
supposed to cover — and fails on a declared frame that was not written, and on
a frame that was written but declared by nobody. The authoring half (a capture
added without a row) is `apps/game/tests/unit/review-set-covers-declared-frames.test.ts`,
which is offline and runs in `pnpm check`.

Proved able to fail in `tools/verify-shots-mutation.sh`.

Exit 0 = real frames from a bout that was actually played, and all of them.
Exit 1 = refuse, and say which check failed. Exit 2 = operator error (a manifest
that is not there is not a defect in the set, and r141's lesson is that the two
must never read the same).

Usage: python3 tools/verify_shots.py /tmp/smkk-loop [--min-shots N]
                [--frames tools/review-frames.tsv | --no-frames]
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


def read_manifest(path: pathlib.Path) -> tuple[list[tuple[str, str]], str | None]:
    """`([(frame name, kind)], operator error)`.

    `kind` is `capture` or `opportunistic`, from the second tab-separated
    field. Names come from the first field; blank lines and `#` comments are
    skipped — the comment block in that file explains what it is for, and a
    parser that read its own explanation as a frame name would be r170's
    instrument-wrong-before-measuring twice in one file.
    """
    if not path.is_file():
        return [], (
            f"{path} is not there — the coverage contract cannot be checked, and a "
            f"gate that silently stops checking is r161's shape. Operator error, not a "
            f"defect in the set; run with --no-frames to skip it deliberately."
        )

    rows: list[tuple[str, str]] = []
    for lineno, raw in enumerate(path.read_text().splitlines(), start=1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        fields = [f.strip() for f in line.split("\t")]
        name = fields[0]
        if not name:
            continue
        # The manifest names frames the way `review-shots.mjs` names them,
        # because that is what the authoring half cross-checks against. The
        # files on disk carry the extension; adding it here is what lets one
        # column serve both halves.
        if not name.endswith(".png"):
            name = f"{name}.png"
        kind = fields[1] if len(fields) > 1 else "capture"
        if kind not in ("capture", "opportunistic"):
            return [], (
                f"{path}:{lineno} declares `{name}` with kind `{kind}`; "
                f"the only kinds are `capture` and `opportunistic`"
            )
        rows.append((name, kind))

    if not rows:
        return [], f"{path} declares no frames — a manifest that lists nothing checks nothing"
    return rows, None


def check_coverage(
    files: list[pathlib.Path], declared: list[tuple[str, str]]
) -> tuple[str | None, list[str]]:
    """Every declared state was photographed, and nothing was photographed that
    nobody declared. Returns `(failure or None, opportunistically uncovered)`.

    Both directions, because they fail differently. A missing frame is a
    capture whose guard bailed or a browser that died mid-run. An undeclared
    frame is a capture added without a row, and r158's sentence is about exactly
    that: a state that becomes reachable is not a state that has been reviewed.

    `opportunistic` frames photograph a MOMENT rather than a screen, so their
    capture can legitimately fail to find its subject and its guard returns
    without writing a file. Those are reported, never silently dropped — the
    header carries the measured frequency that made the split necessary.
    """
    present = {f.name for f in files}
    kinds = {n: k for n, k in declared}

    missing = [n for n, _ in declared if n not in present]
    required_missing = [n for n in missing if kinds[n] == "capture"]
    if required_missing:
        shown = ", ".join(required_missing[:4]) + (
            f" and {len(required_missing) - 4} more" if len(required_missing) > 4 else ""
        )
        return (
            f"{len(required_missing)} declared frame(s) were not written: {shown}. A "
            f"capture whose guard bailed and a set that lost a screen look identical "
            f"from here — read the capture log, not this line."
        ), []

    undeclared = sorted(present - set(kinds))
    if undeclared:
        shown = ", ".join(undeclared[:4]) + (
            f" and {len(undeclared) - 4} more" if len(undeclared) > 4 else ""
        )
        return (
            f"{len(undeclared)} frame(s) in the set that no row in the manifest declares: "
            f"{shown}. A state that becomes reachable is not a state that has been reviewed."
        ), []

    return None, missing


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("shots")
    ap.add_argument("--min-shots", type=int, default=MIN_FRAMES)
    here = pathlib.Path(__file__).resolve().parent
    ap.add_argument("--frames", default=str(here / "review-frames.tsv"))
    ap.add_argument(
        "--no-frames",
        action="store_true",
        help="skip the coverage check (the mutation harness's legacy fixtures)",
    )
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

    declared: list[tuple[str, str]] = []
    uncovered: list[str] = []
    if not a.no_frames:
        declared, op_error = read_manifest(pathlib.Path(a.frames))
        if op_error:
            print(f"INCONCLUSIVE {op_error}")
            return 2
        bad, uncovered = check_coverage(files, declared)
        if bad:
            print(f"FAIL {bad}")
            return 1

    bad, detail = check_burst(shots)
    if bad:
        print(f"FAIL {bad}")
        return 1

    print(
        f"OK  {len(files)} frames, {len({f.read_bytes() for f in files})} distinct"
        + (
            f", {len(declared) - len(uncovered)}/{len(declared)} declared states covered"
            if declared
            else ""
        )
        + f"; {detail}"
    )
    # On the OK line, not above it. A warning a reader can scroll past is the
    # same defect in a different font, and this one used to be a silence.
    if uncovered:
        print(
            "UNCOVERED (opportunistic; its capture could not find its subject): "
            + ", ".join(n.removesuffix(".png") for n in uncovered)
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())