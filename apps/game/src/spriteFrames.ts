/**
 * Which atlas cell a fighter shows this tick, as a pure function.
 *
 * Split out of spriteRig.ts so the rule that decides a fighter's frame is
 * testable without a GPU, a canvas, or a render loop — and so the e2e suite
 * can assert the same function the renderer draws from. Nothing here imports
 * three.js or touches the DOM; it is arithmetic over the atlas manifest.
 */
import type { Phase } from '@smkk/sim';

export const IDLE_POSE = 'idle';
/** Ticks an idle frame holds before advancing, a slow loop rather than a still image. */
export const IDLE_FRAME_HOLD_TICKS = 10;

/** One move's frames as packed into the atlas, plus which one is the contact. */
export interface SpritePose {
  /** Atlas cell indices, in play order. */
  readonly frames: readonly number[];
  /** Index *into `frames`* of the contact frame, not an atlas cell. */
  readonly contact: number;
  readonly fps?: number;
}

export type SpritePoses = Readonly<Record<string, SpritePose>>;

/** Everything frame selection needs from a fighter, decoupled from FighterState. */
export interface FrameQuery {
  readonly moveId: string | null;
  readonly phase: Phase;
  readonly phaseTicks: number;
  /** Ticks in the move's startup window; ignored unless phase is 'startup'. */
  readonly startup: number;
  /** Ticks in the move's recovery window; ignored unless phase is 'recovery'. */
  readonly recovery: number;
}

function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

function pickRamped(frames: readonly number[], phaseTicks: number, totalTicks: number): number | undefined {
  if (frames.length === 0) return undefined;
  const t = clamp01(phaseTicks / Math.max(1, totalTicks));
  const index = Math.min(frames.length - 1, Math.floor(t * frames.length));
  return frames[index];
}

function idleFrame(poses: SpritePoses, elapsedTicks: number): number {
  const idle = poses[IDLE_POSE];
  if (idle === undefined || idle.frames.length === 0) return 0;
  const index = Math.floor(elapsedTicks / IDLE_FRAME_HOLD_TICKS) % idle.frames.length;
  return idle.frames[index] ?? 0;
}

/** The atlas cell a pose declares as its contact frame, or undefined if the pose is unusable. */
export function contactFrameFor(poses: SpritePoses, moveId: string): number | undefined {
  const pose = poses[moveId];
  if (pose === undefined) return undefined;
  return pose.frames[pose.contact];
}

/** True when the pack has real animation for this move rather than falling back to idle. */
export function hasPoseFor(poses: SpritePoses, moveId: string): boolean {
  const pose = poses[moveId];
  return pose !== undefined && pose.frames.length > 0 && pose.frames[pose.contact] !== undefined;
}

/**
 * The frame a fighter shows this tick. The referee's decision is made during
 * `active`, so that whole window holds the pose's `contact` frame — never a
 * frame mid-ramp toward or away from it. `frozen` holds it too, because a
 * frozen fighter is frozen on the frame the referee stopped it at.
 */
export function resolveSpriteFrame(poses: SpritePoses, query: FrameQuery, elapsedTicks: number): number {
  const { moveId, phase, phaseTicks, startup, recovery } = query;
  if (moveId === null) return idleFrame(poses, elapsedTicks);

  const pose = poses[moveId];
  if (pose === undefined) return idleFrame(poses, elapsedTicks);

  const contact = pose.frames[pose.contact];
  if (contact === undefined) return idleFrame(poses, elapsedTicks);

  if (phase === 'startup') {
    return pickRamped(pose.frames.slice(0, pose.contact), phaseTicks, startup) ?? contact;
  }
  if (phase === 'recovery') {
    return pickRamped(pose.frames.slice(pose.contact + 1), phaseTicks, recovery) ?? contact;
  }
  // 'active' and 'frozen' both hold the referee's frame.
  return contact;
}
