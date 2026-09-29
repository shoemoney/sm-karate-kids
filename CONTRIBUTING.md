# Contributing to SM Karate Kids: Asmongold vs HasanAbi 🥋

Thanks for taking a swing at this. A few things before you throw a `reverse_punch` at the codebase.

## 📜 License terms for contributions

This project is **MIT licensed** (`LICENSE`). By opening a pull request you agree your
contribution is licensed under the same MIT terms — **inbound = outbound**, no separate CLA or
DCO required right now. That may change (a CLA/DCO gets added only if counsel or the project owner
later requires one) — this file will say so clearly if it does.

The MIT grant covers this repository's original code and project-authored documentation only. It
does **not** cover the ShoeMoney brand marks or the fighter sprite atlases (all Jeremy
Schoemaker's own work, used with permission), or the *Karate Champ* name and any other Data
East / G-MODE / Technōs intellectual property. See `THIRD_PARTY_NOTICES.md`.

## 🛠️ Getting set up

```bash
git clone <this repo>
cd sm-karate-kids
pnpm install
pnpm dev            # Vite dev server for apps/game
```

Read `CLAUDE.md` first — it has the real command list and the architecture rules (what
`packages/sim` may and may not import, the mobile-first standing rule, the ShoeMoney brand-marks
standing rule, and the `tools/` table). It is a byte-for-byte mirror of `AGENTS.md`; if they ever
disagree with `package.json`, `package.json` wins and the docs need a fix.

## ✅ Before opening a pull request

Run the full check locally:

```bash
pnpm check          # typecheck + unit tests + content validation + asset validation
```

If your change touches `apps/game` (rendering, input adapters, UI), also run:

```bash
pnpm test:e2e
```

No `pnpm build` first — `pnpm test:e2e` builds the bundle it serves. Running the browser
suite against a `dist/` you forgot to rebuild is how a green suite ends up testing last
week's code.

Locally the suite reuses an existing server on port **4173** if it finds one, so a stray
`vite preview` from another repo turns into a cascade of failures that have nothing to do with
your change. Check `lsof -ti:4173` first — it should print nothing.

CI (`.github/workflows/ci.yml`) runs all of the above plus a secret scan on every push and pull
request — it will not pass just because `pnpm check` passed locally if you skipped the e2e
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

Every binary asset shipped under `apps/game/public/` needs a provenance entry with a non-empty
`source`, `license`, `holder`, and `approved: true` (see `docs/asset-provenance.md` for the shape).
`pnpm validate:assets` enforces this, plus a 512 KB per-file size cap and a ban on ROM-adjacent file
extensions (`.rom`, `.bin`, `.zip`, `.7z`) — **no extracted ROM art, sprites, recordings, or cabinet
scans**, ever, per the product spec, section "Rights and provenance".

**You do not have to register a new directory anywhere.** The validator *discovers* every
`PROVENANCE.json` under `apps/game/public/` and applies the nearest one to each asset, so adding
`apps/game/public/<newdir>/` plus a `PROVENANCE.json` next to it is the whole job. Two exist today:
`brand/PROVENANCE.json` (also covering `fighters/`) and `generated/PROVENANCE.json`.

Generated (AI-produced or otherwise non-original) assets need human review and `approved: true`
before they're wired into runtime code — don't set that flag yourself just to unblock a validator.

### The generated art set has extra rules

`apps/game/public/generated/` is guarded more tightly than provenance alone, so a half-finished art
drop can't pass:

- `tools/art-manifest.tsv` is the single source of truth, read by both `tools/gen-art.sh` and
  `tools/optimize-art.sh`. Add a row there — name, maxWidth, alpha, prompt.
- Every shipped `generated/*.webp` must be **referenced from app source** (`apps/game/src/` or
  `apps/game/index.html`). Assets loaded through `artLoader.ts` count; an asset nothing loads is a
  build failure.
- The manifest and the shipped files must agree **both ways** — no manifest row without a file, no
  file without a row.

Adding a row is not enough on its own: you also need a source PNG in `assets/generated/`, an
approved `generated/PROVENANCE.json` entry, and the reference from app source. Then run
`tools/optimize-art.sh` and `pnpm validate:assets`.

## 🐛 Reporting bugs / proposing features

Open an issue with repro steps (for bugs) or the problem you're trying to solve (for features).
For anything security-related, see `SECURITY.md` instead of a public issue.

## 🤝 Code of conduct

This project follows the Contributor Covenant — see `CODE_OF_CONDUCT.md`.
