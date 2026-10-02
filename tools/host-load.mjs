#!/usr/bin/env node
/**
 * Host load, read once, for every benchmark row.
 *
 * This is not decoration. Round 145's first sweep returned 56.6ms of median
 * frame time for the baseline; a later sweep of the identical, unmodified tree
 * returned 77.1ms; another returned 161.9ms. Nothing in the tree changed. The
 * unattended review loop was running its own Playwright suite on the same CPU,
 * and the "renderer change" being evaluated was the machine's contention for
 * cores. A frame-time number without the load it was taken at is not a
 * measurement, it is a rumour — so the number travels with its conditions, and
 * a caller can refuse to compare rows taken at different loads.
 *
 * r154: it was reading **0**. Stripping the braces off `{ 26.40 28.09 23.42 }`
 * leaves a LEADING SPACE, so `split(/\s+/)` produced `["", "26.40", ...]`,
 * `Number("")` is 0, and `round(0)` is 0 — a number, so the `catch -> null`
 * safety net never fired and nothing anywhere looked broken. Every sweep row on
 * every macOS box has carried `load 0->0` since r145, and 0 reads as "an idle
 * machine" rather than "no reading at all". That is the r145 failure mode with
 * the guard disarmed and the guard still drawn on the page: r151's standing
 * instruction to print the load beside every result was satisfied by a constant.
 *
 * The parser now takes the first number it can find, so the brace is optional
 * rather than load-bearing, and a reading that cannot be taken is `null` and
 * stays `null`.
 */

import { execFileSync } from 'node:child_process';

/** `sysctl -n vm.loadavg` -> `{ 26.40 28.09 23.42 }` (macOS), or `26.40 ...`. */
export function parseLoadavg(text) {
  if (typeof text !== 'string') return null;
  const first = /\{?\s*(-?\d+(?:\.\d+)?)/.exec(text);
  if (!first) return null;
  const value = Number(first[1]);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 10) / 10;
}

/**
 * 1-minute load average, or `null` when it cannot be read. `null` is not an
 * inconvenience to be papered over with a zero: it is the difference between
 * "measured on an idle box" and "not measured", and the whole reason this
 * function exists is that a reader could not tell those apart.
 */
export function hostLoad() {
  try {
    return parseLoadavg(execFileSync('sysctl', ['-n', 'vm.loadavg'], { encoding: 'utf8' }));
  } catch {
    return null;
  }
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const load = hostLoad();
  console.log(load === null ? 'host-load: UNAVAILABLE' : `host-load: ${load}`);
  process.exitCode = load === null ? 2 : 0;
}