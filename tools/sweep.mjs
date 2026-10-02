#!/usr/bin/env node
/**
 * The shared lifecycle for every tool that measures by patching the source,
 * building, measuring, and putting the tree back.
 *
 * r153 found this missing from `keyhint-contrast-mutation.sh`: the harness
 * restored `styles.css`, never rebuilt, and left `apps/game/dist` carrying
 * mutation 4's deliberately dim value. `tools/verify-deploy.sh` compares dist
 * against the wire, so the next round read "production is stale" about a
 * production that was correct — and the obvious response, redeploying, pushes a
 * build assembled from whichever mutation happened to be last.
 *
 * r154 found the same defect in the two tools that patch `renderer.ts` and
 * `main.ts`: `renderer-sweep.mjs` and `throttle-cliff.mjs` both `restore()`d the
 * source on the way out and never rebuilt, so the last thing each left in dist
 * was a build of its LAST MUTATED CONFIG. Reproduced on the real tool, and not
 * even on the tidy path — the run crashed (the bench's browser died) and the
 * `process.on('exit')` handler restored source over a mutated build:
 *
 *     before   git status clean   dist cfa75442
 *     crash    git status clean   dist f0b0a8ed   <- describes a tree that is gone
 *     rebuild  git status clean   dist cfa75442   <- back, byte for byte
 *
 * So the invariant is: **the build a sweep leaves behind is byte-identical to
 * the one it started with.** Vite's asset names are content hashes, so that is
 * checkable rather than hopeful — measured, two consecutive builds of one tree
 * produce the same `dist` tree digest, and it comes back after a restore.
 *
 * It is checked rather than assumed, because the failure is silent in the worst
 * way: the harness exits 0, `git status` is clean, and the lie surfaces two
 * tools later as somebody else's verdict.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const GAME = resolve(REPO, 'apps/game');
export const DIST = resolve(GAME, 'dist');

/** One `vite build`, the same invocation the package scripts make. */
export const buildGame = () =>
  execFileSync('node', [resolve(GAME, 'node_modules/vite/bin/vite.js'), 'build'], { cwd: GAME, stdio: 'pipe' });

/**
 * sha256 over the whole build, as `relpath:sha256` lines in sorted order. Not a
 * digest of file contents concatenated — of the *paths* too, so a build that
 * silently dropped or added a file cannot hash the same as one that did not.
 */
export function distDigest(dir = DIST) {
  const hash = createHash('sha256');
  const walk = (current) => {
    for (const entry of readdirSync(current).sort()) {
      const full = join(current, entry);
      if (statSync(full).isDirectory()) walk(full);
      else hash.update(`${relative(dir, full)}:${createHash('sha256').update(readFileSync(full)).digest('hex')}\n`);
    }
  };
  walk(dir);
  return hash.digest('hex');
}

/**
 * @param {{ label: string, files: Record<string, string> }} options
 *   `files` maps a short key (`renderer`, `main`) to an absolute path. Short keys
 *   are how both call sites spell their edits, so the anchor check lives here
 *   once rather than twice.
 */
export function createSweep({ label, files }) {
  const snapshot = new Map(Object.values(files).map((path) => [path, readFileSync(path, 'utf8')]));
  const startDigest = distDigest();
  let done = false;

  const sourceIsRestored = () => {
    for (const [path, text] of snapshot) if (readFileSync(path, 'utf8') !== text) return path;
    return null;
  };

  const restoreSource = () => {
    for (const [path, text] of snapshot) writeFileSync(path, text);
  };

  /**
   * An absent anchor is an error, not a silent no-op. A benchmark that measures
   * the baseline while believing it measured something else is worse than no
   * run, and that is what a moved anchor produces.
   */
  const applyEdits = (edits) => {
    for (const [key, from, to] of edits) {
      const path = files[key] ?? resolve(GAME, key);
      const text = readFileSync(path, 'utf8');
      if (!text.includes(from)) throw new Error(`${label}: patch anchor absent in ${key}: ${from}`);
      writeFileSync(path, text.replace(from, to));
    }
  };

  /** Throws with a diagnosis on either violation. Pure reads — no build. */
  const assertHonest = () => {
    const dirty = sourceIsRestored();
    if (dirty) {
      return `source not restored: ${relative(REPO, dirty)} still holds a mutation`;
    }
    const now = distDigest();
    if (now !== startDigest) {
      return (
        `dist does not describe the source: ${relative(REPO, DIST)} is ${now.slice(0, 12)}, ` +
        `the build this sweep started from was ${startDigest.slice(0, 12)}. ` +
        `deploy gates will read this as a stale deploy, and redeploying pushes a mutated build.`
      );
    }
    return null;
  };

  /** The tidy path: put the source back, rebuild it, and check both. */
  const finish = () => {
    restoreSource();
    buildGame();
    const complaint = assertHonest();
    if (complaint) throw new Error(`${label} left the tree lying: ${complaint}`);
    done = true;
    return startDigest;
  };

  /**
   * The crash path. A throwing or killed run must still not leave a mutated
   * build behind — r154 reproduced exactly that, through a browser that died
   * mid-sweep. Best effort by design: the process is already unwinding, and a
   * rebuild that fails here must not replace the original error.
   *
   * Skipped once `finish()` has run, or the tidy path would build twice.
   */
  const emergencyRestore = () => {
    if (done) return;
    done = true;
    restoreSource();
    try {
      buildGame();
    } catch (error) {
      console.error(`  WARNING: could not rebuild after restoring: ${error.message}`);
      console.error('  apps/game/dist may not describe apps/game/src. Run `pnpm build` before deploying.');
      return;
    }
    const complaint = assertHonest();
    if (complaint) console.error(`  WARNING: ${label} left the tree lying: ${complaint}`);
  };

  process.on('exit', emergencyRestore);
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      emergencyRestore();
      process.exit(1);
    });
  }

  // `buildGame` is deliberately NOT in this object. r154's first harness run
  // called `sweep.buildGame()` and got `TypeError: not a function` — which read
  // as two failed assertions about the guard when it was really a missing
  // export. A module-level import that the call sites make themselves is a
  // missing name at load time, not a missing method at call time.
  return { applyEdits, restoreSource, assertHonest, finish, emergencyRestore, startDigest };
}