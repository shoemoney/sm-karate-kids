import { describe, expect, test } from 'vitest';
import { NEUTRAL_FRAME, createMatch, step, type ContentBundle, type MoveSpec } from '@smkk/sim';

const lunge: MoveSpec = { id: 'lunge_punch', name: 'Lunge Punch', kind: 'strike', height: 'mid', posture: 'stand', startup: 6, active: 3, recovery: 10, reach: 1.55, value: 'half', advance: 0.25 };
const block: MoveSpec = { id: 'high_block', name: 'High Block', kind: 'block', height: 'high', posture: 'stand', startup: 3, active: 12, recovery: 6, reach: 0.9, value: 'half', advance: 0 };

const bundle: ContentBundle = {
  moves: [lunge, block],
  fighters: [
    { id: 'a', name: 'A', giColor: '#f2f2ef', beltColor: '#1b1b1f', walkSpeed: 0.052, hitTolerance: 0.42 },
    { id: 'b', name: 'B', giColor: '#c8443c', beltColor: '#1b1b1f', walkSpeed: 0.052, hitTolerance: 0.42 },
  ],
  arenas: [{ id: 'test-dojo', name: 'Test Dojo', floorColor: '#c9a071', backdropColor: '#141a24', bounds: 5 }],
  rulesets: [{ id: 'test-classic', name: 'Test Classic', pointsToWin: 2, timerTicks: 1800, refereeTicks: 96, startSeparation: 3.2 }],
};

describe('a strike into a live block', () => {
  test('announces the block once, not on every active tick', () => {
    const state = createMatch({ content: bundle });
    state.phase = 'fight';
    const [attacker, defender] = state.fighters;
    attacker.x = 0;
    attacker.move = lunge;
    attacker.phase = 'active';
    attacker.phaseTicks = 0;
    defender.x = lunge.reach;
    defender.move = block;
    defender.phase = 'active';
    defender.phaseTicks = 0;

    let blocked = 0;
    let contact = 0;
    for (let i = 0; i < lunge.active; i += 1) {
      for (const event of step(state, NEUTRAL_FRAME)) {
        if (event.type === 'blocked') blocked += 1;
        if (event.type === 'contact') contact += 1;
      }
    }
    expect(blocked).toBe(1);
    expect(contact).toBe(0);
  });
});
