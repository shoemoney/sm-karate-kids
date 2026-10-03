import type { FighterSpec, HeightBand, MoveSpec, Posture } from './content.js';
import type { Dir4 } from './input.js';

export type Phase = 'neutral' | 'startup' | 'active' | 'recovery' | 'frozen';

export interface FighterState {
  spec: FighterSpec;
  x: number;
  facing: 1 | -1;
  phase: Phase;
  phaseTicks: number;
  move: MoveSpec | null;
  /** Ticks remaining in the jump arc. Zero means grounded. */
  airborne: number;
  crouching: boolean;
  /** Set while the left stick asks to crouch; drives posture next tick. */
  score: number;
  previousRight: Dir4;
  /** True once this strike's block has been announced; cleared when a move begins. */
  blockReported: boolean;
}

export const JUMP_TICKS = 34;
const JUMP_APEX = 1.5;

export function createFighter(spec: FighterSpec, x: number, facing: 1 | -1): FighterState {
  return {
    spec,
    x,
    facing,
    phase: 'neutral',
    phaseTicks: 0,
    move: null,
    airborne: 0,
    crouching: false,
    score: 0,
    previousRight: 'neutral',
    blockReported: false,
  };
}

export function postureOf(fighter: FighterState): Posture {
  if (fighter.airborne > 0) return 'air';
  if (fighter.crouching) return 'crouch';
  return 'stand';
}

/** Height in metres above the floor, for presentation and for nothing else. */
export function heightOf(fighter: FighterState): number {
  if (fighter.airborne <= 0) return 0;
  const progress = 1 - fighter.airborne / JUMP_TICKS;
  return JUMP_APEX * 4 * progress * (1 - progress);
}

const VULNERABLE: Record<Posture, readonly HeightBand[]> = {
  stand: ['low', 'mid', 'high'],
  crouch: ['low', 'mid'],
  air: ['mid', 'high'],
};

export function isVulnerableTo(fighter: FighterState, band: HeightBand): boolean {
  return VULNERABLE[postureOf(fighter)].includes(band);
}

/** A block only covers its own band plus mid, and only while it is active. */
export function blocksBand(fighter: FighterState, band: HeightBand): boolean {
  if (fighter.phase !== 'active' || fighter.move === null) return false;
  if (fighter.move.kind !== 'block') return false;
  if (fighter.move.height === band) return true;
  return band === 'mid';
}

export function strikePoint(fighter: FighterState): number {
  if (fighter.move === null) return fighter.x;
  return fighter.x + fighter.facing * fighter.move.reach;
}

export function beginMove(fighter: FighterState, move: MoveSpec): void {
  fighter.move = move;
  fighter.phase = 'startup';
  fighter.phaseTicks = 0;
  fighter.blockReported = false;
}

export function resetToStance(fighter: FighterState, x: number, facing: 1 | -1): void {
  fighter.x = x;
  fighter.facing = facing;
  fighter.phase = 'neutral';
  fighter.phaseTicks = 0;
  fighter.move = null;
  fighter.airborne = 0;
  fighter.crouching = false;
  fighter.previousRight = 'neutral';
  fighter.blockReported = false;
}
