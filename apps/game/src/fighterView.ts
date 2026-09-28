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
  apply(fighter: FighterState, elapsedTicks: number): void;
  emblemInfo(): EmblemInfo;
}
