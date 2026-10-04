import { loadValue, saveValue } from './persist.js';

/**
 * Which fighter the player is. Player 1 is always the human on the left; this
 * decides whose spec sits there. Kept apart from `Settings` on purpose:
 * `isSettings` rejects any shape it does not know, so a new field there would
 * have reset every returning player's saved preferences.
 */
const KEY = 'fighter';

/** Names a player might type in `?as=`, mapped to roster ids. */
const ALIASES: Readonly<Record<string, string>> = {
  asmongold: 'shiro',
  asmon: 'shiro',
  hasan: 'aka',
  hasanabi: 'aka',
};

export function parsePick(raw: string | null | undefined, roster: readonly string[]): string | null {
  if (raw === null || raw === undefined) return null;
  const key = raw.trim().toLowerCase();
  const id = ALIASES[key] ?? key;
  return roster.includes(id) ? id : null;
}

/** `?as=` for this session, else the saved pick, else the roster's first fighter. */
export function loadPick(params: URLSearchParams, roster: readonly string[]): string {
  const fromUrl = parsePick(params.get('as'), roster);
  if (fromUrl !== null) return fromUrl;
  const saved = loadValue(KEY, (value): value is string => typeof value === 'string' && roster.includes(value), '');
  return saved !== '' ? saved : roster[0]!;
}

export function savePick(id: string): void {
  saveValue(KEY, id);
}

/** Player 1's and player 2's fighter ids for a bout where the player is `pick`. */
export function fighterOrder(pick: string, roster: readonly string[]): [string, string] {
  const other = roster.find((id) => id !== pick) ?? roster[1]!;
  return [pick, other];
}
