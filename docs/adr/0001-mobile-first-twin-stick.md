# 0001 — Mobile-first, twin-stick grammar preserved exactly

**Status:** Accepted
**Date:** 2026-09-27

## Context

the product spec ("Audience and platforms," ~line 102) specifies a **desktop-first** baseline: keyboard
and gamepad as the launch inputs, with "touch controls as an experimental post-MVP mode, not a
launch requirement."

On 2026-09-27 the project owner overrode that: the game is now **mobile-first**. Portrait phone is
the primary target from the first playable build, not a stretch goal bolted on after desktop ships.

This is a real design pivot, not a compatibility add-on, so it needs to be recorded rather than
silently drifting away from what the product spec says.

## Decision

- **Portrait phone (390×844) is the design baseline.** Layout, HUD placement, touch target sizing,
  and readability decisions are made for that viewport first. Desktop and landscape are scaled-up
  secondary targets.
- **Touch is the primary input device.** Keyboard and gamepad remain fully supported but are
  secondary — they don't get first claim on UX or layout decisions the way they would under a
  desktop-first plan.
- **The twin-stick command grammar is preserved exactly.** Nothing about the 24-technique grammar
  (`packages/sim/src/grammar.ts`) changes for touch. Every input device — touch, keyboard, gamepad,
  replay playback, CPU — is an adapter that emits the same normalized four-way `StickPair`
  (`packages/sim/src/input.ts`). `packages/sim` never learns, and must never learn, which physical
  device produced a given frame.

This keeps the architecture boundary from `CLAUDE.md` intact: the simulation layer stays
deterministic and platform-free, and "mobile-first" is entirely a presentation/input-adapter
concern, not a simulation concern.

## Consequences

- **Virtual sticks have no tactile detents.** A physical arcade stick (or a gamepad's stick gate)
  gives the player a felt boundary between "neutral" and "committed to a direction" — that's a big
  part of why quantizing an analog stick to four directions works cleanly on real hardware. A touch
  virtual stick has none of that; the player's thumb has no physical stop telling it where neutral
  ends.
- **Dead zones and visual feedback now have to carry the load the hardware gate used to carry.**
  The touch input adapter needs a deliberately tuned dead zone (too small → noisy accidental
  direction changes near neutral; too large → sluggish, unresponsive-feeling sticks) plus clear
  on-screen feedback (stick displacement, an active-direction highlight) so the player can tell
  what direction they're about to commit to before releasing. This is real design and tuning work,
  not a checkbox — expect it to need iteration once real devices are in hand.
- Keyboard and gamepad adapters are unaffected internally (they already emit quantized `Dir4`
  values with no analog dead-zone problem), but their on-screen affordances (remap UI, command
  display) now design *around* the mobile layout rather than the other way around.
- Touch is promoted from "experimental post-MVP" to in-scope for the vertical slice and MVP
  milestones described in the product spec. Phase exit criteria that assumed desktop-only playtesting
  should be revisited against this ADR when milestone docs are next updated.
