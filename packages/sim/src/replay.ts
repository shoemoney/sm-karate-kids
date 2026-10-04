import { fnv1a, hex8 } from './checksum.js';
import { checksumOf, createMatch, step, type MatchOptions, type MatchState } from './match.js';
import { NEUTRAL_FRAME, packFrame, unpackFrame, type InputFrame } from './input.js';

export const REPLAY_VERSION = 2;

export interface Replay {
  readonly version: number;
  readonly rulesetId: string;
  readonly arenaId: string;
  /** The opening distance actually in force for this match, after any override and clamping. */
  readonly startSeparation: number;
  /**
   * Player 1's and player 2's fighter ids. Optional so a replay recorded before
   * the player could choose still plays back, in the content order it used.
   */
  readonly fighterIds?: readonly [string, string];
  /** One packed input frame per tick. */
  readonly frames: readonly number[];
  /** Checksum after the final recorded tick. */
  readonly checksum: string;
}

export class ReplayRecorder {
  private readonly frames: number[] = [];

  constructor(private readonly state: MatchState) {}

  record(frame: InputFrame): void {
    this.frames.push(packFrame(frame));
  }

  finish(): Replay {
    return {
      version: REPLAY_VERSION,
      rulesetId: this.state.ruleset.id,
      arenaId: this.state.arena.id,
      startSeparation: this.state.separation,
      fighterIds: [this.state.fighters[0].spec.id, this.state.fighters[1].spec.id],
      frames: [...this.frames],
      checksum: checksumOf(this.state),
    };
  }
}

export interface PlaybackResult {
  readonly state: MatchState;
  readonly checksum: string;
  readonly matches: boolean;
}

/** Re-runs a replay from scratch and reports whether it lands on the same state. */
export function playback(replay: Replay, options: MatchOptions): PlaybackResult {
  if (replay.version !== REPLAY_VERSION) {
    throw new Error(`unsupported replay version ${replay.version}`);
  }
  const state = createMatch({
    content: options.content,
    rulesetId: replay.rulesetId,
    arenaId: replay.arenaId,
    startSeparation: replay.startSeparation,
    ...(replay.fighterIds === undefined ? {} : { fighterIds: replay.fighterIds }),
  });
  for (const packed of replay.frames) {
    step(state, unpackFrame(packed));
  }
  const checksum = checksumOf(state);
  return { state, checksum, matches: checksum === replay.checksum };
}

/** Runs a match to completion under a frame source. Used by tests and soak runs. */
export function runMatch(
  options: MatchOptions,
  frameFor: (tick: number, state: MatchState) => InputFrame,
  maxTicks = 7200,
): { state: MatchState; replay: Replay; trace: string } {
  const state = createMatch(options);
  const recorder = new ReplayRecorder(state);
  let trace = 0x811c9dc5;

  for (let tick = 0; tick < maxTicks && state.phase !== 'over'; tick += 1) {
    const frame = frameFor(tick, state) ?? NEUTRAL_FRAME;
    recorder.record(frame);
    step(state, frame);
    trace = fnv1a(checksumOf(state), trace);
  }

  return { state, replay: recorder.finish(), trace: hex8(trace) };
}
