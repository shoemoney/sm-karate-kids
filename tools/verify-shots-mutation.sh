#!/usr/bin/env bash
# Proves tools/verify_shots.py can fail.
#
# The r155 defect was not "the motion check is absent" — it was present,
# correct in spirit, thresholded sensibly, and reported a passing verdict on a
# review set containing no gameplay at all. So "the gate returns 1 somewhere" is
# not the question this harness answers. The question is whether it returns 1
# for *each* way a capture can go wrong, and case 9 is the one that matters:
# it runs the old algorithm, verbatim, on data shaped like the failure and gets
# the passing verdict. That is the difference between "the reader was absent"
# and "the reader was wrong".
#
# Fixtures are synthetic so the harness is deterministic and needs no browser.
# The arms the thresholds were set from were measured on real frames and are
# recorded in verify_shots.py's docstring and in REVIEW-LOOP.md.
set -uo pipefail

NODE_BIN="$(command -v node)"
PY_BIN="$(command -v python3)"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GATE="$HERE/verify_shots.py"

[ -n "$PY_BIN" ] || { echo "HARNESS BUG: no python3 on PATH"; exit 7; }
[ -f "$GATE" ] || { echo "HARNESS BUG: no gate at $GATE"; exit 7; }

ROOT="$(mktemp -d "${TMPDIR:-/tmp}/smkk-vsmut.XXXXXX")"
trap 'rm -rf "$ROOT"' EXIT

pass=0; fail=0
ok()   { printf '  \033[32mok\033[0m   %s\n' "$1"; pass=$((pass+1)); }
bad()  { printf '  \033[31mFAIL\033[0m %s\n' "$1"; fail=$((fail+1)); }

# ---------------------------------------------------------------- fixtures ---
"$PY_BIN" - "$ROOT" "$HERE/review-frames.tsv" <<'PY'
import json, pathlib, sys
from PIL import Image, ImageDraw

root = pathlib.Path(sys.argv[1])

def frame(path, block_x, base=6, span=40):
    """A non-flat, many-coloured frame with a block that can move."""
    im = Image.new("RGB", (64, 64), (base, base + 4, base + 8))
    d = ImageDraw.Draw(im)
    for y in range(64):                      # gradient: far above MIN_COLORS=12
        d.line([(0, y), (64, y)], fill=(base + y, 40 + y, 90 - y))
    d.rectangle([block_x, 24, block_x + 12, 40], fill=(240, 40, 40))
    im.save(path)

def build(name, n=8, move=5, positions_move=True, ticks_advance=True, spread=False):
    """One review set: n top-level frames plus a burst/ with frames.json.

    `move` is the burst block's per-frame travel in pixels. 5 keeps the frames
    distinct and well clear of the motion threshold; 1 keeps them distinct but
    sub-threshold, which is the arm that must reach the pixel check.
    `spread` gives the top-level frames wildly different brightness, the way a
    real set of unrelated screens (dark settings vs bright fight) does.
    """
    d = root / name
    (d / "burst").mkdir(parents=True)
    for i in range(n):                        # top-level set: real render
        frame(d / f"{i:02d}.png", 8 + i * 3, base=(4 + i * 24) if spread else 6)
    meta = []
    for i in range(8):
        bx = 6 + (i * move if move else 0)
        frame(d / "burst" / f"{i:02d}.png", bx)
        meta.append({
            "file": f"{i:02d}.png",
            "tick": 72 + i * (24 if ticks_advance else 0),
            "phase": "fight",
            "positions": [(-1.6 + (i * 0.15 if positions_move else 0)), 1.6],
        })
    (d / "burst" / "frames.json").write_text(json.dumps(meta, indent=2))
    return d

build("honest")                                  # positive control
build("frozen-ticks", ticks_advance=False)
build("world-static", positions_move=False)
build("still-burst", move=1)                      # ticks run, world moves, sub-threshold
build("no-burst-manifest")
(root / "no-burst-manifest" / "burst" / "frames.json").unlink()

# renderer drew nothing: burst frames byte-identical but ticks still advance
d = build("identical-burst")
first = (d / "burst" / "00.png").read_bytes()
for i in range(8):
    (d / "burst" / f"{i:02d}.png").write_bytes(first)

d = build("missing-burst-frame")
(d / "burst" / "05.png").unlink()

d = build("dup-top-level")                        # 2 duplicates among 8
(d / "01.png").write_bytes((d / "00.png").read_bytes())
(d / "02.png").write_bytes((d / "00.png").read_bytes())

d = build("flat-frame")                           # one blank canvas
Image.new("RGB", (64, 64), (12, 12, 12)).save(d / "03.png")

build("too-few", n=6)

# --- the r171 coverage arm --------------------------------------------------
# Every fixture above has the same eight top-level names, so one manifest
# declares them for all of them and the legacy cases gain a coverage check on
# the way past. That is deliberate: the new arm is not bolted on beside the old
# one, it runs on every case the old one already ran.
ALL = [f"{i:02d}.png" for i in range(8)]

def manifest(name, rows):
    (root / name).write_text(
        "# synthetic manifest for the mutation harness\n"
        + "".join(f"{n}\t{k}\tstate {n}\tsynthetic\n" for n, k in rows)
    )

manifest("frames.tsv", [(n, "capture") for n in ALL])

# A required frame that was never written. Nine frames, because the count check
# runs first and a seven-frame fixture would be caught by the WRONG gate, which
# is the r155 lesson about a red row asserting something other than its label.
d = build("coverage-missing-required", n=9)
manifest("frames-nine.tsv", [(f"{i:02d}.png", "capture") for i in range(9)])
(d / "03.png").unlink()

# A frame in the set that no row declares: a capture added without a manifest
# entry, which is r158's sentence with the manifest as the new reviewer.
d = build("coverage-undeclared")
frame(d / "09.png", 40)

# Only an opportunistic frame absent: exit 0, and it is PRINTED. The split
# exists so the gate can be strict about screens and honest about moments, and
# this case is what keeps the honest half from being the silent half.
build("coverage-opportunistic-missing")
manifest("frames-opportunistic.tsv",
         [(n, "capture") for n in ALL] + [("08.png", "opportunistic")])

# A manifest that is not there is operator error, not a defect in the set, and
# r141's lesson is that the two must never read the same.
manifest("frames-empty.tsv", [])
manifest("frames-badkind.tsv", [(n, "capture") for n in ALL] + [("08.png", "sometimes")])

# The r155 failure, shaped: eight distinct richly-coloured frames that are all
# unrelated static screens of wildly different brightness — dark settings next
# to a bright fight — plus a burst of a bout nobody played. `spread=True` is
# what makes the old metric score it the way it scored the real set: mean luma
# delta comes from how different the SCREENS are, not from anything moving.
d = build("unplayed", spread=True)
(d / "burst" / "frames.json").write_text(json.dumps([
    {"file": f"{i:02d}.png", "tick": 72 + i * 24, "phase": "fight",
     "positions": [-1.6, 1.6]} for i in range(8)], indent=2))

# --- the r172 arm: a set built from the REPOSITORY's own manifest -------------
# Everything above proves the coverage gate can fail on a synthetic manifest.
# This proves item 3.4's actual acceptance criterion: with
# `tools/review-frames.tsv` as it stands, losing `18-phone-kick` or
# `19-phone-half-point` must be a FAILURE, and losing `21-phone-kick-open` must
# not be — that row is still `opportunistic`, because a whiffed kick awards no
# call and so has no referee hold to photograph. Measured: a capture bracketed
# `active -> recovery` came back a guard stance, so that row cannot honestly be
# strict, and a gate that cries wolf gets deleted.
#
# Built by READING the real manifest rather than by listing 24 names here. A
# hand-written fixture would pass today and mean nothing the day a row is
# renamed, which is r151's shape: a contract asserted against a copy of itself.
REAL = pathlib.Path(sys.argv[2])
declared = [
    f.split("\t")[0].strip()
    for f in REAL.read_text().splitlines()
    if f.strip() and not f.strip().startswith("#") and f.split("\t")[1].strip() == "capture"
]
d = root / "real-all"
(d / "burst").mkdir(parents=True)
for i, name in enumerate(declared):
    frame(d / f"{name}.png", 2 + i * 2)
meta = []
for i in range(8):
    frame(d / "burst" / f"{i:02d}.png", 6 + i * 5)
    meta.append({"file": f"{i:02d}.png", "tick": 72 + i * 24, "phase": "fight",
                 "positions": [-1.6 + i * 0.15, 1.6]})
(d / "burst" / "frames.json").write_text(json.dumps(meta, indent=2))
(root / "real-frames.tsv").write_text(REAL.read_text())
print(f"  (built {len(declared)} declared capture frames from the real manifest)")
PY

# ------------------------------------------------------------------ assert ---
# Every case runs against the synthetic manifest, so the legacy eleven also
# carry a coverage check. Without `--frames` the gate falls back to the repo's
# real `review-frames.tsv`, and the first run of this arm reported nine red rows
# that were the harness measuring the wrong tree — r170's lesson, twice, in one
# file.
run() { "$PY_BIN" "$GATE" "$ROOT/$1" --frames "$ROOT/frames.tsv" 2>&1; }

expect() {                      # expect <case> <want-exit> <want-substring>
  local name="$1" want="$2" needle="$3" out code
  out="$(run "$name")"; code=$?
  if [ "$code" != "$want" ]; then
    bad "$name: exit $code, want $want  [$out]"; return
  fi
  if [ -n "$needle" ] && ! printf '%s' "$out" | grep -qi -- "$needle"; then
    bad "$name: exit $code but no diagnosis matching '$needle'  [$out]"; return
  fi
  ok "$name (exit $code: $(printf '%s' "$out" | head -1 | cut -c1-72))"
}

# The legacy cases run against the synthetic manifest too, so every one of them
# now also has to satisfy coverage. `--frames` is omitted only where a case is
# specifically about the manifest being unreadable.
run_manifest() { "$PY_BIN" "$GATE" "$ROOT/$1" --frames "$ROOT/$2" 2>&1; }

expect_manifest() {             # expect_manifest <case> <manifest> <exit> <needle>
  local name="$1" mf="$2" want="$3" needle="$4" out code
  out="$(run_manifest "$name" "$mf")"; code=$?
  if [ "$code" != "$want" ]; then
    bad "$name/$mf: exit $code, want $want  [$out]"; return
  fi
  if [ -n "$needle" ] && ! printf '%s' "$out" | grep -qi -- "$needle"; then
    bad "$name/$mf: exit $code but no diagnosis matching '$needle'  [$out]"; return
  fi
  ok "$name/$mf (exit $code: $(printf '%s' "$out" | head -1 | cut -c1-64))"
}

echo "verify_shots.py mutation harness"

expect honest              0 "OK"
expect no-burst-manifest   1 "no burst"
expect frozen-ticks        1 "ticks do not advance"
expect world-static        1 "position"
expect still-burst         1 "pixel change"
expect identical-burst     1 "byte-identical"
expect missing-burst-frame 1 "not written"
expect dup-top-level       1 "duplicate"
expect flat-frame          1 "flat fill"
expect too-few             1 "want 8"
expect unplayed            1 "position"

# --- the r171 coverage arm, baseline first -----------------------------------
# `honest` under the real manifest is the positive control for the new arm: a
# harness whose fixture is wrong measures a broken gate and reports it as a row
# of tidy passes, which is what r170's harness was twice wrong about.
expect_manifest honest                frames.tsv               0 "declared states covered"
expect_manifest coverage-missing-required frames-nine.tsv       1 "were not written"
expect_manifest coverage-undeclared   frames.tsv               1 "no row in the manifest"
expect_manifest coverage-opportunistic-missing frames-opportunistic.tsv 0 "UNCOVERED"
expect_manifest honest                frames-empty.tsv         2 "declares no frames"
expect_manifest honest                frames-badkind.tsv       2 "the only kinds are"
expect_manifest honest                frames-absent.tsv        2 "is not there"

# --- the r172 arm, against the real manifest -----------------------------------
# The positive control comes FIRST: a set built from the repository's own
# manifest must PASS, or the four reds below would only prove the fixture is
# broken. That is r170's lesson, and this harness has already been wrong about it
# twice in one file.
expect_manifest real-all real-frames.tsv 0 "declared states covered"
for GONE in 18-phone-kick 19-phone-half-point 23-phone-picked 06-phone-settings; do
  rm -rf "$ROOT/real-missing-$GONE"
  cp -r "$ROOT/real-all" "$ROOT/real-missing-$GONE"
  rm -f "$ROOT/real-missing-$GONE/$GONE.png"
  expect_manifest "real-missing-$GONE" real-frames.tsv 1 "were not written"
done
# The optimistic direction: the one row still allowed to miss its subject.
rm -rf "$ROOT/real-missing-21-opportunistic"
cp -r "$ROOT/real-all" "$ROOT/real-missing-21-opportunistic"
rm -f "$ROOT/real-missing-21-opportunistic/21-phone-kick-open.png"
expect_manifest real-missing-21-opportunistic real-frames.tsv 0 "UNCOVERED"

# --- case 9: the old algorithm, verbatim, on the same failure ----------------
OLD=$("$PY_BIN" - "$ROOT/unplayed" <<'PY'
import pathlib, statistics, sys
from PIL import Image
files = sorted(pathlib.Path(sys.argv[1]).glob("*.png"))
lums = [statistics.mean(Image.open(f).convert("L").get_flattened_data()) for f in files]
d = [abs(lums[i+1] - lums[i]) for i in range(len(lums)-1)]
print(f"{statistics.mean(d):.2f}")
PY
)
if "$PY_BIN" -c "import sys; sys.exit(0 if float('$OLD') >= 2.6 else 1)"; then
  ok "old cross-screen metric still PASSES the unplayed set at motion $OLD (>= 2.6) — the defect, not its absence"
else
  bad "old metric read $OLD, below its own 2.6 threshold — cannot reproduce the r155 defect this way"
fi

# --- case 10: a burst cannot be faked by a manifest alone --------------------
FAKE=$ROOT/fake-manifest
cp -r "$ROOT/honest" "$FAKE"
"$PY_BIN" - "$FAKE" <<'PY'
import pathlib, sys
# Claim eight positions across frames whose pixels never change.
d = pathlib.Path(sys.argv[1])
first = (d / "burst" / "00.png").read_bytes()
for i in range(8):
    (d / "burst" / f"{i:02d}.png").write_bytes(first)
meta = [{"file": f"{i:02d}.png", "tick": 72 + i * 24, "phase": "fight",
         "positions": [-1.6 + i * 0.15, 1.6]} for i in range(8)]
(d / "burst" / "frames.json").write_text(__import__("json").dumps(meta))
PY
expect fake-manifest 1 "byte-identical"

echo
echo "passed $pass, failed $fail"
[ "$fail" -eq 0 ] || exit 1