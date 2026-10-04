import { beforeEach, describe, expect, test } from 'vitest';
import { fighterOrder, loadPick, parsePick, savePick } from '../../src/fighterPick.js';

const ROSTER = ['shiro', 'aka'] as const;

class MemoryStorage {
  private readonly data = new Map<string, string>();
  getItem(key: string): string | null { return this.data.get(key) ?? null; }
  setItem(key: string, value: string): void { this.data.set(key, value); }
  removeItem(key: string): void { this.data.delete(key); }
}

beforeEach(() => {
  (globalThis as Record<string, unknown>)['localStorage'] = new MemoryStorage();
});

describe('which fighter the player is', () => {
  test('defaults to the first fighter in the roster', () => {
    expect(loadPick(new URLSearchParams(''), ROSTER)).toBe('shiro');
  });

  test('a saved pick survives a reload', () => {
    savePick('aka');
    expect(loadPick(new URLSearchParams(''), ROSTER)).toBe('aka');
  });

  test('?as= accepts the names players actually type, and wins over the saved pick', () => {
    savePick('aka');
    for (const raw of ['asmongold', 'Asmongold', 'asmon', 'shiro']) {
      expect(parsePick(raw, ROSTER), raw).toBe('shiro');
    }
    for (const raw of ['hasan', 'HasanAbi', 'hasanabi', 'aka']) {
      expect(parsePick(raw, ROSTER), raw).toBe('aka');
    }
    expect(loadPick(new URLSearchParams('as=asmongold'), ROSTER)).toBe('shiro');
  });

  test('anything unrecognised, saved or typed, falls back rather than throwing', () => {
    expect(parsePick('ryu', ROSTER)).toBeNull();
    localStorage.setItem('smkk:fighter', JSON.stringify('nobody'));
    expect(loadPick(new URLSearchParams('as=ryu'), ROSTER)).toBe('shiro');
  });

  test('the chosen fighter is player 1, the other is the opponent', () => {
    expect(fighterOrder('shiro', ROSTER)).toEqual(['shiro', 'aka']);
    expect(fighterOrder('aka', ROSTER)).toEqual(['aka', 'shiro']);
  });
});
