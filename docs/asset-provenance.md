# Asset Provenance Policy 🖼️

Every binary asset that ships in this game must be traceable: where it came from, who owns it,
what license it's under, and who approved it for runtime use. This document is the policy;
`tools/validate-assets.ts` is the enforcement.

## The rules

1. **Every shipped asset needs a provenance record.** Any binary file under `apps/game/public/`
   (images, audio, models, fonts, whatever comes next) must have a matching entry in a
   `PROVENANCE.json` manifest — currently `apps/game/public/brand/PROVENANCE.json` for the
   `brand/` directory. As more asset directories are added, they get their own manifest following
   the same shape, or the schema/validator gets extended to look in more places. Don't ship an
   asset the validator can't see.

2. **Generated assets need human approval before runtime import.** "Generated" means anything
   produced by an AI model (fal, image/3D generation, etc.) rather than authored or licensed
   directly. A generated asset is not runtime-ready just because a model produced it — a human has
   to look at it, confirm it's fit for use (topology, likeness, licensing terms of the generating
   service), and only then flip its provenance entry's `approved` field to `true`. Never set
   `approved: true` on a generated asset just to make a validator pass.

3. **No ROM-derived art or audio, ever.** No extracted sprites, tile data, cabinet scans, or sound
   samples from the original 1984 *Karate Champ* release (or any other emulated/ROM source) may
   enter this repository, public or private branch, at any point. `tools/validate-assets.ts`
   enforces this at the file-extension level (rejecting `.rom`, `.bin`, `.zip`, `.7z` anywhere
   under `apps/game/public/`) as a backstop, but the real rule is broader than any extension
   check: **don't put ROM-derived material in this repo, full stop.** See the product spec, section "Rights and
   provenance."

4. **Brand marks are carved out of the MIT grant.** This repository's code and project-authored
   docs are MIT licensed. Brand marks — currently the ShoeMoney emblem
   (`apps/game/public/brand/shoemoney-emblem.png`) — are not. Their provenance entries must say so
   explicitly (see the `license` field convention below), and `THIRD_PARTY_NOTICES.md` must list
   them.

## Provenance manifest shape

Each `PROVENANCE.json` is a flat map from **asset path relative to `apps/game/public/`** (forward
slashes, no leading slash) to a provenance entry:

```json
{
  "brand/shoemoney-emblem.png": {
    "source": "where the file actually came from — be specific enough to re-derive it",
    "license": "the license or usage terms it's under",
    "holder": "who owns the rights",
    "approved": true,
    "notes": "anything a reviewer needs that doesn't fit the fields above"
  }
}
```

`source`, `license`, and `holder` must be non-empty strings. `approved` must be the boolean `true`
for an asset to pass validation — there is no partial-credit state; an asset is either approved for
runtime use or it doesn't ship.

## What the validator checks

`pnpm validate:assets` (`tools/validate-assets.ts`) walks `apps/game/public/` and, for every file
that isn't a provenance manifest itself, asserts:

- it exists and is non-empty
- it is under 512 KB
- it has a matching entry in `apps/game/public/brand/PROVENANCE.json`
- that entry has non-empty `source`, `license`, and `holder`, and `approved === true`

It also asserts, across every file under `apps/game/public/` regardless of provenance status, that
no file uses a forbidden extension (`.rom`, `.bin`, `.zip`, `.7z`).

Run it after adding or changing any file under `apps/game/public/`. It's also part of
`pnpm check` and CI (`.github/workflows/ci.yml`), so a missing or incomplete provenance record
blocks the pull request rather than shipping quietly.
