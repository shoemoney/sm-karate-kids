import { describe, expect, test } from 'vitest';
import {
  createMatch,
  step,
  scores,
  CpuController,
  ARCHETYPES,
  NEUTRAL_FRAME,
  type MatchState,
  type MatchEvent,
  type ContentBundle,
  type InputFrame,
  type StickPair,
} from '@smkk/sim';
import { content as realContent } from '../src/index.js';

// A small, hand-built content bundle so every technique's timing is exact and
// cheap to step through by hand. Move ids must be real grammar ids (the input
// grammar is fixed, independent of content), but their frame data is ours.
const customContent: ContentBundle = {
  moves: [
    // forward + neutral -> lunge_punch: fast, half-value, mid strike.
    { id: 'lunge_punch', name: 'Lunge Punch', kind: 'strike', height: 'mid', posture: 'stand', startup: 2, active: 2, recovery: 6, reach: 1.2, value: 'half', advance: 0 },
    // back + neutral -> reverse_punch: slow startup, used only as "the defender is committed".
    { id: 'reverse_punch', name: 'Reverse Punch', kind: 'strike', height: 'mid', posture: 'stand', startup: 6, active: 2, recovery: 6, reach: 1.2, value: 'full', advance: 0 },
    // up + neutral -> front_kick: fast, full-value, high strike.
    { id: 'front_kick', name: 'Front Kick', kind: 'strike', height: 'high', posture: 'stand', startup: 2, active: 2, recovery: 6, reach: 1.2, value: 'full', advance: 0 },
    // down + neutral -> foot_sweep: fast, half-value, low strike.
    { id: 'foot_sweep', name: 'Foot Sweep', kind: 'strike', height: 'low', posture: 'stand', startup: 2, active: 2, recovery: 6, reach: 1.2, value: 'half', advance: 0 },
    // up + back -> high_block: near-instant, long active window.
    { id: 'high_block', name: 'High Block', kind: 'block', height: 'high', posture: 'stand', startup: 1, active: 10, recovery: 3, reach: 0.9, value: 'half', advance: 0 },
  ],
  fighters: [
    { id: 'f1', name: 'F1', giColor: '#ffffff', beltColor: '#000000', walkSpeed: 0.1, hitTolerance: 0.5 },
    { id: 'f2', name: 'F2', giColor: '#ffffff', beltColor: '#000000', walkSpeed: 0.1, hitTolerance: 0.5 },
  ],
  arenas: [{ id: 'a1', name: 'Arena', floorColor: '#ffffff', backdropColor: '#000000', bounds: 5 }],
  rulesets: [{ id: 'r1', name: 'R1', pointsToWin: 2, timerTicks: 60, refereeTicks: 5, startSeparation: 1 }],
};

function advanceToFight(state: MatchState): void {
  while (state.phase === 'ready') step(state, NEUTRAL_FRAME);
}

function runOutReferee(state: MatchState): void {
  while (state.phase === 'referee') step(state, NEUTRAL_FRAME);
}

function freshMatch(): MatchState {
  const state = createMatch({ content: customContent, rulesetId: 'r1', arenaId: 'a1' });
  advanceToFight(state);
  return state;
}

const NEUTRAL_STICK: StickPair = { left: 'neutral', right: 'neutral' };

function findCall(events: readonly MatchEvent[]): Extract<MatchEvent, { type: 'call' }> {
  const call = events.find((event) => event.type === 'call');
  if (call === undefined || call.type !== 'call') throw new Error('expected a call event');
  return call;
}

describe('phase and clock', () => {
  test('a match starts in ready, moves to fight, and the timer only ticks in fight', () => {
    const state = createMatch({ content: realContent });
    expect(state.phase).toBe('ready');
    const startingTimer = state.timerTicks;

    while (state.phase === 'ready') {
      step(state, NEUTRAL_FRAME);
      expect(state.timerTicks).toBe(startingTimer);
    }

    expect(state.phase).toBe('fight');
    step(state, NEUTRAL_FRAME);
    expect(state.timerTicks).toBe(startingTimer - 1);
  });
});

describe('no health bar', () => {
  test('fighters and match state carry no damage or health field', () => {
    const state = createMatch({ content: realContent });
    for (const fighter of state.fighters) {
      expect(fighter).not.toHaveProperty('health');
      expect(fighter).not.toHaveProperty('hp');
      expect(fighter).not.toHaveProperty('damage');
    }
    expect(state).not.toHaveProperty('health');
    expect(state).not.toHaveProperty('hp');
    expect(state).not.toHaveProperty('damage');
  });

  test('scores change only on ticks that carry a referee call event', () => {
    const state = createMatch({ content: realContent });
    const cpu0 = new CpuController(ARCHETYPES.pressure, 101, 0);
    const cpu1 = new CpuController(ARCHETYPES.counter, 202, 1);
    advanceToFight(state);

    for (let i = 0; i < 3000 && state.phase !== 'over'; i += 1) {
      const before = scores(state);
      const frame: InputFrame = { p1: cpu0.poll(state), p2: cpu1.poll(state) };
      const events = step(state, frame);
      const after = scores(state);
      const hadCall = events.some((event) => event.type === 'call');
      if (hadCall) {
        expect(after).not.toEqual(before);
      } else {
        expect(after).toEqual(before);
      }
    }
  });
});

describe('exchanges, scoring, and the referee', () => {
  test('one clean contact ends the exchange: phase becomes referee', () => {
    const state = freshMatch();
    step(state, { p1: { left: 'neutral', right: 'right' }, p2: NEUTRAL_STICK }); // p1 commits lunge_punch
    const events = step(state, NEUTRAL_FRAME); // active tick: connects
    expect(events.some((event) => event.type === 'contact')).toBe(true);
    expect(state.phase).toBe('referee');
  });

  test('after the referee period, fighters reset to the ruleset start separation', () => {
    const state = freshMatch();
    step(state, { p1: { left: 'neutral', right: 'right' }, p2: NEUTRAL_STICK });
    step(state, NEUTRAL_FRAME);
    expect(state.phase).toBe('referee');

    runOutReferee(state);

    expect(state.phase).toBe('fight');
    const [a, b] = state.fighters;
    expect(a.x).toBeCloseTo(-0.5, 10);
    expect(b.x).toBeCloseTo(0.5, 10);
  });

  test('a half-value move with no counter awards exactly 0.5 points', () => {
    const state = freshMatch();
    step(state, { p1: { left: 'neutral', right: 'right' }, p2: NEUTRAL_STICK }); // lunge_punch, half
    const events = step(state, NEUTRAL_FRAME);
    const call = findCall(events);
    expect(call.call.value).toBe('half');
    expect(call.call.counter).toBe(false);
    expect(state.fighters[0].score).toBe(0.5);
  });

  test('a full-value move awards exactly 1 point', () => {
    const state = freshMatch();
    step(state, { p1: { left: 'neutral', right: 'up' }, p2: NEUTRAL_STICK }); // front_kick, full
    const events = step(state, NEUTRAL_FRAME);
    const call = findCall(events);
    expect(call.call.value).toBe('full');
    expect(state.fighters[0].score).toBe(1);
  });

  test('a counter-hit on a defender still in startup upgrades a half move to a full call', () => {
    const state = freshMatch();
    // p1 fires the fast lunge_punch while p2 commits to the slow reverse_punch.
    step(state, {
      p1: { left: 'neutral', right: 'right' },
      p2: { left: 'neutral', right: 'right' },
    });
    const events = step(state, NEUTRAL_FRAME);
    // Sanity: this is genuinely a startup counter, the only phase the current rule
    // rewards — see match.ts scoreFor. Without this, the test would still pass on a
    // regression that widened counter back out to active/recovery.
    expect(state.fighters[1].phase).toBe('startup');
    const call = findCall(events);
    expect(call.call.scorer).toBe(0);
    expect(call.call.counter).toBe(true);
    expect(call.call.value).toBe('full');
  });

  test('a hit on a defender already in recovery is a clean hit, not a counter', () => {
    // scoreFor narrowed "counter" to defender.phase === 'startup' only — beating the
    // opponent to the punch. Landing on someone who already whiffed and is on their
    // way out (active or recovery) is a clean, well-timed hit at the move's own base
    // value, not an automatic full-point upgrade. Before that change this exact
    // scenario (defender in recovery) would have scored counter=true, value='full'.
    const state = freshMatch();
    // p2 throws the high front_kick; p1 crouches to duck it (crouch beats a high
    // strike — see "posture beats height" below), so p2's own swing whiffs and it
    // settles into recovery having landed nothing on anyone.
    step(state, { p1: { left: 'down', right: 'neutral' }, p2: { left: 'neutral', right: 'up' } });
    step(state, { p1: { left: 'down', right: 'neutral' }, p2: NEUTRAL_STICK });
    step(state, { p1: { left: 'down', right: 'neutral' }, p2: NEUTRAL_STICK });
    step(state, { p1: { left: 'down', right: 'neutral' }, p2: NEUTRAL_STICK }); // p2 is now in recovery
    step(state, { p1: NEUTRAL_STICK, p2: NEUTRAL_STICK }); // p1 stands back up
    step(state, { p1: { left: 'neutral', right: 'right' }, p2: NEUTRAL_STICK }); // p1 starts lunge_punch (half-value)
    const events = step(state, NEUTRAL_FRAME); // p1's active tick: connects while p2 is still in recovery

    // Sanity: prove we actually landed in the recovery window, not startup or active.
    expect(state.fighters[1].phase).toBe('recovery');
    const call = findCall(events);
    expect(call.call.scorer).toBe(0);
    expect(call.call.counter).toBe(false);
    expect(call.call.value).toBe('half');
  });

  test('first fighter to reach pointsToWin wins and the match ends', () => {
    const state = freshMatch();
    for (let round = 0; round < 4; round += 1) {
      step(state, { p1: { left: 'neutral', right: 'right' }, p2: NEUTRAL_STICK });
      step(state, NEUTRAL_FRAME);
      runOutReferee(state);
    }
    expect(state.phase).toBe('over');
    expect(state.winner).toBe(0);
    expect(state.fighters[0].score).toBe(2);
    expect(state.draw).toBe(false);
  });
});

describe('posture beats height', () => {
  test('a crouching fighter is missed by a high strike', () => {
    const state = freshMatch();
    step(state, {
      p1: { left: 'neutral', right: 'up' }, // front_kick (high)
      p2: { left: 'down', right: 'neutral' }, // crouch
    });
    const events = step(state, { p1: NEUTRAL_STICK, p2: { left: 'down', right: 'neutral' } });

    expect(events.some((event) => event.type === 'contact')).toBe(false);
    expect(events.some((event) => event.type === 'blocked')).toBe(false);
    expect(state.fighters[1].score).toBe(0);
    expect(state.phase).toBe('fight');
  });

  test('an airborne fighter is missed by a low strike', () => {
    const state = freshMatch();
    step(state, {
      p1: { left: 'neutral', right: 'down' }, // foot_sweep (low)
      p2: { left: 'up', right: 'neutral' }, // jump
    });
    const events = step(state, NEUTRAL_FRAME);

    expect(events.some((event) => event.type === 'contact')).toBe(false);
    expect(state.fighters[1].score).toBe(0);
    expect(state.fighters[1].airborne).toBeGreaterThan(0);
  });
});

describe('blocking', () => {
  test('an active high_block stops a high strike with a blocked event and no score change', () => {
    const state = freshMatch();
    step(state, {
      p1: { left: 'neutral', right: 'up' }, // front_kick (high)
      p2: { left: 'right', right: 'up' }, // high_block
    });
    const events = step(state, NEUTRAL_FRAME);

    expect(events.some((event) => event.type === 'blocked')).toBe(true);
    expect(events.some((event) => event.type === 'contact')).toBe(false);
    expect(state.fighters[0].score).toBe(0);
    expect(state.fighters[1].score).toBe(0);
  });
});

describe('timeout', () => {
  test('running the clock out with neutral input produces a timeout event and a draw', () => {
    const state = freshMatch();
    let allEvents: MatchEvent[] = [];
    while (state.phase === 'fight') {
      allEvents = allEvents.concat(step(state, NEUTRAL_FRAME));
    }

    expect(allEvents.some((event) => event.type === 'timeout')).toBe(true);
    expect(state.phase).toBe('over');
    expect(state.draw).toBe(true);
    expect(state.winner).toBeNull();
    expect(state.fighters[0].score).toBe(0);
    expect(state.fighters[1].score).toBe(0);
  });
});
