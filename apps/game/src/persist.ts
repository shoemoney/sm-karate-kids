/**
 * A tiny typed localStorage wrapper. Private browsing, blocked storage, quota
 * errors, and hand-edited corrupt JSON must never throw past this module —
 * every read falls back to a validated default and every write is best-effort.
 */

const NAMESPACE = 'smkk:';

function readRaw(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(NAMESPACE + key) ?? null;
  } catch {
    return null;
  }
}

function writeRaw(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(NAMESPACE + key, value);
  } catch {
    // Storage blocked, full, or unavailable (private windows throw on access).
    // The setting still applies for this session; it just won't survive reload.
  }
}

export function loadValue<T>(key: string, isValid: (value: unknown) => value is T, fallback: T): T {
  const raw = readRaw(key);
  if (raw === null) return fallback;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isValid(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

export function saveValue<T>(key: string, value: T): void {
  try {
    writeRaw(key, JSON.stringify(value));
  } catch {
    // Non-serializable value should never happen for our data, but never throw.
  }
}

/** A small local career record. Nothing here is a ranked or online claim. */
export interface CareerRecord {
  readonly boutsPlayed: number;
  readonly boutsWon: number;
  /** Ticks elapsed in the fastest bout this player has won, or null if none yet. */
  readonly bestWinTicks: number | null;
}

const CAREER_KEY = 'career';

const DEFAULT_CAREER: CareerRecord = { boutsPlayed: 0, boutsWon: 0, bestWinTicks: null };

function isCareerRecord(value: unknown): value is CareerRecord {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record['boutsPlayed'] === 'number' &&
    typeof record['boutsWon'] === 'number' &&
    (record['bestWinTicks'] === null || typeof record['bestWinTicks'] === 'number')
  );
}

export function loadCareer(): CareerRecord {
  return loadValue(CAREER_KEY, isCareerRecord, DEFAULT_CAREER);
}

export function saveCareer(record: CareerRecord): void {
  saveValue(CAREER_KEY, record);
}

/** Folds one finished bout into the stored career record and persists it. */
export function recordBoutResult(won: boolean, winTicks: number | null): CareerRecord {
  const current = loadCareer();
  const next: CareerRecord = {
    boutsPlayed: current.boutsPlayed + 1,
    boutsWon: current.boutsWon + (won ? 1 : 0),
    bestWinTicks:
      won && winTicks !== null
        ? current.bestWinTicks === null
          ? winTicks
          : Math.min(current.bestWinTicks, winTicks)
        : current.bestWinTicks,
  };
  saveCareer(next);
  return next;
}
