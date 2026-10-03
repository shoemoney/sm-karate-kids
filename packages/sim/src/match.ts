import { fnv1a, hex8 } from './checksum.js';
import type { ArenaSpec, ContentBundle, MoveSpec, RulesetSpec } from './content.js';
import { indexMoves } from './content.js';
import {
  beginMove,
  createFighter,
  heightOf,
  isVulnerableTo,
  blocksBand,
  JUMP_TICKS,
  postureOf,
  resetToStance,
  strikePoint,
  type FighterState,
} from './fighter.js';
import { parseCommand } from './grammar.js';
import type { InputFrame, StickPair } from './input.js';

export type PlayerIndex = 0 | 1;
export type CallValue = 'half' | 'full';

export interface RefereeCall {
  readonly scorer: PlayerIndex;
  readonly value: CallValue;
  readonly moveId: string;
  readonly counter: boolean;
  readonly tick: number;
}

export type MatchEvent =
  | { type: 'move_start'; player: PlayerIndex; moveId: string }
  | { type: 'contact'; player: PlayerIndex; moveId: string; value: CallValue; counter: boolean }
  | { type: 'blocked'; player: PlayerIndex; moveId: string }
  | { type: 'simultaneous' }
  | { type: 'call'; call: RefereeCall }
  | { type: 'exchange_reset' }
  | { type: 'timeout' }
  | { type: 'match_over'; winner: PlayerIndex | null };

export type MatchPhase = 'ready' | 'fight' | 'referee' | 'over';

export interface MatchState {
  tick: number;
  phase: MatchPhase;
  phaseTicks: number;
  timerTicks: number;
  fighters: [FighterState, FighterState];
  lastCall: RefereeCall | null;
  winner: PlayerIndex | null;
  draw: boolean;
  events: MatchEvent[];
  readonly ruleset: RulesetSpec;
  readonly arena: ArenaSpec;
  /** The opening distance in force for this match, after any override. */
  readonly separation: number;
  readonly moves: ReadonlyMap<string, MoveSpec>;
}

const READY_TICKS = 72;

export interface MatchOptions {
  readonly content: ContentBundle;
  readonly rulesetId?: string;
  readonly arenaId?: string;
  /**
   * Overrides the ruleset's opening distance, in metres. The dojo uses this so
   * a student can drill a technique from the range it actually lands at
   * instead of walking in from the ruleset distance every repetition.
   */
  readonly startSeparation?: number;
}

function pick<T extends { id: string }>(items: readonly T[], id: string | undefined, label: string): T {
  const found = id === undefined ? items[0] : items.find((item) => item.id === id);
  if (found === undefined) throw new Error(`unknown ${label}: ${String(id)}`);
  return found;
}

export function createMatch(options: MatchOptions): MatchState {
  const ruleset = pick(options.content.rulesets, options.rulesetId, 'ruleset');
  const arena = pick(options.content.arenas, options.arenaId, 'arena');
  const first = options.content.fighters[0];
  const second = options.content.fighters[1];
  if (first === undefined || second === undefined) {
    throw new Error('a bout needs exactly two fighters');
  }
  const separation = Math.max(
    0.8,
    Math.min(options.startSeparation ?? ruleset.startSeparation, arena.bounds * 1.6),
  );
  const half = separation / 2;

  return {
    tick: 0,
    phase: 'ready',
    phaseTicks: 0,
    timerTicks: ruleset.timerTicks,
    fighters: [createFighter(first, -half, 1), createFighter(second, half, -1)],
    lastCall: null,
    winner: null,
    draw: false,
    events: [],
    ruleset,
    arena,
    separation,
    moves: indexMoves(options.content),
  };
}

function applyCommand(
  state: MatchState,
  fighter: FighterState,
  sticks: StickPair,
  events: MatchEvent[],
  player: PlayerIndex,
): void {
  const command = parseCommand(sticks, fighter.previousRight, fighter.facing);
  fighter.previousRight = sticks.right;

  if (fighter.phase !== 'neutral') return;

  if (command.kind === 'attack') {
    const move = state.moves.get(command.moveId);
    if (move === undefined) return;
    // Air techniques need air; grounded techniques need ground.
    const posture = postureOf(fighter);
    if (move.posture === 'air' && posture !== 'air') return;
    if (move.posture !== 'air' && posture === 'air') return;
    if (move.posture === 'crouch') fighter.crouching = true;
    beginMove(fighter, move);
    events.push({ type: 'move_start', player, moveId: move.id });
    return;
  }

  if (fighter.airborne > 0) return;

  if (command.kind === 'jump') {
    fighter.airborne = JUMP_TICKS;
    fighter.crouching = false;
    return;
  }

  fighter.crouching = command.kind === 'crouch';
  if (command.kind === 'walk') {
    const direction = command.direction === 'forward' ? fighter.facing : -fighter.facing;
    fighter.x += direction * fighter.spec.walkSpeed;
  }
}

function advanceMovePhase(fighter: FighterState): void {
  if (fighter.move === null) {
    fighter.phase = 'neutral';
    return;
  }
  const move = fighter.move;
  fighter.phaseTicks += 1;

  if (fighter.phase === 'startup') {
    fighter.x += fighter.facing * (move.advance / (move.startup + move.active));
    if (fighter.phaseTicks >= move.startup) {
      fighter.phase = 'active';
      fighter.phaseTicks = 0;
    }
    return;
  }
  if (fighter.phase === 'active') {
    fighter.x += fighter.facing * (move.advance / (move.startup + move.active));
    if (fighter.phaseTicks >= move.active) {
      fighter.phase = 'recovery';
      fighter.phaseTicks = 0;
    }
    return;
  }
  if (fighter.phase === 'recovery' && fighter.phaseTicks >= move.recovery) {
    fighter.phase = 'neutral';
    fighter.phaseTicks = 0;
    fighter.move = null;
    fighter.crouching = false;
  }
}

function connects(attacker: FighterState, defender: FighterState): boolean {
  if (attacker.phase !== 'active' || attacker.move === null) return false;
  if (attacker.move.kind !== 'strike') return false;
  const distance = Math.abs(strikePoint(attacker) - defender.x);
  if (distance > defender.spec.hitTolerance) return false;
  if (!isVulnerableTo(defender, attacker.move.height)) return false;
  return true;
}

function clampToArena(state: MatchState): void {
  const limit = state.arena.bounds;
  const [a, b] = state.fighters;
  const minGap = 0.7;

  // Separate first, then clamp. Clamping first and pushing afterwards shoves a
  // fighter who is already pinned to the wall straight through it.
  const gap = b.x - a.x;
  if (gap < minGap) {
    const push = (minGap - gap) / 2;
    a.x -= push;
    b.x += push;
  }
  for (const fighter of state.fighters) {
    fighter.x = Math.max(-limit, Math.min(limit, fighter.x));
  }
  a.facing = b.x >= a.x ? 1 : -1;
  b.facing = a.x > b.x ? 1 : -1;
}

function scoreFor(attacker: FighterState, defender: FighterState): { value: CallValue; counter: boolean } {
  // A counter is beating the opponent to the punch — landing while they are
  // still winding up. Punishing a whiff on the way out is a clean hit, not a
  // counter; treating it as one made four calls in five an ippon and left the
  // half point vestigial.
  const counter = defender.phase === 'startup';
  const move = attacker.move;
  const base: CallValue = move !== null && move.value === 'full' ? 'full' : 'half';
  return { value: counter ? 'full' : base, counter };
}

function pointsOf(value: CallValue): number {
  return value === 'full' ? 1 : 0.5;
}

function awardCall(state: MatchState, call: RefereeCall): void {
  state.lastCall = call;
  state.fighters[call.scorer].score += pointsOf(call.value);
  state.events.push({ type: 'call', call });
  state.phase = 'referee';
  state.phaseTicks = 0;
}

function resetExchange(state: MatchState): void {
  const half = state.separation / 2;
  resetToStance(state.fighters[0], -half, 1);
  resetToStance(state.fighters[1], half, -1);
  state.events.push({ type: 'exchange_reset' });
}

function finish(state: MatchState, winner: PlayerIndex | null): void {
  state.phase = 'over';
  state.phaseTicks = 0;
  state.winner = winner;
  state.draw = winner === null;
  state.events.push({ type: 'match_over', winner });
}

/** Advances the match exactly one tick. This is the only way state changes. */
export function step(state: MatchState, frame: InputFrame): readonly MatchEvent[] {
  state.events = [];
  state.tick += 1;

  if (state.phase === 'over') return state.events;

  if (state.phase === 'ready') {
    state.phaseTicks += 1;
    if (state.phaseTicks >= READY_TICKS) {
      state.phase = 'fight';
      state.phaseTicks = 0;
    }
    return state.events;
  }

  if (state.phase === 'referee') {
    state.phaseTicks += 1;
    if (state.phaseTicks < state.ruleset.refereeTicks) return state.events;
    const [a, b] = state.fighters;
    if (a.score >= state.ruleset.pointsToWin) {
      finish(state, 0);
      return state.events;
    }
    if (b.score >= state.ruleset.pointsToWin) {
      finish(state, 1);
      return state.events;
    }
    resetExchange(state);
    state.phase = 'fight';
    state.phaseTicks = 0;
    return state.events;
  }

  const sticks: [StickPair, StickPair] = [frame.p1, frame.p2];
  for (const index of [0, 1] as PlayerIndex[]) {
    applyCommand(state, state.fighters[index], sticks[index], state.events, index);
  }

  for (const fighter of state.fighters) {
    if (fighter.airborne > 0) fighter.airborne -= 1;
    if (fighter.phase !== 'neutral') advanceMovePhase(fighter);
  }

  clampToArena(state);

  const [p1, p2] = state.fighters;
  const p1Hits = connects(p1, p2);
  const p2Hits = connects(p2, p1);
  const p1Blocked = p1Hits && p1.move !== null && blocksBand(p2, p1.move.height);
  const p2Blocked = p2Hits && p2.move !== null && blocksBand(p1, p2.move.height);

  // A strike stays active for several ticks; announce its block once.
  if (p1Hits && p1Blocked && !p1.blockReported) {
    p1.blockReported = true;
    state.events.push({ type: 'blocked', player: 0, moveId: p1.move?.id ?? '' });
  }
  if (p2Hits && p2Blocked && !p2.blockReported) {
    p2.blockReported = true;
    state.events.push({ type: 'blocked', player: 1, moveId: p2.move?.id ?? '' });
  }

  const p1Scores = p1Hits && !p1Blocked;
  const p2Scores = p2Hits && !p2Blocked;

  if (p1Scores && p2Scores) {
    state.events.push({ type: 'simultaneous' });
    state.phase = 'referee';
    state.phaseTicks = 0;
    state.lastCall = null;
  } else if (p1Scores) {
    const { value, counter } = scoreFor(p1, p2);
    state.events.push({ type: 'contact', player: 0, moveId: p1.move?.id ?? '', value, counter });
    awardCall(state, { scorer: 0, value, moveId: p1.move?.id ?? '', counter, tick: state.tick });
  } else if (p2Scores) {
    const { value, counter } = scoreFor(p2, p1);
    state.events.push({ type: 'contact', player: 1, moveId: p2.move?.id ?? '', value, counter });
    awardCall(state, { scorer: 1, value, moveId: p2.move?.id ?? '', counter, tick: state.tick });
  }

  if (state.phase === 'fight') {
    state.timerTicks -= 1;
    if (state.timerTicks <= 0) {
      state.timerTicks = 0;
      state.events.push({ type: 'timeout' });
      const [a, b] = state.fighters;
      finish(state, a.score === b.score ? null : a.score > b.score ? 0 : 1);
    }
  }

  return state.events;
}

const q = (value: number): number => Math.round(value * 10000);

/** A stable fingerprint of everything the simulation owns. */
export function checksumOf(state: MatchState): string {
  const parts: string[] = [
    String(state.tick),
    state.phase,
    String(state.phaseTicks),
    String(state.timerTicks),
    state.winner === null ? 'n' : String(state.winner),
    state.draw ? 'd' : '-',
  ];
  for (const fighter of state.fighters) {
    parts.push(
      String(q(fighter.x)),
      String(fighter.facing),
      fighter.phase,
      String(fighter.phaseTicks),
      fighter.move?.id ?? '-',
      String(fighter.airborne),
      fighter.crouching ? 'c' : '-',
      String(q(fighter.score)),
      String(q(heightOf(fighter))),
    );
  }
  return hex8(fnv1a(parts.join('|')));
}

export function scores(state: MatchState): [number, number] {
  return [state.fighters[0].score, state.fighters[1].score];
}
