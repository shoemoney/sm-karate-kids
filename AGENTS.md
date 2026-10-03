# SM Karate Kids: Asmongold vs HasanAbi 🥋

A deterministic twin-stick point-karate browser game, built with TypeScript, Vite, and Three.js.
Codename until *Karate Champ* rights are resolved — see `THIRD_PARTY_NOTICES.md`.

## 📦 Repository shape (real, not aspirational)

This is a **pnpm workspace monorepo** (`pnpm-workspace.yaml`: `packages/*`, `apps/*`).

| Path | What it is |
|---|---|
| `packages/sim` | Deterministic combat simulation: clock, input grammar, fighter/match state, CPU, replay checksum, and the Zod content schema (`packages/sim/src/content.ts`). No Three.js, no DOM, no network. |
| `packages/content` | Loads `data/*.json` (moves, fighters, arenas, rulesets), validates it through `packages/sim`'s `loadContent`, and exports the single validated `content` bundle. Importing `@smkk/content` is the only supported way to get game data. |
| `apps/game` | The Vite + Three.js browser client: rendering, input adapters, UI, Playwright e2e tests, static assets under `apps/game/public/`. |
| `tools/` | Standalone utilities, outside the workspace. See the table below. |
| `docs/adr/` | Architecture decision records. |

### `tools/` — what is actually in there

`tools/` is **not** a workspace package; it runs with `tsx` (`pnpm tsx tools/<file>`), except the
three shell/Python/Node tools, which have their own shebang or interpreter.

| Tool | Run it with | What it does |
|---|---|---|
| `balance-report.ts` | `pnpm tsx tools/balance-report.ts` | Seeded CPU-vs-CPU batch across all six archetype pairings; writes `docs/balance-data.json`. Findings in [`docs/balance.md`](docs/balance.md). |
| `validate-content.ts` | `pnpm validate:content` | Zod-checks `packages/content/data/*.json` and cross-checks it against the grammar. Part of `pnpm check` and CI. |
| `validate-assets.ts` | `pnpm validate:assets` | Provenance + size + ROM-extension checks over `apps/game/public/`, plus the art-manifest and wiring checks below. Part of `pnpm check` and CI. |
| `validate-assets-mutation.sh` | `bash tools/validate-assets-mutation.sh` | Proves the provenance gate can **fail** — 8 cases over throwaway fixture trees running the real validator (assets are one-byte stubs). Case 2 is the r150 regression: a nearer manifest's `approved: false` must beat a non-ancestor fallback's `approved: true`. Run it after touching precedence, discovery, or the approved check. |
| `art-manifest.tsv` | *(not run directly)* | **Single source of truth for the generated art set.** Tab-separated `name`/`maxWidth`/`alpha`/`prompt`, `#` for comments. Read by both shell scripts, cross-checked by `validate-assets.ts`. Adding a row is not enough on its own — the asset also needs a source PNG, an approved provenance entry, and a reference from `apps/game/src/`. |
| `gen-art.sh` | `bash tools/gen-art.sh [jobs]` | Generates the art set with the codex image tool, one process per asset in parallel. Derives the repo root from `BASH_SOURCE`, so it works from any clone or worktree. |
| `optimize-art.sh` | `bash tools/optimize-art.sh` | Downscales and converts `assets/generated/` → `apps/game/public/generated/*.webp` per the manifest's `maxWidth`/`alpha`. Also derives its root from `BASH_SOURCE`. |
| `build-fighter-atlas.py` | `python3 tools/build-fighter-atlas.py` | Segments the fighter contact sheets in `assets/` into the WebP atlases + `manifest.json`. **The source sheets are gitignored** — see [`docs/sprite-pipeline.md`](docs/sprite-pipeline.md) before running it. |
| `despeckle-fighters.py` | `python3 tools/despeckle-fighters.py` | Erases detached keyed fragments from the fighter atlases (islands of artwork beside the figure — usually a back hand the keyer separated from its sleeve). Five vision reviewers across four rounds reported the symptom and none could name it; this is the fix for the cause. |
| `shots.mjs` | `node tools/shots.mjs [outDir]` | Throwaway look-at-the-game screenshot harness. Not part of any gate. |
| `fps.mjs` | `node tools/fps.mjs` | Throwaway frame-rate / post-chain cost measurement. Not part of any gate. |
| `review-shots.mjs` | `node tools/review-shots.mjs [outDir]` | Plays a bout and captures the review frame set, plus `burst/` — 8 frames taken back to back from one played bout with the sim tick and fighter positions recorded per frame. **Regenerate before every review** — stale frames produced a false finding about already-fixed code at r127. |
| `verify_shots.py` | `python3 tools/verify_shots.py /tmp/smkk-loop` | Gate on the capture itself: frames distinct, non-flat, and a `burst/` proving the bout was played. A set that fails here was never a review set. Since r155 the motion check reads the **burst**, not the set — every top-level shot is its own cold page load, so filename adjacency is not time, and the old cross-screen metric passed a set containing no gameplay at all. |
| `verify-shots-mutation.sh` | `bash tools/verify-shots-mutation.sh` | Proves the capture gate can fail: 13 assertions over synthetic fixtures covering every branch — no burst, frozen ticks, a running clock on a still world, sub-threshold motion, byte-identical burst frames, a named-but-absent burst frame, duplicate/flat/too-few top-level frames, and a burst faked by a manifest. One case runs the **old algorithm verbatim** on data shaped like the r155 failure and gets a passing `motion 6.79` against its own 2.6 threshold — the defect, not its absence. Run it after touching `verify_shots.py` or the burst in `review-shots.mjs`. |
| `review-codex.sh` | `bash tools/review-codex.sh [shotsDir] [outJson]` | The advisory/consumer reviewer (codex → `openai/gpt-6.1-sol` via OpenRouter, computer use). Fails closed on an empty bearer or an empty answer rather than reporting a broken run as findings. |
| `vision-review.py` | `python3 tools/vision-review.py <model-id> <shotdir> [--out review.json]` | Sends the review frames to a vision model on OpenRouter as one multi-image turn and asks for exactly 5 concrete improvements. The other reviewer in `REVIEW-LOOP.md`. |
| `bench-server.mjs` | *(imported, not run)* | `startPreview(gameDir, port?)` — spawns a `vite preview` on **4188**, awaits until it actually answers, and kills it on the way out. A benchmark whose subject can vanish between the build and the measurement is measuring something else; a hand-started background server did exactly that and the next run died on `ERR_CONNECTION_REFUSED` with nothing naming the cause. |
| `renderer-bench.mjs` | `node tools/renderer-bench.mjs <label> [--frames N] [--gfx webgl\|webgpu]` | Measures the two numbers r145 needed: rAF **frame times**, and the **click** (`.result-rematch`, on a pinned tick) that is the actual CI failure. Measured on **separate page loads**, because the round card self-dismisses at 9s and one load measuring both gets `NEW TOURNAMENT` instead of the card. Software rendering is **forced** — measuring with a GPU measures a different machine than the one that fails. |
| `sweep.mjs` | *(imported, not run)* | The patch-build-measure-put-back lifecycle every sweep tool shares: snapshot source, apply edits, restore, **rebuild**, and assert `dist` is byte-identical to the build the sweep started from. Added at r154; see the note under the table. |
| `sweep-mutation.sh` | `bash tools/sweep-mutation.sh` | Proves the sweep guard can fail: 5 cases over real `vite build`s (~90s by design — a stubbed build cannot reproduce the disagreement). Covers an honest sweep, a stale `dist` (the r153/r154 defect), an unrestored source, a moved anchor, and that the harness itself ends with a clean tree. |
| `host-load.mjs` | `node tools/host-load.mjs` | The 1-minute load average, read once per bench row. Extracted at r154 from `renderer-bench.mjs`, where it had been reading **0** on every row since r145 (a brace-strip parse left a leading space, `split(/\s+/)` took `""`, `Number("")` is 0). Unreadable input is `null`, never 0. |
| `host-load-mutation.sh` | `bash tools/host-load-mutation.sh` | Proves the load reader can fail: 5 cases including **the r145 parse reproduced verbatim on live output**, so the old reader is demonstrably wrong rather than merely absent. Also: no `sysctl` on `PATH` is `null`/exit 7, not a quiet 0. |
| `css-literals.py` | `python3 tools/css-literals.py` | Counts the colour literals that break rule 3 (no literal outside `:root` / `body.high-contrast`) and prints **the line each one is on**. Comments are *deleted* rather than skipped, with line numbering verified identical to the raw file. The ratchet went ten → **0 at r157**, when all ten were transcribed into tokens that `body.high-contrast` can reach — see `contrast-reach.py` for the half a literal count can never show. |
| `css-literals-mutation.sh` | `bash tools/css-literals-mutation.sh` | Proves `css-literals.py` can fail: 8 assertions over throwaway fixture trees, one per branch — a new literal flagged, one inside `:root` and one inside bare `body.high-contrast` correctly excused, a literal in a **descendant** of `body.high-contrast` flagged (the defect the tool's first two drafts had), a literal inside a comment ignored, and comment-stripping proven not to move a line number. Self-locating, so a mutated copy of the harness tests the mutated tool beside it. |
| `renderer-sweep.mjs` | `node tools/renderer-sweep.mjs` | Frame-time across renderer configs by patching source, rebuilding, measuring and **reverting** every edit. The revert now covers the build too (`tools/sweep.mjs`). Numbers are **relative**: only the ratio between configs measured on the same host in the same session is comparable, which is what a look trade needs — and only when the two rows carry a real `load`, which is the column this row's numbers are worthless without. Tuned by `SWEEP_GFX` / `SWEEP_FRAMES`. |
| `throttle-cliff.mjs` | `CPU_LADDER=1,4,8,16 node tools/throttle-cliff.mjs` | Finds the CPU throttle rate at which the CI failure reproduces **locally**, then checks whether a candidate fix removes it at that rate. A lever that helps at 1× and does nothing at the cliff is not a fix. Same patch-and-revert anchors as the sweep, via `tools/sweep.mjs`. |
| `notation-probe.mjs` | `node tools/notation-probe.mjs [outPng]` | Every candidate half-point notation side by side, in the shipped font stack at the score's real 22px on the real plate. Not a gate — it is the **evidence** for a decision, and r148's reversal of the r36 rejection of U+00BD rests on it. Re-run it before arguing about score notation again. |
| `measure-score.mjs` | `node tools/measure-score.mjs` | The half-point score in boxes: `.score-frac` against `.points` and `.scoreline`, at 4 viewports, plus a **pixel count** of fraction ink falling outside the plate. Lands a real half through touch input with the stance stick held neutral — `match.ts` promotes the call to a full point when the defender is winding up, which is why the measurement was impossible for 31 rounds. `SMKK_BASE` to point at a server. |
| `scoreline-stability.mjs` | `node tools/scoreline-stability.mjs` | The scoreline in three states — no half, half landed, half +400ms/+1600ms — answering the question a still screenshot cannot: **does the HUD bar move when a score changes?** Found the +9.94px reflow that the r53..r147 stacked fraction caused. |
| `score-ink.mjs` | `SMKK_TARGET=1.5 node tools/score-ink.mjs` | Ink bounding boxes for the score digits and the half fraction, measured separately and **clamped to their own boxes**, so "is the fraction on the baseline" is a number. Also reports peak ink luminance, which is how r148 avoided lifting a colour that was already correct (241.8 vs 241.8). `SMKK_TARGET` sets the score to land — use ≥1.5, because 0.5 renders the fraction with no whole digit beside it. |
| `deploy.sh` | `bash tools/deploy.sh` | **RETIRED at r159 — deploys nothing, on purpose.** It rsynced to `shoemoney@192.168.1.10:.../arcade/smkk`, the old `arcade.shoemoney.ai` host, which is still up and still serving `td/` and `shoetris/` and therefore never looked broken. This game now ships at `arcade.shoemoney.com/karate-kids/`, owned by `~/Projects/SMA-arcade`, which deploys an **atomic release** (tar + `current` symlink flip + SQLite backup) behind a privacy-gate clearance receipt. It is not repointed because an rsync into `current/public/` would write *through* that symlink and skip both the backup and the receipt. The script now prints the real pipeline and exits 0. `tools/deploy-mutation.sh` was deleted with it; `verify-deploy-mutation.sh` independently proves the gate still fails correctly. |
| `verify-deploy.sh` | `bash tools/verify-deploy.sh [baseUrl]` | **Post-deploy gate. Defaults to `https://arcade.shoemoney.com/karate-kids/`** — repointed at r159 from the retired `arcade.shoemoney.ai/smkk/`, so it measures the origin this game actually ships from instead of scoring a host where it does not exist. Fetches the live `index.html`, compares it byte-for-byte with `apps/game/dist/index.html`, then fetches every asset the served html names and compares sha256 against the local file. Exit 0 = the served bytes are the built bytes. HTTP 200 proves nothing here; at r141 the site answered 200 for hours over a two-hour-old build. |
| `sheet-pause-probe.mjs` | `RUNS=2 node tools/sheet-pause-probe.mjs` | Walks the pre-bout card's TECHNIQUES journey in three arms — `early` (close inside the budget), `tap` (close after it), `control` (never tap) — and reports `CLAIM-TRUE` / `CLAIM-FALSE`, exiting 1 while the claim is false. **The `early` arm is the positive control and is not optional:** without it a probe that always answers "the card is gone" is indistinguishable from one that measures nothing. Exits 1 on the un-fixed build, 0 on the fixed one. Starts its own preview on 4188; **`SMKK_BASE` is not read** — to check production use `verify-deploy.sh`, which proves byte-identity, so local behaviour carries over. |
| `card-no-probe.mjs` | `CPU_LADDER=1 RUNS=4 node tools/card-no-probe.mjs` | How long boot takes from navigation to `__smkk.ready`, and whether the pre-bout card is still up when it lands. Loads **no in-page instrumentation at all** — every timestamp is taken from Node around Playwright's own waits, because the instrumented version of this probe (`card-window.mjs`, deleted) reported the card closed while it was plainly up for nine seconds: a `setTimeout(…,10)` poll starved to a 2.2s interval wrote both timestamps from one sample. **Prints `load1` on every row** and that column is load-bearing: this machine does not idle (~10–13 from other work), the e2e suite is red at load 14–16 and green at 8–10 on identical code, and r151 lost half an hour to 16 stray CPU burners from its own reproduction poisoning every measurement after them. Read the load before believing a row. |
| `verify-deploy-mutation.sh` | `bash tools/verify-deploy-mutation.sh` | Proves `verify-deploy.sh` can fail: 6 cases over a real local HTTP server (faithful copy, stale names, right-name/wrong-bytes, absent asset, dead origin, absent local build), asserting exit code **and** the diagnosis. Run it after touching the gate. |

| `coach-probe.mjs` | `node tools/coach-probe.mjs [baseUrl]` | **Does a first run actually get taught?** Walks the journey on a touch device across `/`, `?mode=tournament` and `?mode=dojo`, then the returning-player arm as a **control**. Exits 1 while a first run is not taught. Built at r157 after finding the coach had not rendered since r23 — `dismiss()` writes the "already seen" flag, and `clearBoutUi` calls it at boot. The positive arm matters: a probe that answers "no strip" about four different states has learned nothing. |
| `coach-legend-probe.mjs` | `node tools/coach-legend-probe.mjs` | **Does the coach plate read as two legends, or as one 4-column table?** The strip could not render before r157, so nothing had ever measured its geometry; at r158 the two halves turned out to wrap in **different arrow orders** (`◀▲▶▼` vs `◀▶▲▼`) with no rule between them. Asserts one arrow order, a visible divider, no spill past the content box, and — as a **separate exit 2** — that the game reached `fight` at all, so an environment failure can never be read as a verdict about the plate. `SMKK_BASE` to point at a server. |
| `coach-legend-mutation.sh` | `bash tools/coach-legend-mutation.sh` | Proves the probe can fail: 6 cases including **both control arms red separately** (strip never attached; strip permanent) and a baseline that must pass first. Mutates **source only** against a live dev server — no build, so it cannot leave `dist` describing a tree that no longer exists — and asserts its own files came back **byte-for-byte by checksum**, not by `git diff`, because the round's fix is uncommitted by design and `git diff` is red from the moment it starts. |
| `undefined-vars.py` | `python3 tools/undefined-vars.py` | Does any `var(--x)` read a token the stylesheet never declares? A custom property that is undeclared and read without a fallback resolves to **nothing**, so `background: var(--undefined)` computes to `rgba(0,0,0,0)` — the element has no background at all. This has cost the repo twice: `--font-display` in r16 (the game's name, round name and result headline in the browser default for sixteen rounds) and `--coach-plate` in r157 (the first-run coach had no plate and its text sat on the tatami). `css-literals.py` cannot see it — an undefined token has no literal to count. Proved in `tools/undefined-vars-mutation.sh` (9 cases incl. a negative control, and case 4 asserts the **false-positive** direction: a working `var(--x, 0.5)` fallback must not fail the gate). |
| `pixel-identity.mjs` | `node tools/pixel-identity.mjs <oldDist> <newDist>` | Did a stylesheet change change the picture, and only where it said? Two arms: **computed used values** (exhaustive, deterministic) and **pixels with a noise floor** measured from two loads of the same build, because the arena behind an overlay is frame-counter driven. Two bugs lived in the pixel arm and both reported "no change" for a change that had happened — the canvas was sized in CSS px against 2x device px, and `page.screenshot({clip})` returns an *already-cropped* image, so drawing it at `-clip.x * S` sampled empty space. `blank` is now asserted on: a crop that came back empty is not a crop that matched. Read `REVIEW-LOOP.md` r157 before trusting a `same` row. |
| `contrast-reach.py` | `python3 tools/contrast-reach.py` | The half `css-literals.py` cannot show: can `body.high-contrast` actually **reach** every colour decision? Checks the nine tokenised sites are declared, read and re-pointed, and censuses every colour token on `:root` the mode never overrides. Proved in `tools/contrast-reach-mutation.sh` (12 cases). |
| `keyhint-contrast.mjs` | `node tools/keyhint-contrast.mjs` | Reads **painted pixels** off a rendered frame to answer whether the desktop `.key-hint` takes part in high-contrast mode — a question no static stylesheet read can settle, because `#pad` composites `--pad-lip` and `--pad-wash` over an opaque gradient and the hint is thin 12px mono whose real ink is antialiased edge. Built at r153 to clear the blocker r152 left ("a paint-time value no static read can supply"), and it **refuted** the defect r152 expected: the hint was never too dim (9.07:1 in high-contrast) — it was *pinned*, the one faint label high-contrast did not lift. |
| `keyhint-contrast-mutation.sh` | `bash tools/keyhint-contrast-mutation.sh` | Proves the tool above can fail: 4 mutations asserting **both** the exit code and the diagnosis — re-inline the literal, a token whose HC value equals its normal value (so the gate cannot be passing by grepping for `var()`), a frozen control (**exit 2**, INCONCLUSIVE, proving the constant-false guard works), and a hint too dim for AA. |
| `keyboard-journey.mjs` | `node tools/keyboard-journey.mjs` | **Does a desktop player who reads the key hints actually control the fighter?** Item 1.1's `Accept:` line — "the keys appear on desktop and are absent on a 390px phone" — had only ever been settled by reading `display:block`/`display:none` off two viewports, which is a stylesheet fact, not a behaviour fact: "the glyphs render" is the button working perfectly. 17 arms walked on `__smkk.state()`: both hints present/absent, `KeyZ`/`KeyX` as a **negative control**, WASD walking with distances, W/S posture, arrows ×4, IJKL ×4 resolved to the **same four move ids**, and a journey arm that walks in, lands it and reads a point off the board. Reads `state()`, never `sticks()` — `sticks()` is `input.read()`, which advances the adapter's `previousRight` and would eat the very transitions being measured. Exits 1 while any arm fails. `SMKK_BASE` to point at a server (defaults to `http://127.0.0.1:5173`). |
| `keyboard-journey-mutation.sh` | `bash tools/keyboard-journey-mutation.sh` | Proves the probe above can fail: **9 cases, all red, each through an assertion** rather than an environment failure. Mutates **source only** against a live dev server (no build, so it cannot leave `dist` describing a tree that no longer exists) and restores by **checksum**, not `git diff` — the round's fix is uncommitted by design, so `git diff` is red from the moment it starts. Case 5b remaps walk to jump; case 7 swaps `KeyA`/`KeyD` so "walk toward the opponent" walks away, which **every single-key arm still passes** and only the journey arm catches; case 8 rebuilds the r159 defect (posture read from `phase`, which cannot express a jump or a crouch) and requires the probe to notice. Case 1 is a baseline that must pass first, or the harness is measuring a broken probe. |
| `loop-once.sh` | `bash tools/loop-once.sh` | One unattended review-loop iteration (the `launchd` driver). Takes the lock, builds the prompt, runs `opencode run`. |

The three `*deploy*` tools are the only ones in this table that need the network,
and **`verify-deploy.sh` is the only one that must be run against a real origin to
mean anything** — a deploy gate exercised only against `localhost` has not
exercised the deploy. None is in `pnpm check`, because `pnpm check` must stay
runnable offline.

**Where this game actually ships** — `https://arcade.shoemoney.com/karate-kids/`.
Repointed at r159. It used to be `arcade.shoemoney.ai/smkk/`, a *different machine*
(`68.185.216.69`) hosting the older arcade; that host is still up and still
serving `td/` and `shoetris/`, so nothing about it ever looked broken and the
gate just quietly measured the wrong bytes forever.

**The deploy belongs to another checkout.** `~/Projects/SMA-arcade` owns
`arcade.shoemoney.com` and deploys it atomically — payload → `public/` + `api/`,
a privacy-gate clearance receipt, tar to
`/var/www/arcade.shoemoney.com/releases/<id>`, a `current` symlink flip, and a
`shared/scores.sqlite` backup first. Follow its `upload-to-arcade` skill and its
`ops/build-release.py` + `ops/deploy.py`. `karate-kids` is already in both arcade
registries and in `ops/game-sources.json`, so shipping an update is a build and a
release, not an onboarding.

**Do not hand-roll a deploy into that tree.** `current/public/` is behind a
symlink an atomic flip owns; an rsync through it leaves a half-written game live
under a release that still claims to be good, and skips the backup and the
receipt. r141 lost four probes to the old root path and r148 lost a whole build to
the wrong username, which is why both are written down rather than re-derived —
but they now describe the *retired* path, kept in `tools/deploy.sh`'s header as
history.

`renderer-sweep.mjs` and `throttle-cliff.mjs` **edit `apps/game/src` to measure
it, rebuild, then revert** — a full `vite build` per configuration. Do not run
one while you have uncommitted work in the tree you would mind losing to a
killed run. They also each spawn their own preview on 4188 (see
`bench-server.mjs`), which is deliberately *not* the e2e suite's 4173 so the two
cannot collide.

Both get that lifecycle from **`tools/sweep.mjs`** (`createSweep`), which since
r154 restores the source **and the build**, and then checks that `apps/game/dist`
is byte-identical to what it was when the sweep started. The check matters more
than the restore: `tools/verify-deploy.sh` compares dist against the wire, so a
sweep that leaves a mutated build behind makes the next round read "production
is stale" about a production that is correct — and redeploying pushes a build
assembled from whichever mutation was last. r154 reproduced exactly that through
a **crash** path, where the `process.on('exit')` handler restored source over a
mutated build. A sweep that ends dirty now throws, and a killed one warns to
stderr and tells you to rebuild. Proved in `tools/sweep-mutation.sh`.

Two modules in `apps/game/src` are the runtime half of the art story: **`artLoader.ts`** is the one
door every generated texture comes through (it returns `null` and warns on a miss, so a missing file
degrades to the procedural room rather than a blank canvas), and **`bootScreen.ts`** owns the
pre-boot publisher card. Neither is in `tools/`; neither is part of any gate either.

The PRD (the product spec, kept out of the public repository) describes a larger eventual package split (`renderer`, `input`, `audio`,
`replay`, `ai-pipeline`, `apps/studio`, `apps/api`). None of that exists yet — this file describes
the repo as it actually is today. Update this section when packages are added or split.

## ⚙️ Commands (the real ones — read `package.json` before trusting any doc, including this one)

```bash
pnpm install              # install workspace deps
pnpm dev                  # -> pnpm --filter @smkk/game dev (Vite dev server)
pnpm build                # -> pnpm --filter @smkk/game build
pnpm preview              # -> pnpm --filter @smkk/game preview
pnpm typecheck            # tsc -b --force (packages/sim, packages/content, apps/game) + tools/
pnpm test                 # vitest run (unit + simulation tests)
pnpm test:e2e             # -> builds the bundle, then playwright test against it
pnpm validate:content     # tsx tools/validate-content.ts
pnpm validate:assets      # tsx tools/validate-assets.ts
pnpm check                # typecheck && test && validate:content && validate:assets
```

⚠️ `pnpm check` does **not** run `pnpm build` or `pnpm test:e2e` — CI (`.github/workflows/ci.yml`)
does, plus a secret scan. If your change touches rendering, input adapters, or
anything under `apps/game/src`, run `pnpm test:e2e` yourself before opening a PR;
don't rely on `pnpm check` alone to catch it.

`pnpm test:e2e` **builds before it tests**, on purpose. The Playwright config serves
`apps/game/dist/` via `vite preview`, so a suite that doesn't rebuild will happily pass
against whatever bundle was last on disk — the whole browser gate can go green on
arbitrarily old source. Don't add a separate `pnpm build` in front of it; that's the
one thing this is guarding against. For the same reason CI has no standalone build step.

⚠️ Locally, `reuseExistingServer` is **on**, and the suite's port is **4173**. If any other
project on the machine is squatting on 4173, Playwright silently reuses that foreign server
and you get a cascade of failures that have nothing to do with your change. Check first:

```bash
lsof -ti:4173   # must print nothing before you trust an e2e run
```

There is currently no `pnpm lint` script. Don't invent one in CI or docs until it exists.

## 🧱 Architecture rules

- `packages/sim` is deterministic and may **not** import Three.js, DOM/browser APIs, audio,
  network clients, fal, or OpenRouter. It only accepts normalized input frames (`StickPair` /
  `InputFrame` in `packages/sim/src/input.ts`) and emits deterministic events.
- Gameplay is fixed-step at 60 Hz. Render interpolation is presentation-only, lives in `apps/game`.
- Move, fighter, ruleset, and arena data is Zod-validated (`packages/sim/src/content.ts`) and lives
  in `packages/content/data/*.json`. Never construct a `ContentBundle` by hand at runtime — import
  `@smkk/content`.
- Never place secrets in code, logs, fixtures, screenshots, or the client bundle.
- Generated (AI or otherwise non-original) assets require a provenance record in a
  `PROVENANCE.json` manifest and human approval (`approved: true`) before runtime import.
  `tools/validate-assets.ts` discovers those manifests per directory — a new asset directory gets
  its own `PROVENANCE.json` and nothing else has to be edited. See `docs/asset-provenance.md`.
- No health bars or damage accumulation in Classic Rules — one clean contact ends the exchange,
  the referee calls half or full point, first to `pointsToWin` wins.
- Add tests before changing command parsing, scoring, timer, or replay formats.
- Run `pnpm check` before declaring a task complete; run `pnpm test:e2e` too if you
  touched `apps/game` (it builds the bundle it tests, so it needs no `pnpm build` first).

### ⏳ The boot screen (presentation only)

- The first paint before boot is a branded card in `apps/game/index.html`, owned by
  `apps/game/src/bootScreen.ts`. It is plain markup, so it is up before a single module of
  `main.ts` has run — a cold phone never shows a black canvas.
- Its progress bar tracks **completed units of real boot work**, weighted by cost. It is never
  animated on a timer, and the card only lifts once a frame has actually been drawn.
- Nothing in it is focusable and it never calls `focus()`. Two e2e tests assert that typing keeps
  working through a whole bout; a splash that grabbed the caret would break them.
- It is still presentation-only — it must not reach into the simulation any more than the HUD does.

### 📱 Mobile-first (standing rule, added 2026-09-27 — see `docs/adr/0001-mobile-first-twin-stick.md`)

- **Portrait phone (390×844) is the design baseline.** Design layout, HUD, and touch targets for
  that viewport first; desktop is a scaled-up secondary target, not the default assumption.
- **Touch is the primary input.** Keyboard and gamepad are supported, secondary adapters that
  produce the same `StickPair` shape — they do not get first claim on layout or UX decisions.
- The twin-stick command grammar itself never changes for touch: every input device is an adapter
  emitting the same normalized `StickPair`/`InputFrame`, and `packages/sim` never learns which
  device is driving it.

### 🥋 Brand marks (standing rule)

- **Two ShoeMoney brand assets ship, and both are proprietary.**
  - `apps/game/public/brand/shoemoney-emblem.png` — the emblem on both fighters' gi chests, and
    the favicon.
  - `apps/game/public/brand/shoemoney-logo.png` / `.webp` — the publisher mark on the pre-boot
    card. The PNG is the conversion input; the WebP is what ships and what the card preloads.
- Both are carved out of this repo's MIT grant (see `THIRD_PARTY_NOTICES.md` and
  `apps/game/public/brand/PROVENANCE.json`). Don't remove either, replace them with a generic
  logo, recolour or distort them, or license them separately without checking with the project
  owner first.

## 🔁 Workflow

- Implement the smallest vertical slice first.
- Keep commits scoped and reversible.
- Record architectural decisions in `docs/adr/`.
- Don't add a dependency when a small local module is sufficient.
- Never claim historical fidelity to the original *Karate Champ* without a cited reference and a
  golden test — see the product spec, section "Rights and provenance" and "Original design findings".
