import {
  Group,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  RepeatWrapping,
  SRGBColorSpace,
  TextureLoader,
} from 'three/webgpu';
import type { Texture } from 'three/webgpu';
import { heightOf, type FighterSpec, type FighterState } from '@smkk/sim';
import type { EmblemInfo, FighterView } from './fighterView.js';

interface SpriteManifest {
  readonly version: number;
  readonly cell: { readonly w: number; readonly h: number };
  readonly baseline: number;
  readonly metresPerCell: number;
  readonly facing: 'right' | 'left';
  readonly fighters: Record<
    string,
    { readonly pages: readonly string[]; readonly cols: number; readonly rows: number }
  >;
  readonly poses: Record<string, { readonly frames: readonly number[]; readonly contact: number }>;
}

const IDLE_POSE = 'idle';
/** Ticks an idle frame holds before advancing, a slow loop rather than a still image. */
const IDLE_FRAME_HOLD_TICKS = 10;

function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/** Loose structural check — enough to refuse to render garbage, not a full schema. */
function isSpriteManifest(value: unknown): value is SpriteManifest {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  const cell = v['cell'];
  if (typeof cell !== 'object' || cell === null) return false;
  const c = cell as Record<string, unknown>;
  if (typeof c['w'] !== 'number' || typeof c['h'] !== 'number') return false;
  if (typeof v['baseline'] !== 'number' || typeof v['metresPerCell'] !== 'number') return false;
  if (typeof v['fighters'] !== 'object' || v['fighters'] === null) return false;
  if (typeof v['poses'] !== 'object' || v['poses'] === null) return false;
  return true;
}

async function loadManifest(baseUrl: string): Promise<SpriteManifest | null> {
  try {
    const response = await fetch(`${baseUrl}fighters/manifest.json`);
    if (!response.ok) return null;
    const data: unknown = await response.json();
    return isSpriteManifest(data) ? data : null;
  } catch {
    return null;
  }
}

function loadTexture(url: string): Promise<Texture> {
  return new Promise<Texture>((resolve, reject) => {
    new TextureLoader().load(
      url,
      (texture) => {
        texture.colorSpace = SRGBColorSpace;
        texture.wrapS = RepeatWrapping;
        texture.wrapT = RepeatWrapping;
        // The atlas packs frames edge to edge; a mipmap would blend a cell
        // into its neighbour, so frames stay full-resolution only.
        texture.generateMipmaps = false;
        texture.magFilter = LinearFilter;
        texture.minFilter = LinearFilter;
        resolve(texture);
      },
      undefined,
      (error) => reject(error instanceof Error ? error : new Error(String(error))),
    );
  });
}

function cloneTexture(source: Texture): Texture {
  const clone = source.clone();
  clone.colorSpace = source.colorSpace;
  clone.wrapS = source.wrapS;
  clone.wrapT = source.wrapT;
  clone.magFilter = source.magFilter;
  clone.minFilter = source.minFilter;
  clone.generateMipmaps = source.generateMipmaps;
  clone.needsUpdate = true;
  return clone;
}

function pickRamped(frames: readonly number[], phaseTicks: number, totalTicks: number): number | undefined {
  if (frames.length === 0) return undefined;
  const t = clamp01(phaseTicks / Math.max(1, totalTicks));
  const index = Math.min(frames.length - 1, Math.floor(t * frames.length));
  return frames[index];
}

function idleFrame(manifest: SpriteManifest, elapsedTicks: number): number {
  const idle = manifest.poses[IDLE_POSE];
  if (idle === undefined || idle.frames.length === 0) return 0;
  const index = Math.floor(elapsedTicks / IDLE_FRAME_HOLD_TICKS) % idle.frames.length;
  return idle.frames[index] ?? 0;
}

/**
 * The frame a fighter shows this tick. The referee's decision is made during
 * `active`, so that whole window holds the pose's `contact` frame — never a
 * frame mid-ramp toward or away from it.
 */
function resolveFrame(manifest: SpriteManifest, fighter: FighterState, elapsedTicks: number): number {
  const move = fighter.move;
  if (move === null) return idleFrame(manifest, elapsedTicks);

  const pose = manifest.poses[move.id];
  if (pose === undefined) return idleFrame(manifest, elapsedTicks);

  const contact = pose.frames[pose.contact];
  if (contact === undefined) return idleFrame(manifest, elapsedTicks);

  if (fighter.phase === 'startup') {
    return pickRamped(pose.frames.slice(0, pose.contact), fighter.phaseTicks, move.startup) ?? contact;
  }
  if (fighter.phase === 'recovery') {
    return pickRamped(pose.frames.slice(pose.contact + 1), fighter.phaseTicks, move.recovery) ?? contact;
  }
  // 'active' and 'frozen' both hold the referee's frame.
  return contact;
}

/**
 * A textured plane standing in the same 3D dojo as the mesh rig — a 2.5D
 * billboard, not a 2D rewrite. It never rotates after construction: the
 * `apply` contract has no camera to look at, and a plane facing +Z already
 * faces the stage's camera, which only ever dollies and pans along that axis.
 */
const GHOST_COUNT = 3;

interface Ghost {
  mesh: Mesh<PlaneGeometry, MeshBasicMaterial>;
  pages: Texture[];
  worldX: number;
  worldY: number;
  life: number;
}

export class SpriteFighterView implements FighterView {
  readonly root = new Group();
  private readonly mesh: Mesh<PlaneGeometry, MeshBasicMaterial>;
  private currentPage = -1;
  private readonly ghosts: Ghost[] = [];
  private ghostCursor = 0;
  private lastGhostTick = -99;
  private frameCell = { page: 0, offsetX: 0, offsetY: 0, repeatX: 1, repeatY: 1 };

  private constructor(
    private readonly manifest: SpriteManifest,
    private readonly cols: number,
    private readonly rows: number,
    private readonly pages: readonly Texture[],
  ) {
    const aspect = manifest.cell.w / manifest.cell.h;
    const planeHeight = manifest.metresPerCell;
    const planeWidth = planeHeight * aspect;

    const geometry = new PlaneGeometry(1, 1);
    const material = new MeshBasicMaterial({ transparent: true, alphaTest: 0.5 });
    this.mesh = new Mesh(geometry, material);
    this.mesh.scale.set(planeWidth, planeHeight, 1);
    // The baseline pixel row inside a cell lands on the mat, not the plane's
    // vertical centre.
    this.mesh.position.y = planeHeight * (manifest.baseline / manifest.cell.h - 0.5);
    this.root.add(this.mesh);

    // Afterimages. Each ghost owns a clone of every page up front, so leaving
    // a trail behind a strike allocates nothing per frame.
    for (let i = 0; i < GHOST_COUNT; i += 1) {
      const ghost = new Mesh(
        geometry,
        new MeshBasicMaterial({ transparent: true, alphaTest: 0.04, depthWrite: false, opacity: 0 }),
      );
      ghost.scale.copy(this.mesh.scale);
      ghost.renderOrder = -1;
      ghost.visible = false;
      this.root.add(ghost);
      this.ghosts.push({ mesh: ghost, pages: pages.map(cloneTexture), worldX: 0, worldY: 0, life: 0 });
    }

    this.setPage(0);
  }

  static async create(
    spec: FighterSpec,
    manifest: SpriteManifest,
    baseUrl: string,
    textureCache: Map<string, Promise<Texture>>,
  ): Promise<SpriteFighterView> {
    const entry = manifest.fighters[spec.id];
    if (entry === undefined) throw new Error(`sprite manifest has no fighter entry for "${spec.id}"`);
    if (entry.pages.length === 0) throw new Error(`sprite manifest fighter "${spec.id}" has no pages`);

    const pages = await Promise.all(
      entry.pages.map((page) => {
        const url = `${baseUrl}fighters/${page}`;
        const cached = textureCache.get(url);
        if (cached !== undefined) return cached;
        const pending = loadTexture(url);
        textureCache.set(url, pending);
        return pending;
      }),
    );

    // Cloned so two fighters sharing a page can each hold a different frame.
    return new SpriteFighterView(manifest, entry.cols, entry.rows, pages.map(cloneTexture));
  }

  private setPage(page: number): void {
    if (page === this.currentPage) return;
    const texture = this.pages[page];
    if (texture === undefined) return;
    this.mesh.material.map = texture;
    this.mesh.material.needsUpdate = true;
    this.currentPage = page;
  }

  private setCell(frameIndex: number, mirrored: boolean): void {
    const perPage = this.cols * this.rows;
    const page = Math.floor(frameIndex / perPage);
    const local = frameIndex % perPage;
    const col = local % this.cols;
    const row = Math.floor(local / this.cols) % this.rows;

    this.setPage(page);
    const texture = this.pages[page];
    if (texture === undefined) return;

    const v = 1 - (row + 1) / this.rows;
    if (mirrored) {
      // A negative repeat samples the same cell in reverse, mirroring the art
      // without touching mesh scale or winding.
      texture.repeat.set(-1 / this.cols, 1 / this.rows);
      texture.offset.set((col + 1) / this.cols, v);
    } else {
      texture.repeat.set(1 / this.cols, 1 / this.rows);
      texture.offset.set(col / this.cols, v);
    }
    this.frameCell = {
      page,
      offsetX: texture.offset.x,
      offsetY: texture.offset.y,
      repeatX: texture.repeat.x,
      repeatY: texture.repeat.y,
    };
  }

  /** Freeze the current frame where it stands and let it fade. */
  private dropGhost(): void {
    const ghost = this.ghosts[this.ghostCursor];
    this.ghostCursor = (this.ghostCursor + 1) % this.ghosts.length;
    const texture = ghost?.pages[this.frameCell.page];
    if (ghost === undefined || texture === undefined) return;
    texture.offset.set(this.frameCell.offsetX, this.frameCell.offsetY);
    texture.repeat.set(this.frameCell.repeatX, this.frameCell.repeatY);
    ghost.mesh.material.map = texture;
    ghost.mesh.material.needsUpdate = true;
    ghost.worldX = this.root.position.x;
    ghost.worldY = this.root.position.y;
    ghost.life = 1;
    ghost.mesh.visible = true;
  }

  private updateGhosts(): void {
    for (const ghost of this.ghosts) {
      if (!ghost.mesh.visible) continue;
      ghost.life -= 0.18;
      if (ghost.life <= 0) {
        ghost.mesh.visible = false;
        continue;
      }
      // Ghosts live in the fighter's group, so hold them at the world spot
      // they were dropped, not wherever the fighter has moved since.
      ghost.mesh.position.set(
        ghost.worldX - this.root.position.x,
        this.mesh.position.y + ghost.worldY - this.root.position.y,
        -0.02,
      );
      ghost.mesh.material.opacity = ghost.life * 0.32;
    }
  }

  flash(amount: number): void {
    this.mesh.material.color.setScalar(1 + amount * 2.4);
  }

  apply(fighter: FighterState, elapsedTicks: number, renderX = fighter.x): void {
    this.root.position.x = renderX;
    // The art draws the pose, the simulation owns the altitude. Without this a
    // jump plays on the mat while the sim has the fighter clearing low strikes.
    this.root.position.y = heightOf(fighter);
    const baseFacingRight = this.manifest.facing !== 'left';
    const mirrored = baseFacingRight ? fighter.facing === -1 : fighter.facing === 1;
    this.setCell(resolveFrame(this.manifest, fighter, elapsedTicks), mirrored);

    const striking =
      fighter.move?.kind === 'strike' && (fighter.phase === 'startup' || fighter.phase === 'active');
    if (striking && elapsedTicks - this.lastGhostTick >= 3) {
      this.dropGhost();
      this.lastGhostTick = elapsedTicks;
    }
    this.updateGhosts();
  }

  emblemInfo(): EmblemInfo {
    const texture = this.pages[this.currentPage];
    const image = texture?.image as { width?: number; height?: number; src?: string } | undefined;
    return {
      bound: texture !== undefined,
      width: image?.width ?? 0,
      height: image?.height ?? 0,
      src: image?.src ?? '',
      visible: this.mesh.visible,
    };
  }
}

/**
 * Loads the manifest and every atlas page a fighter needs. Returns null on
 * any failure — missing manifest, missing page, unknown fighter id — so the
 * caller can fall back to the 3D rig instead of leaving the game unable to
 * boot.
 */
export async function tryLoadSpriteViews(
  specs: readonly FighterSpec[],
  baseUrl: string,
): Promise<readonly SpriteFighterView[] | null> {
  const manifest = await loadManifest(baseUrl);
  if (manifest === null) return null;

  try {
    const textureCache = new Map<string, Promise<Texture>>();
    return await Promise.all(specs.map((spec) => SpriteFighterView.create(spec, manifest, baseUrl, textureCache)));
  } catch (error) {
    console.warn('[smkk] failed to load sprite fighters', error);
    return null;
  }
}
