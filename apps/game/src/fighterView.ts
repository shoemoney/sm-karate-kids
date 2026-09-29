import type { Object3D } from 'three/webgpu';
import type { FighterState, Phase } from '@smkk/sim';

/** What the emblem test reports, regardless of which renderer is on screen. */
export interface EmblemInfo {
  readonly bound: boolean;
  readonly width: number;
  readonly height: number;
  readonly src: string;
  readonly visible: boolean;
}

/**
 * Which sprite cell a fighter last drew. Only the sprite renderer has cells,
 * so this is optional — the e2e suite uses it to hold the real renderer to the
 * same frame rule the unit tests check in isolation.
 */
export interface FrameInfo {
  /** Atlas cell index, or -1 before the first frame has been drawn. */
  readonly cell: number;
  /** The pose the cell came from, or 'idle' when no move is playing. */
  readonly pose: string;
  readonly phase: Phase;
}

/**
 * The one shape both the 3D mesh rig and the sprite rig satisfy, so the game
 * loop never has to know or care which is drawing a given fighter.
 */
export interface FighterView {
  readonly root: Object3D;
  /**
   * `renderX` is where to draw the fighter along the mat, which is not always
   * the simulation's x — see the spacing note in main.ts.
   */
  apply(fighter: FighterState, elapsedTicks: number, renderX?: number): void;
  emblemInfo(): EmblemInfo;
  /** The cell just drawn, where the renderer has one. Optional per renderer. */
  frameInfo?(): FrameInfo;
  /** Brighten toward white for an impact; 0 is normal. Optional per renderer. */
  flash?(amount: number): void;
}
