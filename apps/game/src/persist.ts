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

/** The best the player has done on the tournament ladder. Local only. */
export interface TournamentRecord {
  readonly bestScore: number;
  /** Furthest round reached, as an index into the ladder; -1 before any run. */
  readonly bestRound: number;
  readonly championships: number;
}

const TOURNAMENT_KEY = 'tournament';

const DEFAULT_TOURNAMENT: TournamentRecord = { bestScore: 0, bestRound: -1, championships: 0 };

function isTournamentRecord(value: unknown): value is TournamentRecord {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record['bestScore'] === 'number' &&
    typeof record['bestRound'] === 'number' &&
    typeof record['championships'] === 'number'
  );
}

export function loadTournament(): TournamentRecord {
  return loadValue(TOURNAMENT_KEY, isTournamentRecord, DEFAULT_TOURNAMENT);
}

/** Folds a finished run into the stored record and reports whether it set a new best. */
export function recordRun(score: number, roundReached: number, champion: boolean): {
  record: TournamentRecord;
  newBest: boolean;
} {
  const current = loadTournament();
  const newBest = score > current.bestScore;
  const record: TournamentRecord = {
    bestScore: Math.max(current.bestScore, score),
    bestRound: Math.max(current.bestRound, roundReached),
    championships: current.championships + (champion ? 1 : 0),
  };
  saveValue(TOURNAMENT_KEY, record);
  return { record, newBest };
}

/**
 * One piece of the final card's record line, in reading order.
 *
 * `score` is a score and must be rendered by the one formatter that knows about
 * the thousands separator and the half glyph (`scoreFragment`); `text` is words
 * and a count, which is not a score and must not be run through it. Rounds 102
 * and 130 each rejected a hand-written second copy of that formatting as "a bug
 * waiting for a round number", so the pieces are returned in order and the
 * caller has one loop with no branching in it.
 */
export type RecordPiece = { readonly text: string } | { readonly score: number };

/**
 * The record line on the card that ends a run.
 *
 * Why this is a function and not an `if` in the caller: the card it builds is
 * the CHAMPION screen, the one state in this game no reviewer has ever seen —
 * `champion` appeared zero times in 11,007 lines of the loop log, and the review
 * set has no frame that can reach it, because it takes five consecutive wins.
 *
 * So the defect it had is invisible to every instrument here. The line was
 *
 *     newBest ? 'New best score' : `Best ${best} · titles ${n}`
 *
 * — a bare either/or between two facts that are frequently BOTH true, and the
 * `titles` half was on the losing branch. On the first title of a player's life
 * `bestScore` is 0, so `newBest` is necessarily true, so the counter that had
 * just gone 0 -> 1 was never rendered at all. It appeared only on a LATER run
 * that failed to beat the same score: the one number that records the rarest
 * achievement in the game was shown precisely when the player had done worse.
 *
 * Both facts now survive, in the order a player wants them, and the two strings
 * are the same length as the one they replace (this is the card whose copy
 * budget rounds 119-122 measured to the character).
 */
export function recordPieces(args: {
  readonly champion: boolean;
  readonly newBest: boolean;
  readonly record: TournamentRecord;
}): readonly RecordPiece[] {
  const titles: RecordPiece = { text: `titles ${args.record.championships}` };
  if (!args.newBest) {
    return [{ text: 'Best ' }, { score: args.record.bestScore }, { text: ' · ' }, titles];
  }
  // "New best score" restates the number directly above it, because the score
  // on the card IS the new best. So on a championship, where the headline
  // already says CHAMPION, the title count is the fact this line is for.
  return args.champion ? [titles, { text: ' · new best' }] : [{ text: 'New best score' }];
}

const NAME_KEY = 'playerName';

export function loadPlayerName(): string {
  return loadValue(NAME_KEY, (value): value is string => typeof value === 'string', '');
}

export function savePlayerName(name: string): void {
  saveValue(NAME_KEY, name);
}
