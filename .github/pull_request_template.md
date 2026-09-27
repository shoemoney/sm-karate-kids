## What changed

<!-- One or two sentences. What is true after this PR that was not true before. -->

## Why

<!-- The problem, not the patch. -->

## Verification

- [ ] `pnpm check` exits 0
- [ ] `pnpm --filter @smkk/game test:e2e` passes on the portrait project
- [ ] Checked at 390×844 portrait, not only on a desktop window

<!-- If you changed command parsing, scoring, the timer, or the replay format,
     say which test covers the new behaviour. Those four are the contract. -->

## Scope check

- [ ] `packages/sim` still imports no Three.js, DOM, audio, network, or AI client
- [ ] Any new shipped asset has a provenance entry
- [ ] No ROM-derived art, audio, or naming
