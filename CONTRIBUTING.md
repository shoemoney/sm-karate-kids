# Contributing to ShoeMoney Karate Kids 🥋

Thanks for taking a swing at this. A few things before you throw a `reverse_punch` at the codebase.

## 📜 License terms for contributions

This project is **MIT licensed** (`LICENSE`). By opening a pull request you agree your
contribution is licensed under the same MIT terms — **inbound = outbound**, no separate CLA or
DCO required right now. That may change (a CLA/DCO gets added only if counsel or the project owner
later requires one) — this file will say so clearly if it does.

The MIT grant covers this repository's original code and project-authored documentation only. It
does **not** cover the ShoeMoney brand mark, or the *Karate Champ* name and any other Data
East / G-MODE / Technōs intellectual property. See `THIRD_PARTY_NOTICES.md`.

## 🛠️ Getting set up

```bash
git clone <this repo>
cd sm-karate-kids
pnpm install
pnpm dev            # Vite dev server for apps/game
```

Read `CLAUDE.md` first — it has the real command list and the architecture rules (what
`packages/sim` may and may not import, the mobile-first standing rule, the ShoeMoney-emblem
standing rule). It is kept in sync with `package.json`; if they ever disagree, `package.json` wins
and `CLAUDE.md` needs a fix.

## ✅ Before opening a pull request

Run the full check locally:

```bash
pnpm check          # typecheck + unit tests + content validation + asset validation
```

If your change touches `apps/game` (rendering, input adapters, UI), also run:

```bash
pnpm build
pnpm test:e2e
```

CI (`.github/workflows/ci.yml`) runs all of the above plus a secret scan on every push and pull
request — it will not pass just because `pnpm check` passed locally if you skipped the build/e2e
step.

## 🧩 Adding or changing game content

Moves, fighters, arenas, and rulesets live as JSON under `packages/content/data/`, validated by
Zod schemas in `packages/sim/src/content.ts`. `pnpm validate:content` is the fast feedback loop —
run it after any content edit. It checks (among other things):

- Every technique the twin-stick grammar can produce has frame data, and every move in the data
  files is reachable from the grammar (no orphans).
- No duplicate ids within moves, fighters, arenas, or rulesets.
- Every move's active window is at least 1 tick and its startup is under 40 ticks.
- Both fighters have distinct ids and valid hex colors.
- At least one arena and one ruleset exist, and the `classic` ruleset's `pointsToWin` is 2.

## 🖼️ Adding assets

Every binary asset shipped under `apps/game/public/` needs a provenance entry (see
`docs/asset-provenance.md` and `apps/game/public/brand/PROVENANCE.json` for the shape) with a
non-empty `source`, `license`, `holder`, and `approved: true`. `pnpm validate:assets` enforces
this, plus a 512 KB per-file size cap and a ban on ROM-adjacent file extensions (`.rom`, `.bin`,
`.zip`, `.7z`) — **no extracted ROM art, sprites, recordings, or cabinet scans**, ever, per
the product spec, section "Rights and provenance".

Generated (AI-produced or otherwise non-original) assets need human review and `approved: true`
before they're wired into runtime code — don't set that flag yourself just to unblock a validator.

## 🐛 Reporting bugs / proposing features

Open an issue with repro steps (for bugs) or the problem you're trying to solve (for features).
For anything security-related, see `SECURITY.md` instead of a public issue.

## 🤝 Code of conduct

This project follows the Contributor Covenant — see `CODE_OF_CONDUCT.md`.
