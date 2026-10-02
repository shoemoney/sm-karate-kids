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
"$PY_BIN" - "$ROOT" <<'PY'
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

# The r155 failure, shaped: eight distinct richly-coloured frames that are all
# unrelated static screens of wildly different brightness — dark settings next
# to a bright fight — plus a burst of a bout nobody played. `spread=True` is
# what makes the old metric score it the way it scored the real set: mean luma
# delta comes from how different the SCREENS are, not from anything moving.
d = build("unplayed", spread=True)
(d / "burst" / "frames.json").write_text(json.dumps([
    {"file": f"{i:02d}.png", "tick": 72 + i * 24, "phase": "fight",
     "positions": [-1.6, 1.6]} for i in range(8)], indent=2))
PY

# ------------------------------------------------------------------ assert ---
run() { "$PY_BIN" "$GATE" "$ROOT/$1" 2>&1; }

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