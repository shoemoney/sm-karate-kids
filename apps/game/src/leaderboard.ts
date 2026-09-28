/**
 * The ShoeMoney Arcade leaderboard, version 1 contract: ask for a run token
 * when a tournament starts, then submit the finished run with a name.
 *
 * Every call fails soft. Offline, local development without the API, or a
 * rate limit all mean "no board this run", never an error on screen.
 */
const API = '/api/games/karate-kids';
const BOARD_SIZE = 10;

export interface BoardRow {
  readonly name: string;
  readonly score: number;
}

export interface RunMetrics {
  readonly score: number;
  /** Rounds reached, 1-5. The API calls this "wave". */
  readonly rounds: number;
  /** Scoring techniques landed. The API's "kills". */
  readonly techniques: number;
  /** Ippons landed, never more than techniques. The API's "headshots". */
  readonly ippons: number;
  /** Seconds the run took. */
  readonly seconds: number;
}

export type SubmitResult = { ok: true; rank: number } | { ok: false; message: string };

async function post(path: string, body: unknown): Promise<Response> {
  return fetch(`${API}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export class Leaderboard {
  private token: string | null = null;

  /** Fire and forget; a run without a token simply has no board. */
  startRun(): void {
    this.token = null;
    void post('runs', {})
      .then(async (res) => (res.ok ? ((await res.json()) as { runToken?: unknown }) : null))
      .then((data) => {
        if (typeof data?.runToken === 'string') this.token = data.runToken;
      })
      .catch(() => undefined);
  }

  get available(): boolean {
    return this.token !== null;
  }

  async board(): Promise<BoardRow[] | null> {
    try {
      const res = await fetch(`${API}/scores`);
      if (!res.ok) return null;
      const data = (await res.json()) as { scores?: Array<{ name?: unknown; score?: unknown }> };
      return (data.scores ?? [])
        .filter((row) => typeof row.name === 'string' && typeof row.score === 'number')
        .map((row) => ({ name: row.name as string, score: row.score as number }));
    } catch {
      return null;
    }
  }

  /** Whether this score would land on the board as it stands right now. */
  static qualifies(score: number, board: readonly BoardRow[]): boolean {
    if (score <= 0) return false;
    if (board.length < BOARD_SIZE) return true;
    return score > (board[board.length - 1]?.score ?? 0);
  }

  async submit(name: string, run: RunMetrics): Promise<SubmitResult> {
    if (this.token === null) return { ok: false, message: 'The board is unavailable right now.' };
    try {
      const res = await post('scores', {
        runToken: this.token,
        name,
        score: Math.round(run.score),
        wave: run.rounds,
        kills: run.techniques,
        headshots: Math.min(run.ippons, run.techniques),
        duration: Math.round(run.seconds * 10) / 10,
      });
      const data = (await res.json()) as { accepted?: boolean; rank?: number; error?: string };
      if (res.ok && data.accepted === true && typeof data.rank === 'number') return { ok: true, rank: data.rank };
      return { ok: false, message: data.error ?? 'That score could not be saved.' };
    } catch {
      return { ok: false, message: 'Could not reach the board. Check your connection.' };
    }
  }
}
