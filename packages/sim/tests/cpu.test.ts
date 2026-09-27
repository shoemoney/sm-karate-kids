import { describe, expect, test } from 'vitest';
import {
  ARCHETYPES,
  CpuController,
  NEUTRAL_PAIR,
  createMatch,
  step,
  type ArchetypeId,
  type ContentBundle,
  type CpuArchetype,
  type MatchPhase,
  type MatchState,
} from '@smkk/sim';

/**
 * CpuController behaviour tests.
 *
 * These build a minimal hand-rolled ContentBundle instead of importing
 * @smkk/content: content depends on sim, so sim's own tests must not import
 * content back (that would invert the dependency). CpuController can now open
 * with any of the 20 grammar techniques (14 ground, 4 air, 2 reactive blocks —
 * see docs/balance.md), so this bundle carries frame data for all 20 rather
 * than a hand-picked subset, matching the real content table's values.
 */
function makeBundle(): ContentBundle {
  return {
    moves: [
      { id: 'lunge_punch', name: 'Lunge Punch', kind: 'strike', height: 'mid', posture: 'stand', startup: 6, active: 3, recovery: 10, reach: 1.55, value: 'half', advance: 0.25 },
      { id: 'jumping_punch', name: 'Jumping Punch', kind: 'strike', height: 'high', posture: 'air', startup: 8, active: 4, recovery: 14, reach: 1.5, value: 'full', advance: 0.6 },
      { id: 'crouching_punch', name: 'Crouching Punch', kind: 'strike', height: 'low', posture: 'crouch', startup: 5, active: 3, recovery: 9, reach: 1.35, value: 'half', advance: 0.1 },
      { id: 'stepping_lunge_punch', name: 'Stepping Lunge Punch', kind: 'strike', height: 'mid', posture: 'stand', startup: 9, active: 3, recovery: 13, reach: 1.95, value: 'full', advance: 0.75 },
      { id: 'back_fist', name: 'Back Fist', kind: 'strike', height: 'high', posture: 'stand', startup: 7, active: 3, recovery: 12, reach: 1.6, value: 'half', advance: -0.1 },
      { id: 'reverse_punch', name: 'Reverse Punch', kind: 'strike', height: 'mid', posture: 'stand', startup: 8, active: 3, recovery: 12, reach: 1.7, value: 'full', advance: 0.15 },
      { id: 'somersault_kick', name: 'Somersault Kick', kind: 'strike', height: 'high', posture: 'air', startup: 12, active: 5, recovery: 20, reach: 1.6, value: 'full', advance: 0.5 },
      { id: 'crouching_reverse_punch', name: 'Crouching Reverse Punch', kind: 'strike', height: 'low', posture: 'crouch', startup: 7, active: 3, recovery: 12, reach: 1.5, value: 'half', advance: 0.1 },
      { id: 'back_kick', name: 'Back Kick', kind: 'strike', height: 'mid', posture: 'stand', startup: 11, active: 4, recovery: 16, reach: 1.9, value: 'full', advance: 0.4 },
      { id: 'spinning_back_kick', name: 'Spinning Back Kick', kind: 'strike', height: 'high', posture: 'stand', startup: 14, active: 4, recovery: 20, reach: 2.0, value: 'full', advance: 0.2 },
      { id: 'front_kick', name: 'Front Kick', kind: 'strike', height: 'mid', posture: 'stand', startup: 9, active: 4, recovery: 13, reach: 1.85, value: 'half', advance: 0.2 },
      { id: 'jumping_front_kick', name: 'Jumping Front Kick', kind: 'strike', height: 'high', posture: 'air', startup: 11, active: 5, recovery: 18, reach: 1.9, value: 'full', advance: 0.8 },
      { id: 'rising_knee', name: 'Rising Knee', kind: 'strike', height: 'mid', posture: 'stand', startup: 7, active: 3, recovery: 11, reach: 1.3, value: 'half', advance: 0.15 },
      { id: 'roundhouse_kick', name: 'Roundhouse Kick', kind: 'strike', height: 'high', posture: 'stand', startup: 12, active: 4, recovery: 17, reach: 2.05, value: 'full', advance: 0.35 },
      { id: 'high_block', name: 'High Block', kind: 'block', height: 'high', posture: 'stand', startup: 3, active: 12, recovery: 6, reach: 0.9, value: 'half', advance: 0 },
      { id: 'foot_sweep', name: 'Foot Sweep', kind: 'strike', height: 'low', posture: 'stand', startup: 8, active: 4, recovery: 13, reach: 1.75, value: 'half', advance: 0.2 },
      { id: 'jumping_sweep_kick', name: 'Jumping Sweep Kick', kind: 'strike', height: 'mid', posture: 'air', startup: 10, active: 5, recovery: 16, reach: 1.8, value: 'full', advance: 0.7 },
      { id: 'low_sweep', name: 'Low Sweep', kind: 'strike', height: 'low', posture: 'crouch', startup: 7, active: 4, recovery: 12, reach: 1.7, value: 'half', advance: 0.15 },
      { id: 'leg_sweep', name: 'Leg Sweep', kind: 'strike', height: 'low', posture: 'stand', startup: 10, active: 4, recovery: 15, reach: 1.95, value: 'full', advance: 0.3 },
      { id: 'low_block', name: 'Low Block', kind: 'block', height: 'low', posture: 'stand', startup: 3, active: 12, recovery: 6, reach: 0.9, value: 'half', advance: 0 },
    ],
    fighters: [
      { id: 'a', name: 'A', giColor: '#f2f2ef', beltColor: '#1b1b1f', walkSpeed: 0.052, hitTolerance: 0.42 },
      { id: 'b', name: 'B', giColor: '#c8443c', beltColor: '#1b1b1f', walkSpeed: 0.052, hitTolerance: 0.42 },
    ],
    arenas: [{ id: 'test-dojo', name: 'Test Dojo', floorColor: '#c9a071', backdropColor: '#141a24', bounds: 5 }],
    rulesets: [{ id: 'test-classic', name: 'Test Classic', pointsToWin: 2, timerTicks: 1800, refereeTicks: 96, startSeparation: 3.2 }],
  };
}

const bundle = makeBundle();

function makeState(): MatchState {
  return createMatch({ content: bundle, rulesetId: 'test-classic', arenaId: 'test-dojo' });
}

/**
 * Setting `state.phase = 'fight'` directly makes TS's control-flow analysis narrow
 * `state.phase` to the literal `'fight'` for the rest of the scope, since it can't see
 * that `step()` mutates it internally — so a later `state.phase !== 'over'` check
 * would report the two literals as non-overlapping. Routing through a function whose
 * parameter is the widened `MatchPhase` union avoids that false narrowing.
 */
function setPhase(state: MatchState, phase: MatchPhase): void {
  state.phase = phase;
}

describe('determinism', () => {
  test('the same seed and the same match state always produce the same stick output', () => {
    const state = makeState();
    state.phase = 'fight';
    state.fighters[0].x = -1;
    state.fighters[1].x = 1;

    const cpuA = new CpuController(ARCHETYPES.pressure, 4242, 1);
    const cpuB = new CpuController(ARCHETYPES.pressure, 4242, 1);

    for (let tick = 0; tick < 200; tick += 1) {
      expect(cpuB.poll(state)).toEqual(cpuA.poll(state));
    }
  });
});

describe('no machine-gunning', () => {
  test('the right stick always passes back through neutral before firing again', () => {
    const state = makeState();
    setPhase(state, 'fight');
    // Start already inside the pocket (spacing + 0.2) so the attack roll is eligible
    // immediately, instead of depending on how many ticks the approach walk takes.
    state.fighters[0].x = 0;
    state.fighters[1].x = 1;
    const cpu = new CpuController(ARCHETYPES.pressure, 99, 0);

    let previousRight: string = 'neutral';
    let commits = 0;
    for (let tick = 0; tick < 4000 && state.phase !== 'over'; tick += 1) {
      const stick = cpu.poll(state);
      if (stick.right !== 'neutral') {
        commits += 1;
        expect(previousRight).toBe('neutral');
      }
      previousRight = stick.right;
      step(state, { p1: stick, p2: NEUTRAL_PAIR });
    }

    expect(commits).toBeGreaterThan(0);
  });
});

describe('spacing behaviour', () => {
  test('closes distance when out of range for its archetype spacing', () => {
    const state = makeState();
    state.phase = 'fight';
    const archetype = ARCHETYPES.sensei; // spacing 1.8
    state.fighters[0].x = -5;
    state.fighters[1].x = 5; // gap 10: far outside spacing + 0.2 regardless of the roll
    const cpu = new CpuController(archetype, 7, 0);

    const stick = cpu.poll(state);
    expect(stick.right).toBe('neutral');
    expect(stick.left).toBe('right'); // player 0 faces the opponent to its right; closing means walking toward it
  });

  test('backs off when closer than archetype spacing minus 0.5', () => {
    const state = makeState();
    state.phase = 'fight';
    // aggression: 1 guarantees the very first in-range poll commits (rng.next() < 1
    // is always true), which deterministically reaches a known cooldown state before
    // testing the back-off branch, without depending on the RNG stream at all.
    // blockChance/jumpChance: 0 keeps the forced commit a plain ground attack — the
    // foe never telegraphs (it never attacks at all in this isolated poll() test, so
    // it can never be blocked), and a jump would return right: 'neutral' instead of a
    // real commit, which is exactly what the first assertion below rules out.
    const archetype: CpuArchetype = {
      id: 'pressure',
      name: 'Forced Commit',
      spacing: 2,
      aggression: 1,
      patience: 20,
      blockChance: 0,
      jumpChance: 0,
    };
    state.fighters[0].x = 0;
    state.fighters[1].x = 1; // gap 1: inside spacing (2), so the guaranteed commit fires
    const cpu = new CpuController(archetype, 5, 0);

    const commitStick = cpu.poll(state);
    expect(commitStick.right).not.toBe('neutral');

    const holdStick = cpu.poll(state); // the mandatory neutral pass-through tick
    expect(holdStick).toEqual(NEUTRAL_PAIR);

    // cooldown is now > 0, so the roll branch is skipped outright and only the
    // movement branch can run: gap (1) is below spacing - 0.5 (1.5), so it backs off.
    const backoffStick = cpu.poll(state);
    expect(backoffStick.right).toBe('neutral');
    expect(backoffStick.left).toBe('left'); // away from the opponent at x=1
  });
});

describe('archetype distinguishability', () => {
  test('pressure commits more often than sensei, which commits more often than counter', () => {
    const TICKS = 5000;
    const commitCounts = new Map<ArchetypeId, number>();

    for (const id of ['sensei', 'pressure', 'counter'] as const) {
      const state = makeState();
      state.phase = 'fight';
      // A fixed gap inside every archetype's spacing (1.45 / 1.8 / 2.1) isolates
      // aggression and patience as the only variables in play.
      state.fighters[0].x = 0;
      state.fighters[1].x = 1;
      const cpu = new CpuController(ARCHETYPES[id], 314159, 0);

      let commits = 0;
      for (let tick = 0; tick < TICKS; tick += 1) {
        if (cpu.poll(state).right !== 'neutral') commits += 1;
      }
      commitCounts.set(id, commits);
    }

    const sensei = commitCounts.get('sensei') ?? 0;
    const pressure = commitCounts.get('pressure') ?? 0;
    const counter = commitCounts.get('counter') ?? 0;

    expect(pressure).toBeGreaterThan(sensei);
    expect(sensei).toBeGreaterThan(counter);
  });
});

describe('phase gating', () => {
  test('emits nothing but neutral when the match is not in the fight phase', () => {
    const state = makeState();
    const cpu = new CpuController(ARCHETYPES.pressure, 1, 1);

    for (const phase of ['ready', 'referee', 'over'] as MatchPhase[]) {
      state.phase = phase;
      expect(cpu.poll(state)).toEqual(NEUTRAL_PAIR);
    }
  });
});
