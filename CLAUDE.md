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
| `tools/` | Standalone utilities: balance-report harness (`balance-report.ts`), content validator (`validate-content.ts`), asset validator (`validate-assets.ts`). Run with `tsx`. |
| `docs/adr/` | Architecture decision records. |

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
pnpm test:e2e             # -> pnpm --filter @smkk/game test:e2e (playwright test)
pnpm validate:content     # tsx tools/validate-content.ts
pnpm validate:assets      # tsx tools/validate-assets.ts
pnpm check                # typecheck && test && validate:content && validate:assets
```

⚠️ `pnpm check` does **not** run `pnpm build` or `pnpm test:e2e` — CI (`.github/workflows/ci.yml`)
does, in that order, plus a secret scan. If your change touches rendering, input adapters, or
anything under `apps/game/src`, run `pnpm build && pnpm test:e2e` yourself before opening a PR;
don't rely on `pnpm check` alone to catch it.

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
- Generated (AI or otherwise non-original) assets require a provenance record in
  `apps/game/public/brand/PROVENANCE.json` (or the equivalent manifest for their directory) and
  human approval (`approved: true`) before runtime import. See `docs/asset-provenance.md`.
- No health bars or damage accumulation in Classic Rules — one clean contact ends the exchange,
  the referee calls half or full point, first to `pointsToWin` wins.
- Add tests before changing command parsing, scoring, timer, or replay formats.
- Run `pnpm check` before declaring a task complete; run `pnpm build && pnpm test:e2e` too if you
  touched `apps/game`.

### 📱 Mobile-first (standing rule, added 2026-09-27 — see `docs/adr/0001-mobile-first-twin-stick.md`)

- **Portrait phone (390×844) is the design baseline.** Design layout, HUD, and touch targets for
  that viewport first; desktop is a scaled-up secondary target, not the default assumption.
- **Touch is the primary input.** Keyboard and gamepad are supported, secondary adapters that
  produce the same `StickPair` shape — they do not get first claim on layout or UX decisions.
- The twin-stick command grammar itself never changes for touch: every input device is an adapter
  emitting the same normalized `StickPair`/`InputFrame`, and `packages/sim` never learns which
  device is driving it.

### 🥋 Brand mark (standing rule)

- **The ShoeMoney emblem appears on both fighters' gi chests.** The asset lives at
  `apps/game/public/brand/shoemoney-emblem.png`; its provenance entry is proprietary and carved out
  of this repo's MIT grant (see `THIRD_PARTY_NOTICES.md` and
  `apps/game/public/brand/PROVENANCE.json`). Don't remove it, replace it with a generic logo, or
  license it separately without checking with the project owner first.

## 🔁 Workflow

- Implement the smallest vertical slice first.
- Keep commits scoped and reversible.
- Record architectural decisions in `docs/adr/`.
- Don't add a dependency when a small local module is sufficient.
- Never claim historical fidelity to the original *Karate Champ* without a cited reference and a
  golden test — see the product spec, section "Rights and provenance" and "Original design findings".
