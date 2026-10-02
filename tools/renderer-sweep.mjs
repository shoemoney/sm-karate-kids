#!/usr/bin/env node
/**
 * Collects renderer-bench numbers across renderer configurations by patching
 * the source, rebuilding, measuring, and restoring. Every edit is reverted
 * after its measurement, so the tree ends the run exactly as it started.
 *
 * The numbers are RELATIVE. The runner that goes red is a throttled two-core
 * Linux box whose software-rasterized frames cost ~614ms; the machine this
 * drives is not that machine and cannot be made into it. What is comparable
 * across rows is the ratio between configs measured on the same host in the
 * same session, which is what a look trade actually needs.
 *
 * Usage: node tools/renderer-sweep.mjs
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { startPreview } from './bench-server.mjs';
import { GAME, REPO as root, buildGame, createSweep } from './sweep.mjs';

const RENDERER = resolve(GAME, 'src/renderer.ts');
const MAIN = resolve(GAME, 'src/main.ts');
const GFX = process.env['SWEEP_GFX'] ?? 'webgl';
const FRAMES = process.env['SWEEP_FRAMES'] ?? '80';
const CLICKS = process.env['SWEEP_CLICKS'] ?? '5';

const sweep = createSweep({ label: 'renderer-sweep', files: { renderer: RENDERER, main: MAIN } });

/**
 * Each config is a list of [file, from, to]. A config whose `from` string is
 * absent is an error, not a silent no-op — a benchmark that measures the
 * baseline while believing it measured something else is worse than no run.
 */
const AA_ON = 'antialias: true,';
const AA_OFF = 'antialias: false,';
const DPR = 'renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio ?? 1, 2));';
const POST_CALL = '    post.render();';
const DIRECT_CALL = '    renderer.render(stage.scene, stage.camera);';

const CONFIGS = [
  { label: 'baseline', edits: [] },
  { label: 'antialias-off', edits: [['renderer', AA_ON, AA_OFF]] },
  { label: 'post-bypassed', edits: [['main', POST_CALL, DIRECT_CALL]] },
  { label: 'pixelratio-1', edits: [['renderer', DPR, 'renderer.setPixelRatio(1);']] },
  { label: 'pixelratio-half', edits: [['renderer', DPR, 'renderer.setPixelRatio(0.5);']] },
  { label: 'aa-off+post-off', edits: [['renderer', AA_ON, AA_OFF], ['main', POST_CALL, DIRECT_CALL]] },
  { label: 'aa-off+pr-half', edits: [['renderer', AA_ON, AA_OFF], ['renderer', DPR, 'renderer.setPixelRatio(0.5);']] },
  {
    label: 'aa-off+post-off+pr-half',
    edits: [['renderer', AA_ON, AA_OFF], ['renderer', DPR, 'renderer.setPixelRatio(0.5);'], ['main', POST_CALL, DIRECT_CALL]],
  },
];

const server = await startPreview(GAME);
process.on('exit', () => server.stop());

const results = [];
for (const config of CONFIGS) {
  sweep.restoreSource();
  sweep.applyEdits(config.edits);
  buildGame();
  const raw = execFileSync(
    'node',
    [
      resolve(root, 'tools/renderer-bench.mjs'),
      config.label,
      '--gfx',
      GFX,
      '--frames',
      FRAMES,
      '--clicks',
      CLICKS,
    ],
    { cwd: root, stdio: 'pipe', maxBuffer: 8 * 1024 * 1024, env: { ...process.env, BENCH_PORT: String(server.port) } },
  );
  const row = JSON.parse(raw.toString().trim().split('\n').pop());
  results.push(row);
  const base = results[0];
  const ratio = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  console.log(
    `${row.label.padEnd(26)} frame med ${String(row.frameMs.median).padStart(6)}ms  ` +
      `p95 ${String(row.frameMs.p95).padStart(6)}ms  max ${String(row.frameMs.max).padStart(7)}ms  ` +
      `fps ${String(row.frameMs.fpsMedian).padStart(5)} (${ratio(row.frameMs.median, base.frameMs.median)}%)  ` +
      `click med ${String(row.clickMsMedian).padStart(5)}ms (${ratio(row.clickMsMedian, base.clickMsMedian)}%)  ` +
      `released ${row.clickReleased}/${row.clicks}  [${row.clickSamples.join(', ')}]`,
  );
}
await server.stop();
sweep.finish();
writeFileSync(resolve(root, 'logs/renderer-sweep.json'), `${JSON.stringify({ gfx: GFX, frames: FRAMES, results }, null, 2)}\n`);
console.log('\nwrote logs/renderer-sweep.json');