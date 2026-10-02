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
| `review-shots.mjs` | `node tools/review-shots.mjs /tmp/smkk-loop` | Plays a bout and captures the review frame set. **Regenerate before every review** — stale frames produced a false finding about already-fixed code at r127. |
| `verify_shots.py` | `python3 tools/verify_shots.py /tmp/smkk-loop` | Gate on the capture itself: frames distinct, non-flat, and moving. A set that fails here was never a review set. |
| `review-codex.sh` | `bash tools/review-codex.sh [shotsDir] [outJson]` | The advisory/consumer reviewer (codex → `openai/gpt-6.1-sol` via OpenRouter, computer use). Fails closed on an empty bearer or an empty answer rather than reporting a broken run as findings. |
| `vision-review.py` | `python3 tools/vision-review.py <model-id> <shotdir> [--out review.json]` | Sends the review frames to a vision model on OpenRouter as one multi-image turn and asks for exactly 5 concrete improvements. The other reviewer in `REVIEW-LOOP.md`. |
| `bench-server.mjs` | *(imported, not run)* | `startPreview(gameDir, port?)` — spawns a `vite preview` on **4188**, awaits until it actually answers, and kills it on the way out. A benchmark whose subject can vanish between the build and the measurement is measuring something else; a hand-started background server did exactly that and the next run died on `ERR_CONNECTION_REFUSED` with nothing naming the cause. |
| `renderer-bench.mjs` | `node tools/renderer-bench.mjs <label> [--frames N] [--gfx webgl\|webgpu]` | Measures the two numbers r145 needed: rAF **frame times**, and the **click** (`.result-rematch`, on a pinned tick) that is the actual CI failure. Measured on **separate page loads**, because the round card self-dismisses at 9s and one load measuring both gets `NEW TOURNAMENT` instead of the card. Software rendering is **forced** — measuring with a GPU measures a different machine than the one that fails. |
| `renderer-sweep.mjs` | `node tools/renderer-sweep.mjs` | Frame-time across renderer configs by patching source, rebuilding, measuring and **reverting** every edit, so the tree ends the run as it started. Numbers are **relative**: only the ratio between configs measured on the same host in the same session is comparable, which is what a look trade needs. Tuned by `SWEEP_GFX` / `SWEEP_FRAMES`. |
| `throttle-cliff.mjs` | `CPU_LADDER=1,4,8,16 node tools/throttle-cliff.mjs` | Finds the CPU throttle rate at which the CI failure reproduces **locally**, then checks whether a candidate fix removes it at that rate. A lever that helps at 1× and does nothing at the cliff is not a fix. Same patch-and-revert anchors as the sweep. |
| `notation-probe.mjs` | `node tools/notation-probe.mjs [outPng]` | Every candidate half-point notation side by side, in the shipped font stack at the score's real 22px on the real plate. Not a gate — it is the **evidence** for a decision, and r148's reversal of the r36 rejection of U+00BD rests on it. Re-run it before arguing about score notation again. |
| `measure-score.mjs` | `node tools/measure-score.mjs` | The half-point score in boxes: `.score-frac` against `.points` and `.scoreline`, at 4 viewports, plus a **pixel count** of fraction ink falling outside the plate. Lands a real half through touch input with the stance stick held neutral — `match.ts` promotes the call to a full point when the defender is winding up, which is why the measurement was impossible for 31 rounds. `SMKK_BASE` to point at a server. |
| `scoreline-stability.mjs` | `node tools/scoreline-stability.mjs` | The scoreline in three states — no half, half landed, half +400ms/+1600ms — answering the question a still screenshot cannot: **does the HUD bar move when a score changes?** Found the +9.94px reflow that the r53..r147 stacked fraction caused. |
| `score-ink.mjs` | `SMKK_TARGET=1.5 node tools/score-ink.mjs` | Ink bounding boxes for the score digits and the half fraction, measured separately and **clamped to their own boxes**, so "is the fraction on the baseline" is a number. Also reports peak ink luminance, which is how r148 avoided lifting a colour that was already correct (241.8 vs 241.8). `SMKK_TARGET` sets the score to land — use ≥1.5, because 0.5 renders the fraction with no whole digit beside it. |
| `deploy.sh` | `bash tools/deploy.sh [--yes] [--no-verify]` | **The deploy itself.** Refuses a missing or stale build (dist older than the source it claims to represent), dry-runs and prints the `--delete` list by default, pushes with `rsync --delay-updates` so the new html can never precede its bundle, then **propagates `verify-deploy.sh`'s exit code** rather than reporting its own success. `--yes` is required to send anything. Deploys as `shoemoney@192.168.1.10`; **not** `root`, which refuses the key. |
| `verify-deploy.sh` | `bash tools/verify-deploy.sh [baseUrl]` | **Post-deploy gate.** Fetches the live `index.html`, compares it byte-for-byte with `apps/game/dist/index.html`, then fetches every asset the served html names and compares sha256 against the local file. Exit 0 = the served bytes are the built bytes. HTTP 200 proves nothing here; at r141 the site answered 200 for hours over a two-hour-old build. |
| `verify-deploy-mutation.sh` | `bash tools/verify-deploy-mutation.sh` | Proves `verify-deploy.sh` can fail: 6 cases over a real local HTTP server (faithful copy, stale names, right-name/wrong-bytes, absent asset, dead origin, absent local build), asserting exit code **and** the diagnosis. Run it after touching the gate. |
| `deploy-mutation.sh` | `bash tools/deploy-mutation.sh` | Proves `deploy.sh` can fail: 12 assertions over a real HTTP server on a throwaway local root — never production. Covers the dry run sending nothing, a faithful deploy, a changed build pruning its superseded hashed asset, and the refusals: no build (exit 2), a build older than the source, unreachable host. Run it after touching `deploy.sh`. |
| `loop-once.sh` | `bash tools/loop-once.sh` | One unattended review-loop iteration (the `launchd` driver). Takes the lock, builds the prompt, runs `opencode run`. |

The four `*deploy*` tools are the only ones in this table that need the network,
and `deploy.sh` / `verify-deploy.sh` are the only two that must be run against a
real origin to mean anything — a deploy gate exercised only against `localhost`
has not exercised the deploy. None of the four is in `pnpm check`, because
`pnpm check` must stay runnable offline.

**Deploy root** — `/mnt/.ix-apps/app_mounts/nginx-proxy-manager/data/arcade/smkk`
on `192.168.1.10`, owned by `shoemoney`. It is **not** under `/mnt/tank`. r141
lost four probes to this path and r148 lost a whole build to the wrong username,
so both are recorded in `tools/deploy.sh`'s header rather than re-derived.

`renderer-sweep.mjs` and `throttle-cliff.mjs` **edit `apps/game/src` to measure
it, rebuild, then revert** — a full `vite build` per configuration. Do not run
one while you have uncommitted work in the tree you would mind losing to a
killed run, and re-read `git status` afterwards rather than trusting the exit
code. They also each spawn their own preview on 4188 (see `bench-server.mjs`),
which is deliberately *not* the e2e suite's 4173 so the two cannot collide.

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
