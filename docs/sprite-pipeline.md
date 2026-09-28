# 🥋 Sprite Atlas Pipeline

How `tools/build-fighter-atlas.py` turns the AI-generated contact sheets in `codex-assets/` into
the WebP atlases and `manifest.json` that `apps/game/src/spriteRig.ts` renders. This doc covers how
to run it, the manifest schema, the segmentation approach, and an honest list of what still needs
regenerated art.

## 🏃 Running it

```bash
python3 tools/build-fighter-atlas.py                # writes apps/game/public/fighters/
python3 tools/build-fighter-atlas.py --dry-run       # reports what it would do, writes nothing
python3 tools/build-fighter-atlas.py --source DIR    # override codex-assets/ location
python3 tools/build-fighter-atlas.py --out DIR       # override apps/game/public/fighters/ location
```

It is deterministic (same inputs → byte-identical outputs) and re-runnable: drop a new
`codex-assets/<move_id>/{white,red}-sheet.png` pair in and re-run; it picks it up automatically. A
move folder missing one or both sheets is skipped with a log line, not a crash.

After running, `pnpm validate:assets` must exit 0 — it enforces the per-file 512KB cap and that
every file under `apps/game/public/` has a `PROVENANCE.json` entry.

## 📥 Inputs

- `codex-assets/<move_id>/{white,red}-sheet.png` — 1024×1536 RGBA contact sheets. Each fighter's
  own `animation.json` (see below) says whether that particular sheet packs a 2×3 or 3×2 grid of
  six frames — it is **not** uniform across sheets, and a few sheets even differ *between* the two
  fighters for the same move (`front_kick`, `high_block`, `reverse_punch` are 3×2 for white, 2×3
  for red).
- `codex-assets/<move_id>/animation.json` — per fighter: `grid.columns`, `grid.rows`, `frames`
  (the 00→05 naming, defining frame order), `facing`, and `fps`. Read for grid shape and facing;
  the pre-sliced `white-00.png` … `red-05.png` files next to it are naive fixed-grid crops and are
  **not** used — they inherit exactly the limb-chopping this pipeline exists to avoid.
- `codex-assets/guard/{white,red}.png` — one full-body idle pose per fighter, no grid, no
  `animation.json`.
- `packages/sim/src/grammar.ts` — the canonical 20 move ids (hand-mirrored into
  `CANONICAL_MOVES` at the top of the script; update both if the grammar changes).

## 🧩 Segmentation

1. **Row bands.** Threshold the alpha channel, sum occupancy per row, and find contiguous
   non-empty bands with a small gap tolerance (a few px, to bridge anti-aliasing noise). If that
   yields exactly the expected row count (from `animation.json`'s `grid.rows`), use it directly. If
   a band is roughly `N`× the nominal row height (rows touched/merged), recursively split it at the
   **deepest minimum** of the row-occupancy profile within a window around the expected sub-boundary
   — the same idea as the column split below, just applied to rows. Only if that still doesn't
   produce the right count does it fall back to an even `H/rows` split of the whole sheet.
2. **Columns.** Within each row band, split into `grid.columns` pieces the same way: deepest minima
   of the column-alpha-sum near each expected boundary, not a hard zero-gap requirement — this is
   what survives frames where adjacent figures' limbs touch.
3. **Per-cell crop.** Tight bbox of the cell's own alpha content (with a few px of padding),
   cropped from the source at full resolution, kept in coordinates **relative to that cell**, never
   absolute sheet coordinates. (Early build: mixing absolute sheet-space Y across row bands that
   live at wildly different absolute heights was the cause of a nasty "fighter bobs every frame"
   bug — fixed by always working cell-relative from extraction onward.)
4. **Confidence.** Every row/column split carries a confidence score (how deep the minimum was
   relative to the local peak). Sheets that needed the full even-split fallback, or where a split's
   confidence was below 0.15, are logged — see **Known issues** below for what that turned up on
   the current art set.

## 🎯 Alignment: baseline, scale, and horizontal anchor

The single most important property is **no bob**: every frame of every pose has to put its feet on
the same baseline row and render at a consistent scale, or the sprite visibly jitters in-game.

- **Scale is per (fighter, pose), not global.** The guard/idle portrait is framed much tighter than
  a 6-frame action sheet — using one global scale (calibrated from guard) made idle render ~3×
  larger than every technique. Instead, each pose's own tallest frame (its closest approach to a
  normal standing height) is scaled to `STANDING_TARGET_PX`. This keeps apparent character size
  consistent *across* moves while preserving real height differences *within* one move's 6 frames
  (a crouch still reads shorter than that same sheet's tallest frame).
- **Vertical placement is a per-move median shift, not per-frame.** For each pose, take the
  *median* foot row (bbox bottom) across its 6 frames and shift the whole sequence by one constant
  amount so that median lands on `manifest.baseline`. This kills frame-to-frame generation jitter
  (which is noise around a should-be-constant planted foot) while preserving genuine motion — a
  real jump arc still shows the feet rising above the baseline, because only the *median*, not each
  frame individually, is pinned.
- **Horizontal placement uses a lower-body anchor, not the bbox center.** A kick's bbox extends
  hard in the kick direction; centering on the full bbox shoves the torso backward every time a
  limb extends. Instead each frame's horizontal anchor is the alpha centroid of its own **bottom
  55%** (`LOWER_BODY_FRACTION`) — dominated by the planted leg/hip, which doesn't swing the way an
  extending arm or kicking leg does. Same per-move-median-shift logic applies horizontally.
- **Contact frame** is picked by measuring each frame's horizontal reach (bbox edge distance from
  the pose's own anchor) for **both** fighters and picking the frame that maximizes the *combined*
  reach — not "whichever fighter's frame the loop happened to compute last," which was a real bug
  in an earlier draft (see Known issues).

## 🖼️ Cell size, pagination, and the byte budget

Cell `w`/`h` are computed, not hand-picked: after per-pose scaling, the tool measures the actual
maximum extent above/below the baseline and left/right of centre across *every* frame of *every*
pose (both fighters), adds a small pad, and that is the cell. Nothing is scaled to fill the cell —
a standing figure naturally lands around 80–90% of cell height once jump/kick headroom is
accounted for.

Pages are packed at a fixed `ATLAS_COLS` (11) and searched from the largest `rows_per_page` down
until every resulting page's WebP (quality 62, method 6 — measured indistinguishable from 82 at phone scale) encodes under 480KB. **Adding pages is always
preferred over shrinking the art or dropping quality** — if a fighter needs more pages than fits in
one, it gets `shiro-0.webp`, `shiro-1.webp`, … automatically; `manifest.fighters.<id>.cols/rows`
describes one uniform page shape shared by all of that fighter's pages, per the addressing formula
below.

## 📄 Manifest schema (`apps/game/public/fighters/manifest.json`)

```json
{
  "version": 1,
  "cell": { "w": 394, "h": 306 },
  "baseline": 268,
  "metresPerCell": 2.0,
  "facing": "right",
  "fighters": {
    "shiro": { "pages": ["shiro-0.webp", "shiro-1.webp"], "cols": 11, "rows": 3 },
    "aka":   { "pages": ["aka-0.webp", "..."],            "cols": 11, "rows": 3 }
  },
  "poses": {
    "idle":        { "frames": [0], "contact": 0 },
    "lunge_punch": { "frames": [1, 2, 3, 4, 5, 6], "contact": 4, "fps": 12 }
  }
}
```

- A frame index addresses a cell: `page = floor(i / (cols*rows))`, `col = i % cols`,
  `row = floor(i / cols) % rows` — one fixed `cols`×`rows` shape per fighter, shared by every page.
- `baseline` is the pixel row **within a cell** where a grounded foot sits, for every frame of
  every pose alike (see Alignment above).
- `metresPerCell` sizes the sprite in-world (fighters are ~1.7m tall): derived as
  `1.7 * cell.h / STANDING_TARGET_PX`.
- `facing` is `"right"` — the source art has white facing right and red facing left; red's frames
  are mirrored (`Image.FLIP_LEFT_RIGHT`, with bbox/anchor math mirrored to match) at build time so
  both fighters face the same way in the atlas, matching the renderer's own runtime mirroring for
  player two.
- `contact` is the index **within that pose's own `frames` array**, not a global atlas index.
- `fps` is carried through from `animation.json` for reference; the renderer maps frames to
  technique phases (startup/active/recovery), not to a frame rate.
- Only poses that were actually produced appear here — `idle` plus whichever move ids had usable
  source art this run.

## 🚨 Two-person sparring shots (contamination detection)

A handful of sheets that should show one fighter solo were actually generated as a two-person
sparring shot (both fighters in every frame). Shipping those naively would paste part of the wrong
colour gi into that fighter's atlas. Detection: HSV-classify each opaque pixel as "red gi fabric"
(hue near 0°/360°, saturation > 0.6, value > 0.35) or "white gi fabric" (saturation < 0.15,
value > 0.45) — tuned to sit far above the skin/hair false-positive floor (~0.1–0.2%) and far below
genuine contamination (~25–48%) measured across every sheet on hand 2026-09-27 — then flag a sheet
whose *own* fighter's colour shouldn't be showing the *other* colour above threshold.

**Separation was attempted, twice, before giving up:**

1. *Spatial cutoff* — per cell, find where the opposite-colour gi mask starts (smoothed to ignore
   stray vignette-bleed pixels) and crop everything at/past that column. Result: clean on the
   opening (non-contact) frame, but chopped the kicking/sweeping leg at the shin on every frame
   where the two fighters' limbs are close, and came back empty on frames where the cutoff column
   landed before the real figure (the pair doesn't fit the naive half-width assumption once both
   fighters are drawn in it).
2. *Connected-component exclusion* — label connected alpha blobs per row band, discard any blob
   touching opposite-gi-coloured pixels. Result: the two fighters' silhouettes touch (glow/aura
   bleed) even in the "guard" opening frame, so the whole row is one component and gets discarded
   entirely — worse than (1).

Neither reached "no red limbs, no chopped white limbs" on all 6 frames, so contaminated sheets are
**not** shipped patched together. Behaviour:

- If **one** fighter's sheet for a move is contaminated and the other is clean: the clean fighter
  gets its real, fully-animated pose; the contaminated fighter holds its idle frame for that pose's
  6 slots (reported loudly, not silently) until the source sheet is regenerated as a true solo shot.
- If **both** fighters' sheets for a move are contaminated: the pose is dropped from the manifest
  entirely. `spriteRig.ts` already falls back to idle for any move id it doesn't have a pose entry
  for, so this degrades the same way, just without a half-isolated, occasionally-chopped limb
  flickering in during the referee's decision window.

## ✅ Segmentation / quality report (this run, 2026-09-27 art set)

| Move | Status | Notes |
|---|---|---|
| All 20 canonical moves | ✅ segmented | Both fighters, all `animation.json` grid shapes (2×3 and 3×2) handled |
| `high_kick` | ✅ segmented, packed as bonus pose | Not one of the grammar's 20 ids — harmless extra, listed separately by the tool |
| `foot_sweep` | ⚠️ partial | `white-sheet.png` is a two-person sparring shot (48% red-gi pixels) — **shiro holds idle**; `aka` is clean and fully animated |
| `low_sweep` | ⚠️ partial | Same issue, same fix — `white-sheet.png` 48% contaminated, `aka` clean |
| `leg_sweep` | ❌ dropped | **Both** `white-sheet.png` (46%) and `red-sheet.png` (24%) are two-person sparring shots — no clean solo source for either fighter; pose omitted from the manifest (renders as idle) until regenerated |
| `low_block` | ✅ segmented, but low confidence in `contact` | The source sheet's 6 frames barely differ from each other (near-identical guard-ish stance; no visible downward block motion) — `contact` is whatever tiny reach difference exists, which is closer to noise than signal. Not a segmentation bug; worth regenerating with a more pronounced block motion |
| Several sheets (e.g. `back_kick`, `somersault_kick`) | ℹ️ cosmetic only | Background vignette leaves a handful of low-alpha (17–100) stray pixels per sheet that occasionally read as faint specks near a figure; doesn't affect silhouette bbox/position, purely cosmetic |

Row-band and column-split fallback: **none needed** on the current art set once segmentation used
each sheet's own `animation.json` grid shape — the three sheets that looked like fallback cases in
an earlier pass (`front_kick`, `high_block`, `reverse_punch`, all white) turned out to simply be 3×2
instead of 2×3, not genuinely hard-to-segment.

## 🐛 Bugs found and fixed during build (kept here so they don't recur)

- **Absolute vs. cell-relative coordinates.** Early version stored each frame's bbox in absolute
  sheet-pixel coordinates and fed them straight into cross-frame median alignment. Since different
  row bands live at wildly different absolute Y (band 0 near y=0, band 2 near y=1024+), the
  "median" was really measuring which row a frame came from, not its foot position — the fighter
  visibly bobbed by roughly one row-band's height every few frames. Fixed by making every
  `FrameData` cell-relative from extraction onward.
- **Global scale from the guard portrait.** Guard/idle is a tighter, more zoomed-in shot than any
  action sheet; sharing one scale factor made idle ~3× too big. Fixed with per-(fighter, pose)
  scale, described above.
- **`contact` computed per-fighter but stored as one shared field.** The loop that renders both
  fighters recomputed `contact` for each and simply overwrote the variable — the manifest ended up
  with whichever fighter was processed *last* (`aka`, alphabetically after `shiro` in dict order),
  which is how `low_block` initially shipped with a highly suspicious `contact: 0`. Fixed by summing
  both fighters' reach curves and picking the frame that maximizes the total, so the result no
  longer depends on iteration order and reflects both fighters' (mirrored) motion.

## 🧪 Verifying changes

There is no automated visual check checked into the repo (deliberately — the guidance for this
pipeline was to build throwaway verification scripts per session, not ship them). To re-verify by
eye after touching the script:

1. Run the tool for real (not `--dry-run`).
2. Composite each pose's frames into a filmstrip with a baseline guide line drawn across every
   cell, for both fighters.
3. Look for: feet on a common line, steady scale frame-to-frame, the `contact` frame actually being
   the furthest extension, no chopped limbs.
4. `pnpm validate:assets` must exit 0.

## 🗜️ Size

Measured 2026-09-27 on the full art set: **2.14MB across 6 pages** (3 per fighter), down from 3.29MB across 10 at quality 82 with the default encoder method. `method=6` does most of that work. A rebuild that needs fewer pages than the last one now deletes the extra page files and their provenance entries itself — before that, stale pages silently kept shipping in the bundle.
