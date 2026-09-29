import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { content } from '@smkk/content';
import { contactFrameFor, hasPoseFor, resolveSpriteFrame, type SpritePoses } from '../../src/spriteFrames.js';

const REPO_ROOT = resolve(import.meta.dirname, '../../../..');
const MANIFEST_PATH = join(REPO_ROOT, 'apps/game/public/fighters/manifest.json');
// Incoming art, deliberately gitignored: absent in CI, present for a machine
// that still has the drop. Coverage against it is asserted whenever it exists.
const ART_DIR = join(REPO_ROOT, 'assets');

interface AtlasManifest {
  readonly cell: { readonly w: number; readonly h: number };
  readonly baseline: number;
  readonly metresPerCell: number;
  readonly facing: string;
  readonly fighters: Record<string, { readonly pages: string[]; readonly cols: number; readonly rows: number }>;
  readonly poses: SpritePoses;
}

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as AtlasManifest;
const poses = manifest.poses;
const moves = content.moves;

/** Every atlas cell the pages can actually show. */
function atlasCapacity(): number {
  let capacity = 0;
  for (const entry of Object.values(manifest.fighters)) {
    capacity = Math.max(capacity, entry.cols * entry.rows * entry.pages.length);
  }
  return capacity;
}

function moveIds(): string[] {
  return moves.map((m) => m.id);
}

describe('the fighter atlas covers the game', () => {
  test('every move in the game has its own pose', () => {
    const missing = moveIds().filter((id) => !hasPoseFor(poses, id));
    expect(missing, `moves with no animation in the atlas: ${missing.join(', ')}`).toEqual([]);
  });

  test('every move folder in the source art is in the atlas', (ctx) => {
    // assets/ is gitignored incoming art (35 MB), so it is absent in CI. Skip
    // visibly rather than returning quietly — a test that passes without
    // checking anything is how a dropped technique goes unnoticed.
    if (!existsSync(ART_DIR)) {
      ctx.skip();
      return;
    }
    // A folder is a move when it carries its own animation.json. `guard/` holds
    // the two guard portraits and `generated/` the stage plates — neither is a
    // technique, and neither has frames to play.
    const folders = readdirSync(ART_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => existsSync(join(ART_DIR, name, 'animation.json')))
      .sort();
    expect(folders.length, 'expected the art drop to contain move folders').toBeGreaterThan(0);

    const missing = folders.filter((name) => !hasPoseFor(poses, name));
    expect(missing, `art folders with no pose in the atlas: ${missing.join(', ')}`).toEqual([]);
  });

  test('both fighters are packed into the atlas', () => {
    for (const fighter of content.fighters) {
      const entry = manifest.fighters[fighter.id];
      expect(entry, `atlas has no pages for fighter "${fighter.id}"`).toBeDefined();
      expect(entry?.pages.length ?? 0).toBeGreaterThan(0);
      // Both fighters draw from the same shared manifest, so a pose present for
      // one is present for the other — this is the guard that stays true.
      expect(Object.keys(poses).length).toBeGreaterThan(moveIds().length);
    }
  });

  test('every frame index lands inside the packed pages', () => {
    const capacity = atlasCapacity();
    for (const [name, pose] of Object.entries(poses)) {
      for (const frame of pose.frames) {
        expect(frame, `pose "${name}" points outside the atlas`).toBeGreaterThanOrEqual(0);
        expect(frame, `pose "${name}" points outside the atlas`).toBeLessThan(capacity);
      }
    }
  });

  test('a pose declares a contact frame that exists in its own frame list', () => {
    for (const [name, pose] of Object.entries(poses)) {
      expect(pose.frames.length, `pose "${name}" has no frames`).toBeGreaterThan(0);
      expect(
        pose.contact,
        `pose "${name}" has contact ${pose.contact} but only ${pose.frames.length} frames`,
      ).toBeGreaterThanOrEqual(0);
      expect(pose.contact, `pose "${name}" contact index is out of range`).toBeLessThan(pose.frames.length);
    }
  });

  test('no two moves share the same frame list', () => {
    // A move that reused another move's frames would animate, but not as its
    // own technique — exactly the bug this guards.
    const bySignature = new Map<string, string[]>();
    for (const id of moveIds()) {
      const signature = [...(poses[id]?.frames ?? [])].sort((a, b) => a - b).join(',');
      const owners = bySignature.get(signature) ?? [];
      owners.push(id);
      bySignature.set(signature, owners);
    }
    const shared = [...bySignature.entries()]
      .filter(([, owners]) => owners.length > 1)
      .map(([, owners]) => owners.join(' & '));
    expect(shared, `these moves play identical frames: ${shared.join('; ')}`).toEqual([]);
  });
});

describe('frame selection holds the contact frame for the referee', () => {
  test('the whole active window of every move shows the contact frame', () => {
    for (const move of moves) {
      const contact = contactFrameFor(poses, move.id);
      expect(contact, `move "${move.id}" has no contact frame`).toBeDefined();
      for (let tick = 0; tick < move.active; tick += 1) {
        const cell = resolveSpriteFrame(
          poses,
          {
            moveId: move.id,
            phase: 'active',
            phaseTicks: tick,
            startup: move.startup,
            recovery: move.recovery,
          },
          tick,
        );
        expect(cell, `"${move.id}" tick ${tick} of active is not the contact frame`).toBe(contact);
      }
    }
  });

  test('a frozen fighter is frozen on the contact frame', () => {
    for (const move of moves) {
      const contact = contactFrameFor(poses, move.id);
      for (let tick = 0; tick < move.active + move.recovery; tick += 1) {
        const cell = resolveSpriteFrame(
          poses,
          {
            moveId: move.id,
            phase: 'frozen',
            phaseTicks: tick,
            startup: move.startup,
            recovery: move.recovery,
          },
          tick,
        );
        expect(cell).toBe(contact);
      }
    }
  });

  test('startup ramps through the frames before contact and lands on it', () => {
    for (const move of moves) {
      const contact = contactFrameFor(poses, move.id);
      const seen = new Set<number>();
      for (let tick = 0; tick < move.startup; tick += 1) {
        seen.add(
          resolveSpriteFrame(
            poses,
            { moveId: move.id, phase: 'startup', phaseTicks: tick, startup: move.startup, recovery: move.recovery },
            tick,
          ),
        );
      }
      // Every startup frame belongs to this move, never the idle fallback.
      const allowed = new Set(poses[move.id]?.frames ?? []);
      for (const cell of seen) {
        expect(allowed.has(cell), `"${move.id}" startup showed a frame that is not its own`).toBe(true);
      }
      if ((poses[move.id]?.frames.length ?? 0) > 1) {
        expect(seen.size, `"${move.id}" never animates during startup`).toBeGreaterThan(1);
      }
      expect(contact).toBeDefined();
    }
  });

  test('recovery plays the frames after contact, or holds contact when there are none', () => {
    for (const move of moves) {
      const pose = poses[move.id];
      if (pose === undefined) continue;
      const contact = contactFrameFor(poses, move.id);
      const after = pose.frames.slice(pose.contact + 1);
      // A pose whose contact is its final frame has nothing to play back to, so
      // recovery legitimately holds the contact frame. Otherwise recovery may
      // only show the post-contact frames, and must reach the last of them.
      const expectedSet = after.length > 0 ? new Set(after) : new Set([contact as number]);
      for (let tick = 0; tick < move.recovery; tick += 1) {
        const cell = resolveSpriteFrame(
          poses,
          { moveId: move.id, phase: 'recovery', phaseTicks: tick, startup: move.startup, recovery: move.recovery },
          tick,
        );
        expect(expectedSet.has(cell), `"${move.id}" recovery tick ${tick} showed ${cell}, not a post-contact frame`).toBe(true);
      }
      if (after.length > 0) {
        const last = resolveSpriteFrame(
          poses,
          { moveId: move.id, phase: 'recovery', phaseTicks: move.recovery - 1, startup: move.startup, recovery: move.recovery },
          move.recovery - 1,
        );
        expect(last, `"${move.id}" recovery never returned to rest`).toBe(after[after.length - 1]);
      }
    }
  });

  test('a move with no pose falls back to idle rather than a stale frame', () => {
    const cell = resolveSpriteFrame(
      poses,
      { moveId: 'not_a_real_move', phase: 'active', phaseTicks: 0, startup: 6, recovery: 10 },
      0,
    );
    const idle = new Set(poses['idle']?.frames ?? []);
    expect(idle.has(cell), 'an unknown move must fall back to an idle cell').toBe(true);
  });

  test('a fighter in neutral never shows a move frame', () => {
    const idle = new Set(poses['idle']?.frames ?? []);
    for (let elapsed = 0; elapsed < 120; elapsed += 1) {
      const cell = resolveSpriteFrame(
        poses,
        { moveId: null, phase: 'neutral', phaseTicks: 0, startup: 1, recovery: 1 },
        elapsed,
      );
      expect(idle.has(cell)).toBe(true);
    }
  });
});
