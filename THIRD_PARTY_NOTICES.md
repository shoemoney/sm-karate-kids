# Third-Party Notices 📋

This repository's original source code and project-authored documentation are licensed under the
**MIT License** (`LICENSE`, © 2026 Jeremy Schoemaker). That grant does **not** extend to the
third-party software, brand marks, or intellectual property listed below — each carries its own
terms.

## 📚 Third-party software

| Component | License | Notes |
|---|---|---|
| [three.js](https://github.com/mrdoob/three.js) | MIT | Rendering and scene graph, used via the `three` npm package in `apps/game`. |
| [Zod](https://github.com/colinhacks/zod) | MIT | Content schema validation, used in `packages/sim/src/content.ts`. |

Both are used under the terms of the MIT License. See each project's own repository for its full
license text and copyright notice.

## 🥋 ShoeMoney brand marks and fighter artwork — carved out of the MIT grant

Jeremy Schoemaker's own work appears in this repository in several places, and **none of it is
covered by the MIT grant**:

- `apps/game/public/brand/shoemoney-emblem.png` — the ShoeMoney brand mark, applied to both
  fighters' gi chests and used as the favicon.
- `apps/game/public/brand/shoemoney-logo.png` and `apps/game/public/brand/shoemoney-logo.webp` —
  the ShoeMoney publisher mark, shown on the pre-boot loading card. The PNG is the conversion
  source; the WebP is the one that ships. Resized and re-encoded only, never recoloured, filtered,
  blended or distorted.
- `apps/game/public/fighters/*.webp` and `apps/game/public/fighters/manifest.json` — the packed
  sprite atlases, built from Jeremy Schoemaker's own karateka artwork, which carries the emblem.

All of it is:

- **Not** licensed under this repository's MIT License.
- **Not** available for reuse, redistribution, or relicensing outside this project without
  separate permission from Jeremy Schoemaker.

See `apps/game/public/brand/PROVENANCE.json` and `docs/asset-provenance.md` for the full
provenance records. `AGENTS.md` carries this as a standing rule.

## ⚠️ *Karate Champ* and related intellectual property

This project is an original work developed under the codename **ShoeMoney Karate Kids**. Nothing
in this repository, and no MIT license grant made by it, confers any rights to:

- The ***Karate Champ*** name, logos, or branding.
- Any characters, visual identity, cabinet presentation, or original sound samples from the 1984
  *Karate Champ* arcade release.
- Any intellectual property owned or controlled by **Data East**, **Technōs Japan**, or
  **G-MODE** (which lists *Karate Champ* among the Data East titles it controls or licenses).

Per the product spec, section "Rights and provenance", this project does not include, and must never include,
any extracted ROM art, sprites, recordings, or cabinet scans. Until any licensing discussion with
G-MODE is resolved, all character designs, audio, and presentation in this project are original
work, not a recreation of the 1984 game's copyrighted assets.

If you believe any content in this repository infringes third-party intellectual property, please
report it per `SECURITY.md`'s contact process rather than opening a public issue.
