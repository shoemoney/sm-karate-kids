import type { Object3D } from 'three/webgpu';
import type { FighterState } from '@smkk/sim';

/** What the emblem test reports, regardless of which renderer is on screen. */
export interface EmblemInfo {
  readonly bound: boolean;
  readonly width: number;
  readonly height: number;
  readonly src: string;
  readonly visible: boolean;
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
  /** Brighten toward white for an impact; 0 is normal. Optional per renderer. */
  flash?(amount: number): void;
}
