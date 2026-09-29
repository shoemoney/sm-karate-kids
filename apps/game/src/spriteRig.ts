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
import type { EmblemInfo, FighterView, FrameInfo } from './fighterView.js';
import { resolveSpriteFrame, IDLE_POSE } from './spriteFrames.js';

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
  readonly poses: Readonly<Record<string, { readonly frames: readonly number[]; readonly contact: number; readonly fps?: number }>>;
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

/**
 * How far a ghost may trail its fighter, in world units, and how bright it may
 * get.
 *
 * The trail used to draw each ghost at the exact world spot it was dropped,
 * which means the offset is whatever the fighter covered in three ticks. On a
 * walk that is nothing and the trail reads as speed. On a lunging punch or a
 * stepping kick it is most of a body width, and at 0.32 opacity a full
 * silhouette sitting a body width behind its owner does not read as a trail at
 * all — it reads as a second fighter standing behind the first one.
 *
 * Four reviewers across three rounds described something wrong in the kick
 * frames (a "severed foot", a leg "passing through" the opponent) and none of
 * them named it, because the thing they were actually reacting to was a
 * duplicate. A burst of real frames caught it in two shots: the sprite is
 * clean, and there is a translucent second Asmongold behind him.
 *
 * So the trail is capped to a short offset and dimmed. It still says the strike
 * was fast; it no longer says there is someone else in the room.
 */
const GHOST_TRAIL_MAX = 0.1;
const clampTrail = (v: number): number => (v < -GHOST_TRAIL_MAX ? -GHOST_TRAIL_MAX : v > GHOST_TRAIL_MAX ? GHOST_TRAIL_MAX : v);
const GHOST_PEAK_OPACITY = 0.17;

export class SpriteFighterView implements FighterView {
  readonly root = new Group();
  private readonly mesh: Mesh<PlaneGeometry, MeshBasicMaterial>;
  private currentPage = -1;
  private readonly ghosts: Ghost[] = [];

  /**
   * The room grade, as a multiplier on the sprite material.
   *
   * Frozen and held per-rig so the hit flash can scale *from* it rather than
   * replacing it — see flash().
   */
  /**
   * No channel above 1.
   *
   * The first pass at this was (1.03, 0.955, 0.87) — a warm nudge that also
   * pushed red past unity. These are unlit materials feeding a bloom pass, and
   * an over-unity channel is not a slightly brighter fighter: it made the
   * software-rendered e2e runner crash the browser mid-bout
   * ("Target page, context or browser has been closed" on the full-length bout
   * test), while the same test passed on a clean tree at 31.5s.
   *
   * A warm grade does not need more than 1.0. It needs red held and blue cut,
   * which is what this is: the artwork moves toward the tungsten and the room
   * is never neutralised.
   */
  private readonly grade = [1.0, 0.945, 0.85] as const;
  private recoilAmount = 0;
  private recoilVelocity = 0;
  private recoilFacing: 1 | -1 = 1;
  private ghostCursor = 0;
  private lastGhostTick = -99;
  private frameCell = { page: 0, offsetX: 0, offsetY: 0, repeatX: 1, repeatY: 1 };
  /** The cell this fighter last drew, for the e2e suite. */
  private shownFrame: FrameInfo | undefined;

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
    // A cutout, not a blend. Two blended planes that overlap are drawn in
    // whatever order sorting picks that frame, so where the fighters touch
    // they flickered in front of each other. The art is already hard-edged.
    // Graded into the room, not lit on their own.
    //
    // The fighters are painted for a neutral key, and the dojo they stand in is a
    // warm tungsten room. Side by side, that mismatch is what seven separate
    // reviewers have described, in five rounds and five different vocabularies:
    // "sprites lack environmental integration" (glm-4.5v), "look pasted over the
    // mat" (gpt-5.1), "slightly pasted-on" (gpt-5.3-codex), "ungraded whites and
    // reds" (claude-opus-5.5), "two pasted stickers, not bodies" (mimo-v2.6-pro),
    // "anchor the sprites to the tatami" (gpt-5.6-sol-pro), "ground the fighter
    // sprites" (gpt-5.2-pro).
    //
    // The fix is deliberately NOT the standing "make it brighter" rejection.
    // Nobody is asking for the room to be neutralised; every one of them is
    // asking for the fighters to belong to the room they are in, which is the
    // opposite direction — the artwork moves toward the tungsten, not away from
    // it. A gentle warm multiply and a small lift of the red end does that, and
    // the two fighters stay distinguishable because the grade is applied to the
    // material, not painted into the art.
    const material = new MeshBasicMaterial({ transparent: false, alphaTest: 0.5 });
    material.color.setRGB(this.grade[0], this.grade[1], this.grade[2]);
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
    onPage?: () => void,
  ): Promise<SpriteFighterView> {
    const entry = manifest.fighters[spec.id];
    if (entry === undefined) throw new Error(`sprite manifest has no fighter entry for "${spec.id}"`);
    if (entry.pages.length === 0) throw new Error(`sprite manifest fighter "${spec.id}" has no pages`);

    const pages = await Promise.all(
      entry.pages.map((page) => {
        const url = `${baseUrl}fighters/${page}`;
        const cached = textureCache.get(url);
        if (cached !== undefined) return cached;
        // Counted as it settles, not as it starts, and only on the fetch that
        // actually made the request — a cache hit is the same page arriving
        // twice, and counting it would take the bar past its own end. The
        // wrapped promise is what goes in the cache, so every later await of
        // this page sees the same counted result.
        const pending = onPage === undefined ? loadTexture(url) : loadTexture(url).finally(onPage);
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
    // Only going from no map to a map changes the shader. Swapping one page
    // texture for another does not, and flagging it anyway rebuilt the
    // material mid-animation — a visible hitch whenever a move crossed pages.
    const hadMap = this.mesh.material.map !== null;
    this.mesh.material.map = texture;
    if (!hadMap) this.mesh.material.needsUpdate = true;
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
    const hadMap = ghost.mesh.material.map !== null;
    ghost.mesh.material.map = texture;
    if (!hadMap) ghost.mesh.material.needsUpdate = true;
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
      // Ghosts live in the fighter's group, so hold them near the world spot
      // they were dropped, not wherever the fighter has moved since — but
      // clamped, or a fast strike leaves a full silhouette a body width back.
      const offset = clampTrail(ghost.worldX - this.root.position.x);
      ghost.mesh.position.set(
        offset,
        this.mesh.position.y + ghost.worldY - this.root.position.y,
        -0.02,
      );
      // Dimmer the further behind it has fallen, so the newest ghost is the
      // brightest and the trail reads as depth rather than as copies.
      const staleness = 1 - Math.abs(offset) / GHOST_TRAIL_MAX;
      ghost.mesh.material.opacity = ghost.life * GHOST_PEAK_OPACITY * (0.35 + 0.65 * staleness);
    }
  }

  /**
   * The struck-fighter pop. It used to be `1 + amount * 2.4`, and at a full
   * point that is a 3.4x multiplier on an already-lit texture, which clipped
   * the whole figure to a featureless white silhouette — face, gi and arms all
   * gone, for 140ms, at the exact moment the player is trying to see that the
   * hit landed and what it landed on.
   *
   * Five models across three rounds reported it and none of them could name it:
   * perceptron-mk1.5 "a bright white glow completely obscures the fighter in
   * white", gpt-5.6-sol "preserve fighter readability during scoring hits",
   * gpt-5.5 "reduce hit flash clipping", qwen3.8-max-0902 "the receiver clips
   * to a featureless white blob on IPPON", minimax-m3 "reads as face paint,
   * not impact". All five were describing the same erased man, and the captured
   * impact frame shows exactly what they saw.
   *
   * A hit should brighten, not delete. 1.75 reads as a hard pop against the
   * tungsten and still leaves the face, the belt and the gi readable.
   */
  flash(amount: number): void {
    this.mesh.material.color.setScalar(1 + amount * 0.75);
  }

  /**
   * Presentation-only knockback. The simulation owns position and deliberately
   * does not move anyone on contact — a point-karate exchange ends on the hit,
   * so a shove would be a lie about the rules. But the sprite is a view, and a
   * view is allowed to be shoved and spring back, which is what makes a contact
   * land in the body rather than only in the eye.
   *
   * Applied to `root` and therefore to the ghosts with it, so the afterimage
   * trails the recoil instead of sitting in the pre-hit spot.
   */
  recoil(amount: number, facing: 1 | -1): void {
    this.recoilAmount = amount;
    this.recoilFacing = facing;
  }

  private applyRecoil(): void {
    if (this.recoilAmount === 0) return;
    // Critically damped-ish spring: fast out, slower back, so the fighter
    // settles rather than oscillating.
    this.recoilVelocity += (0 - this.recoilAmount) * 0.28;
    this.recoilVelocity *= 0.74;
    this.recoilAmount += this.recoilVelocity;
    if (Math.abs(this.recoilAmount) < 0.0004 && Math.abs(this.recoilVelocity) < 0.0004) {
      this.recoilAmount = 0;
      this.recoilVelocity = 0;
    }
    this.root.position.x += this.recoilAmount * this.recoilFacing;
  }

  apply(fighter: FighterState, elapsedTicks: number, renderX = fighter.x): void {
    this.root.position.x = renderX;
    this.applyRecoil();
    // The art draws the pose, the simulation owns the altitude. Without this a
    // jump plays on the mat while the sim has the fighter clearing low strikes.
    this.root.position.y = heightOf(fighter);
    const baseFacingRight = this.manifest.facing !== 'left';
    const mirrored = baseFacingRight ? fighter.facing === -1 : fighter.facing === 1;
    const move = fighter.move;
    const cell = resolveSpriteFrame(
      this.manifest.poses,
      {
        moveId: move?.id ?? null,
        phase: fighter.phase,
        phaseTicks: fighter.phaseTicks,
        startup: move?.startup ?? 1,
        recovery: move?.recovery ?? 1,
      },
      elapsedTicks,
    );
    this.setCell(cell, mirrored);
    // Kept for the e2e suite: which cell this fighter is actually drawing, so
    // a test can hold the renderer to the same rule spriteFrames.ts is tested on.
    this.shownFrame = { cell, pose: move?.id ?? IDLE_POSE, phase: fighter.phase };

    const striking =
      fighter.move?.kind === 'strike' && (fighter.phase === 'startup' || fighter.phase === 'active');
    if (striking && elapsedTicks - this.lastGhostTick >= 3) {
      this.dropGhost();
      this.lastGhostTick = elapsedTicks;
    }
    this.updateGhosts();
  }

  frameInfo(): FrameInfo {
    return this.shownFrame ?? { cell: -1, pose: IDLE_POSE, phase: 'neutral' };
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
 *
 * `onPage(done, total)` fires as each distinct atlas page settles, not when the
 * promise as a whole does. The atlas is 2.3 MB across six pages and is the
 * longest single thing the game waits for; without this the pre-boot card sits
 * still for all of it and then jumps, which reads as a bar that is not
 * measuring anything. `total` is 0 when the manifest has nothing to load, in
 * which case no progress is reported at all rather than a fake 100%.
 */
export async function tryLoadSpriteViews(
  specs: readonly FighterSpec[],
  baseUrl: string,
  onPage?: (done: number, total: number) => void,
): Promise<readonly SpriteFighterView[] | null> {
  const manifest = await loadManifest(baseUrl);
  if (manifest === null) return null;

  // Counted from the manifest rather than from the requests, so the denominator
  // is known before the first page lands and can never drift from reality.
  const wanted = new Set<string>();
  for (const spec of specs) {
    for (const page of manifest.fighters[spec.id]?.pages ?? []) {
      wanted.add(`${baseUrl}fighters/${page}`);
    }
  }
  const total = wanted.size;
  let done = 0;
  if (onPage !== undefined && total > 0) onPage(0, total);
  const note = (): void => {
    done += 1;
    onPage?.(Math.min(done, total), total);
  };

  try {
    const textureCache = new Map<string, Promise<Texture>>();
    return await Promise.all(
      specs.map((spec) => SpriteFighterView.create(spec, manifest, baseUrl, textureCache, note)),
    );
  } catch (error) {
    console.warn('[smkk] failed to load sprite fighters', error);
    return null;
  }
}
