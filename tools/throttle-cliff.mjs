#!/usr/bin/env node
/**
 * The throttle cliff — finds the CPU rate at which the CI failure reproduces
 * locally, then checks whether the candidate fix removes it at that rate.
 *
 * The question this exists to answer is NOT "which config has better frame
 * times". A better frame time on fast hardware says nothing about a two-core
 * runner, which is why three rounds of this loop have each proposed a lever
 * from a measurement that could not exhibit the failure.
 *
 * It is: at the rate where the click breaks, does the candidate still work?
 * A lever that helps at 1x and does nothing at the cliff is not a fix.
 *
 * Patches the same two source anchors as renderer-sweep.mjs, rebuilds per row,
 * and reverts everything on exit — source AND the build, which is the part r154
 * found missing in both of these tools. See `tools/sweep.mjs`.
 *
 * Usage: CPU_LADDER=1,4,8,16 node tools/throttle-cliff.mjs
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { startPreview } from './bench-server.mjs';
import { GAME, REPO as root, buildGame, createSweep } from './sweep.mjs';

const RENDERER = resolve(GAME, 'src/renderer.ts');
const MAIN = resolve(GAME, 'src/main.ts');

const LADDER = (process.env['CPU_LADDER'] ?? '1,6,12,20').split(',').map(Number);
const CLICKS = process.env['CLIFF_CLICKS'] ?? '3';
const FRAMES = process.env['CLIFF_FRAMES'] ?? '60';

const sweep = createSweep({ label: 'throttle-cliff', files: { renderer: RENDERER, main: MAIN } });

const DPR = 'renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio ?? 1, 2));';

/** Two configs only. The cliff is a property of the machine, not of a menu. */
const CONFIGS = [
  { label: 'baseline', edits: [] },
  { label: 'pixelratio-1', edits: [[RENDERER, DPR, 'renderer.setPixelRatio(1);']] },
];

// The harness owns the server. A preview process started in a background
// subshell did not survive between tool calls, and the next run failed on
// ERR_CONNECTION_REFUSED with nothing naming the cause.
const server = await startPreview(GAME);
process.on('exit', () => server.stop());

const rows = [];
for (const config of CONFIGS) {
  sweep.restoreSource();
  sweep.applyEdits(config.edits);
  buildGame();
  for (const cpu of LADDER) {
    const raw = execFileSync(
      'node',
      [
        resolve(root, 'tools/renderer-bench.mjs'),
        config.label,
        '--gfx',
        'webgl',
        '--frames',
        String(FRAMES),
        '--clicks',
        String(CLICKS),
        '--cpu',
        String(cpu),
      ],
      { cwd: root, stdio: 'pipe', maxBuffer: 8 * 1024 * 1024, env: { ...process.env, BENCH_PORT: String(server.port) } },
    );
    const row = JSON.parse(raw.toString().trim().split('\n').pop());
    rows.push(row);
    console.log(
      `${config.label.padEnd(14)} cpu x${String(cpu).padStart(2)}  ` +
        `frame med ${String(row.frameMs.median).padStart(7)}ms  p95 ${String(row.frameMs.p95).padStart(7)}ms  ` +
        `click med ${String(row.clickMsMedian).padStart(6)}ms  max ${String(row.clickMsMax).padStart(6)}ms  ` +
        `released ${row.clickReleased}/${row.clicks}  ` +
        `load ${row.loadBefore}->${row.loadAfter}  [${row.clickSamples.join(', ')}]`,
    );
  }
}
await server.stop();
sweep.finish();
writeFileSync(resolve(root, 'logs/throttle-cliff.json'), `${JSON.stringify({ ladder: LADDER, clicks: CLICKS, rows }, null, 2)}\n`);
console.log('\nwrote logs/throttle-cliff.json');