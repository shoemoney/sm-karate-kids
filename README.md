# 🥋 SM Karate Kids: Asmongold vs HasanAbi

### **Two sticks. No buttons. One clean point.** 👊✨

[![License: MIT](https://img.shields.io/badge/License-MIT-1e90d6.svg)](LICENSE)
[![Renderer](https://img.shields.io/badge/renderer-WebGPU%20%E2%86%92%20WebGL%202-e7b657.svg)](#-rendering)
[![Built for](https://img.shields.io/badge/built%20for-thumbs-c8443c.svg)](#-mobile-first-means-mobile-first)
[![three.js](https://img.shields.io/badge/three.js-0.186-8cbde9.svg)](https://threejs.org/)

🤍 **Asmongold** in white vs ❤️ **HasanAbi** in red — a parody fan game.

A browser reinterpretation of 1984 tournament karate: **no health bar, no combos**. One
valid strike ends the exchange, a referee calls half a point or a full point, and the
first fighter to two points takes the bout. Spacing and timing are the whole game.

> 🚧 **Phase 1 vertical slice.** Two fighters, one dojo, twenty techniques, referee
> scoring, deterministic replay. Not the campaign yet — see [Roadmap](#-roadmap).

![SM Karate Kids: Asmongold vs HasanAbi on a portrait phone](docs/preview/portrait.png)

---

## 📱 Mobile-first means mobile-first

The design baseline is a **390 × 844 portrait phone**. Desktop is the adaptation, not
the other way round. That decision is recorded, with its trade-offs, in
[ADR 0001](docs/adr/0001-mobile-first-twin-stick.md).

| | |
|---|---|
| 🕹️ **Two floating sticks** | Each one re-centres wherever your thumb lands, so you never look down to find it. |
| 🚪 **A software gate** | Glass has no detents. A dead zone, dominant-axis selection, and hysteresis rebuild the cabinet's four-way gate so a wobbling thumb never chatters between techniques. |
| 🎥 **A camera that breathes** | A tall viewport would shrink two fighters to dolls. The frame holds only the distance actually between them, dollying in as the exchange closes. |
| 🔌 **Every device is an adapter** | Touch, keyboard, and Gamepad all collapse to the same normalized four-way pair. The simulation never learns which one is driving. |

---

## 🎮 How to play

The **left stick is stance**. The **right stick is technique**. There are no attack buttons.

| Left stick alone | What happens |
|---|---|
| ◀ ▶ | Walk back / forward |
| ▲ | Jump |
| ▼ | Crouch |

Move the **right stick** out of neutral and you throw a technique. Where the **left
stick** is at that instant decides *which one* — four families × five qualifiers =
**20 techniques**, plus the four movement commands.

```
right ▶  →  lunge punch · jumping punch · crouching punch · stepping lunge punch · back fist
right ◀  →  reverse punch · somersault kick · crouching reverse punch · back kick · spinning back kick
right ▲  →  front kick · jumping front kick · rising knee · roundhouse kick · high block
right ▼  →  foot sweep · jumping sweep kick · low sweep · leg sweep · low block
```

The stick must pass back through neutral before the next technique fires, so holding a
direction never machine-guns.

**Keyboard:** `WASD` is the stance stick, arrow keys (or `IJKL`) are the technique stick.
**Gamepad:** both analog sticks, quantized to four ways.

### 🧑‍⚖️ How the referee scores

| Call | Worth | When |
|---|---|---|
| **WAZA-ARI** ½ | 0.5 | A clean contact with a half-value technique |
| **IPPON** ● | 1.0 | A full-value technique, **or** a counter — beating your opponent to the punch, landing while they're still winding up |
| **AIUCHI** | 0 | Both land on the same tick. Nobody scores, reset. |
| **BLOCKED** | 0 | An active block covering that height band |

Crouching ducks a **high** strike. Jumping clears a **low** one. First to **2 points**, or
the higher score when the 30-second clock runs out.

---

## 🏗️ Architecture

```mermaid
flowchart TD
    T["👆 Touch"] --> N
    K["⌨️ Keyboard"] --> N
    G["🎮 Gamepad"] --> N
    N["Normalized StickPair<br/>left + right, four ways each"] --> P["Command grammar<br/>packages/sim"]
    P --> S["Fixed-step simulation<br/>60 Hz · deterministic · no DOM"]
    S --> R["Referee + scoring"]
    S --> V["Three.js presentation<br/>apps/game"]
    S --> RP["Replay + checksum"]
    V --> W{"WebGPU?"}
    W -->|yes| GPU["WebGPURenderer"]
    W -->|no| GL["WebGL 2 fallback"]
```

**The hard boundary:** `packages/sim` may not import Three.js, the DOM, audio, the
network, or any AI client. It takes normalized input frames and emits deterministic
events. That is what makes the replay checksum meaningful — and it is enforced by test,
not by good intentions.

| Package | What lives there |
|---|---|
| `packages/sim` | Clock, grammar, fighter state machine, hit resolution, referee, replay, CPU. Zero browser. |
| `packages/content` | Zod-validated move / fighter / arena / ruleset data. Importing it *is* the validation. |
| `apps/game` | Three.js presentation, input adapters, HUD, audio, the mobile layout, the pre-boot loading card. |
| `tools/` | Standalone utilities run by CI and by hand: the content and asset validators, the balance-report harness, the art generator/optimizer shell scripts, the fighter-atlas builder, and two throwaway look-at-the-game scripts. Full table in [`AGENTS.md`](AGENTS.md). |

### 🎨 The art pipeline is checked, not trusted

Every shipped binary has a provenance record and a human approval behind it, and
`pnpm validate:assets` refuses the build if any of that is missing. On top of that it proves
the generated art set is coherent: `tools/art-manifest.tsv` is the single source of truth shared by
the generator and the optimizer, and the validator checks that it parses, that every row is approved,
that it and the shipped files agree **in both directions**, and that every
`public/generated/*.webp` is actually referenced from app source. An orphan texture is tens or
hundreds of KB of download for a black rectangle, so that last one is a build failure, not a nitpick.

---

## 🚀 Quick start

```bash
pnpm install
pnpm dev          # http://127.0.0.1:5173
```

| Command | Does |
|---|---|
| `pnpm dev` | Dev server with HMR |
| `pnpm build` | Production bundle |
| `pnpm test` | Simulation unit + soak tests (vitest) |
| `pnpm test:e2e` | Builds the bundle, then Playwright, portrait phone + desktop |
| `pnpm validate:content` | Every grammar move has frame data, and nothing is orphaned |
| `pnpm validate:assets` | Every shipped asset has provenance, and the generated art set is approved, manifest-consistent, and actually wired |
| `pnpm check` | All of the above — run it before you call anything done |

### 🔧 URL switches

| Parameter | Effect |
|---|---|
| `?mode=dojo` | Training partner holds stance so you can drill |
| `?mode=dojo&spacing=2.5` | Dojo mode with custom opening distance (metres) |
| `?mode=classic` \| `pressure` \| `counter` | CPU archetype |
| `?renderer=webgl` | Force the WebGL 2 fallback path |
| `?seed=1337` | Seed the CPU, for reproducible bouts |

---

## 🖥️ Rendering

Three.js `WebGPURenderer` tries WebGPU and falls back to WebGL 2. **A missing WebGPU is a
fallback, never a refusal to run** — the backend in use is printed under the clock.

The simulation is renderer-independent, and there is a test that proves it: the same seed
run on both backends must produce the same checksum. If rendering ever leaks into game
state, that test goes red.

---

## ✅ Verify

```bash
pnpm check        # typecheck, unit, content, assets
pnpm test:e2e     # builds the bundle, then real touch events via CDP on a 390×844 viewport
```

`pnpm test:e2e` **builds the bundle it serves**, on purpose — the suite runs against `apps/game/dist/`
via `vite preview`, so a run that skipped the build would happily pass against whatever was last on
disk. Don't add a separate `pnpm build` in front of it.

⚠️ Locally the suite reuses an existing server on port **4173** if it finds one. Before you trust a
run, make sure nothing else is squatting on it (`lsof -ti:4173` should print nothing) — a foreign
server is silently reused and produces a cascade of failures that aren't yours.

The end-to-end suite plays an actual bout with **nothing but two synthetic thumbs**,
dispatched through the browser's real input pipeline rather than fabricated in page
script. A build no thumb could play fails here.

---

## 🗺️ Roadmap

| Phase | State | Contents |
|---|---|---|
| **0 — proof** | ✅ | Twin-stick parser, referee state, deterministic replay, both renderer backends |
| **1 — vertical slice** | ✅ | Two fighters, dojo, 20 techniques, CPU archetypes, audio, mobile layout |
| **2 — MVP** | ⏳ | Local versus, three arenas, three classic challenges, replays UI, quality tiers, PWA shell |
| **3 — Version 1** | ⏳ | Championship Journey, 12 arenas, score attack, localization, full mix |

---

## ⚖️ Licence and rights

The source code and project-authored documentation are **MIT** — see [LICENSE](LICENSE).

**The MIT grant does not cover everything in this repository:**

- 🛡️ The **ShoeMoney brand marks** — the emblem on the fighters' gi (and the favicon), and the
  publisher mark on the pre-boot loading card — are Jeremy Schoemaker's, used with permission and
  carved out of the MIT grant, as are the **fighter sprite atlases** built from his own artwork.
  See [`apps/game/public/brand/PROVENANCE.json`](apps/game/public/brand/PROVENANCE.json).
- 🚫 Nothing here grants any right to the **Karate Champ** name, logos, characters, cabinet
  art, or audio, or to any Data East / G-MODE intellectual property. This project ships
  **original assets only** and carries no ROM-derived material.

Details in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and
[docs/asset-provenance.md](docs/asset-provenance.md).

---

## 🤝 Contributing

[CONTRIBUTING.md](CONTRIBUTING.md) · [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) ·
[SECURITY.md](SECURITY.md)

Two rules worth repeating before you open a PR:

1. **`packages/sim` stays platform-free.** If your change makes it import a browser API,
   it belongs in `apps/game`.
2. **Add the test before you change command parsing, scoring, the timer, or the replay
   format.** Those four are the contract.
