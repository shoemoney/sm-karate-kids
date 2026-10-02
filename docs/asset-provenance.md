# Asset Provenance Policy 🖼️

Every binary asset that ships in this game must be traceable: where it came from, who owns it,
what license it's under, and who approved it for runtime use. This document is the policy;
`tools/validate-assets.ts` is the enforcement.

## The rules

1. **Every shipped asset needs a provenance record, and the manifest is found by
   convention.** Any binary file under `apps/game/public/` (images, audio, models, fonts,
   whatever comes next) must have a matching entry in a `PROVENANCE.json` manifest. The validator
   **discovers** those manifests rather than hardcoding their paths: every directory under
   `apps/game/public/` may carry its own `PROVENANCE.json`, and the one that governs an asset is
   the **nearest ancestor** manifest — a directory's own record wins over the root one. Every
   manifest is also consulted, so a root entry still covers a file a nearer manifest simply
   doesn't mention.

   > **Enforced since r150.** This was documented twice and implemented as neither: the validator
   > took the first manifest that happened to carry the key, over an unsorted `readdirSync`. Since
   > there is no manifest at the public root, `brand/PROVENANCE.json` covers `fighters/` as a
   > *fallback* rather than an ancestor — and `brand` sorts before `fighters`, so a nearer
   > `fighters/PROVENANCE.json` marking an asset `approved: false` was silently ignored and
   > `brand`'s `approved: true` won. Nearest-ancestor is now resolved explicitly, deepest first,
   > with non-ancestors consulted afterwards in a stable order so the verdict is a property of the
   > tree rather than of the filesystem. `tools/validate-assets-mutation.sh` proves it can fail.

   Two exist today: `apps/game/public/brand/PROVENANCE.json` (the root manifest — it also
   covers `fighters/`) and `apps/game/public/generated/PROVENANCE.json` (the generated dojo and
   juice art). **Adding an asset directory means adding one `PROVENANCE.json` next to it —
   nothing in the validator has to change.** Don't ship an asset the validator can't see.

2. **Generated assets need human approval before runtime import.** "Generated" means anything
   produced by an AI model (fal, image/3D generation, codex's image tool, etc.) rather than
   authored or licensed directly. A generated asset is not runtime-ready just because a model
   produced it — a human has to look at it, confirm it's fit for use (topology, likeness, licensing
   terms of the generating service), and only then flip its provenance entry's `approved` field to
   `true`. Never set `approved: true` on a generated asset just to make a validator pass.

3. **No ROM-derived art or audio, ever.** No extracted sprites, tile data, cabinet scans, or sound
   samples from the original 1984 *Karate Champ* release (or any other emulated/ROM source) may
   enter this repository, public or private branch, at any point. `tools/validate-assets.ts`
   enforces this at the file-extension level (rejecting `.rom`, `.bin`, `.zip`, `.7z` anywhere
   under `apps/game/public/`) as a backstop, but the real rule is broader than any extension
   check: **don't put ROM-derived material in this repo, full stop.** See the product spec, section "Rights and
   provenance."

4. **Brand marks and the fighter artwork are carved out of the MIT grant.** This repository's code
   and project-authored docs are MIT licensed. Two things are not:
   - The **ShoeMoney brand marks** — the emblem on the fighters' gi
     (`apps/game/public/brand/shoemoney-emblem.png`, also the favicon) and the publisher mark on the
     pre-boot card (`apps/game/public/brand/shoemoney-logo.png` / `.webp`).
   - The **fighter sprite atlases** in `apps/game/public/fighters/` — Jeremy Schoemaker's own
     artwork, which carries the emblem.

   Their provenance entries must say so explicitly (see the `license` field convention below), and
   `THIRD_PARTY_NOTICES.md` must list them.

5. **A shipped generated asset has to be reachable from the app.** Provenance answers "may we ship
   this?"; it does not answer "does anything load it?". `tools/validate-assets.ts` therefore
   refuses a `public/generated/*.webp` whose name appears nowhere in `apps/game/src/` or
   `apps/game/index.html`. The check is deliberately scoped to `generated/`: the `fighters/*.webp`
   pages are addressed through computed names from the atlas manifest, so a literal grep there would
   be all false positives.

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
- it has a matching entry in a discovered `PROVENANCE.json` (nearest ancestor wins)
- that entry has non-empty `source`, `license`, and `holder`, and `approved === true`

It also asserts, across every file under `apps/game/public/` regardless of provenance status, that
no file uses a forbidden extension (`.rom`, `.bin`, `.zip`, `.7z`).

### The generated art set gets four more

`apps/game/public/generated/` is the one place where provenance alone was not enough, so it is
checked against `tools/art-manifest.tsv` as well — the tab-separated manifest that
`gen-art.sh` and `optimize-art.sh` both read:

- **the manifest parses.** Four tab-separated columns per row (`name`, `maxWidth`, `alpha`,
  `prompt`), a non-empty prompt, `alpha` exactly `yes` or `no`, a positive integer `maxWidth`, no
  duplicate names, and at least one row. `#` starts a comment.
- **every manifest row is approved** in `apps/game/public/generated/PROVENANCE.json` with
  `approved: true`. The manifest cannot be the way an unapproved asset gets in.
- **every shipped `generated/*.webp` is referenced from app source**, and **every manifest row has a
  matching shipped `.webp`** — in both directions, so a row added without regenerating (or an asset
  regenerated without a row) is a build failure rather than a surprise at art time. The orphan case
  is the one that costs real money: a texture nothing draws is tens or hundreds of KB of download
  for a black rectangle.
- **the provenance manifest itself parses** as valid JSON, discovered by walking for
  `PROVENANCE.json` — a new asset directory needs no code change to be covered.

Run it after adding or changing any file under `apps/game/public/`, after adding a row to
`tools/art-manifest.tsv`, and after wiring a new texture into the app. It's also part of
`pnpm check` and CI (`.github/workflows/ci.yml`), so a missing or incomplete provenance record
blocks the pull request rather than shipping quietly.

### The one asset the validator deliberately does not police

`apps/game/public/fighters/manifest.json` is validated like any other shipped file, but the atlas
it indexes is **packed by `tools/build-fighter-atlas.py` from source sheets that are gitignored** —
they are not in a fresh clone. See [`sprite-pipeline.md`](sprite-pipeline.md) before trying to
rebuild it.
