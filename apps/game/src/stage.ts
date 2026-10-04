import {
  AmbientLight,
  BoxGeometry,
  AdditiveBlending,
  SRGBColorSpace,
  CanvasTexture,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Fog,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NoColorSpace,
  PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  Scene,
  type Material,
  type Texture,
} from 'three/webgpu';
import type { ArenaSpec } from '@smkk/sim';
import { loadGenerated } from './artLoader.js';

const FOV = 34;
/** Metres of headroom the frame always keeps above and below the action. */
const FRAME_HALF_HEIGHT = 1.3;
/** The tightest the camera will ever pull in, so a clinch is not a close-up. */
const MIN_HALF_WIDTH = 1.25;
/** Breathing room outside the pair, in metres. */
const EDGE_MARGIN = 0.6;
/**
 * Half a fighter's body width reserved outside the pair, so an extended
 * technique cannot push a limb off the edge of the frame.
 */
const FIGHTER_HALF_WIDTH = 0.42;

/**
 * How far the camera's x trails the pair's midpoint, as a fraction.
 *
 * It was `0.7`, with nothing written down saying why, and the number was a
 * defect rather than a style: `framingSolve` below sizes the frame from the
 * fighters, and the camera then sat `0.3 * midpointX` away from them, so the
 * further the bout drifted from the middle of the mat the further the pair
 * slid off the frame edge. See r171 in REVIEW-LOOP.md.
 *
 * One, not `0.7`, and — worth being explicit, because my first attempt at this
 * fix was wrong — **not** `0.7` plus a term that budgeted for the offset.**
 * That combination does restore the invariant, and it is worse: distance would
 * then grow with *where on the mat* the fight is, and this function's own
 * contract is that distance tracks only the distance between the fighters.
 * Framing the pair from the edge of the mat would dolly the camera back far
 * enough to turn them into dolls — measured, 9.2 to 20.2 world units at
 * `bounds`, a little over half size — to pay for a bias nothing asked for.
 *
 * `frame()`'s `0.12` lerp already supplies every bit of smoothing the follow
 * needs. The bias was a second, undocumented softness whose only observable
 * effect was to walk the fighters out of the picture.
 */
const CAMERA_FOLLOW = 1;

export interface FramingSolve {
  /** How far back the camera sits, in world units. */
  readonly distance: number;
  /** Where the camera's x lands. */
  readonly cameraX: number;
  /** Height the eye sits at — a phone is lifted, a desktop frame is not. */
  readonly eyeY: number;
  /** True on a portrait phone, which is width-starved. */
  readonly tight: boolean;
}

/**
 * The framing arithmetic, pulled out of `frame()` so it can be tested.
 *
 * A wall-clock camera budget cannot be unit-tested by waiting for a camera,
 * which is the same reason `preBoutBudget.ts` exists (r151), and the same reason
 * this is a pure function over numbers rather than a method that moves a
 * Three.js object.
 *
 * The contract r39 established is that **both fighters stay fully visible**,
 * and it took a burst of 140 real frames to find it broken: a scored back kick
 * extends most of a body length past its origin, and framing on the gap alone
 * sliced that foot off at the edge exactly as it landed. `reach` was added for
 * that and the family was declared closed.
 *
 * It was not closed. `halfWidth` is the half-extent the camera must cover, and
 * it is centred on the **camera** — but the camera was placed at
 * `midpointX * 0.7`, not at the fighters' midpoint. That offset grows with how
 * far the bout has drifted from the middle of the mat, and it was not in the
 * budget at all. Budgeting for it is the wrong repair; see `CAMERA_FOLLOW`.
 *
 * Measured at r171, off `17-phone-scored-result`: a bout that drifted to the
 * mat's right edge put one fighter **sliced in half by the frame edge** with
 * the other almost entirely outside the arena, on the game's own result screen.
 * The camera maths was right about the fighters and wrong about itself.
 */
export function framingSolve(
  width: number,
  height: number,
  midpointX: number,
  gap: number,
  reach = 0,
): FramingSolve {
  const aspect = width / Math.max(height, 1);
  const tan = Math.tan((FOV * Math.PI) / 360);

  // A tall viewport is width-starved: fitting both fighters side by side
  // forces the camera far enough back that they end up small, and the frame
  // below their feet becomes a quarter of the screen in empty mat. So the
  // breathing room is spent generously on a desktop frame and sparingly on a
  // phone one, where the pixels are the scarce resource.
  const tight = aspect < 0.85;
  const margin = tight ? EDGE_MARGIN * 0.7 : EDGE_MARGIN;
  const body = tight ? FIGHTER_HALF_WIDTH * 0.8 : FIGHTER_HALF_WIDTH;

  // The gap is measured centre to centre, but a fighter is not a point: a
  // wide lunge stance throws a foot well past its own centre, and framing on
  // the gap alone sliced that foot off at the frame edge on the strike pose.
  // `reach` is how far past its own centre the currently-extended limb
  // reaches. A fighter is framed by their body half-width, which covers a
  // punch, but a back kick or a roundhouse extends most of a body length
  // beyond the fighter's origin.
  //
  // gpt-5.6-sol-pro put it as "keep both fighters fully visible during scoring
  // hits". That is the standard this whole function exists to hold, and the
  // reason it takes the midpoint is only to place the camera ON the pair — the
  // distance is a function of the gap alone, which is the property the
  // regression fence below pins.
  const cameraX = midpointX * CAMERA_FOLLOW;
  const halfWidth = Math.max(MIN_HALF_WIDTH, Math.abs(gap) / 2 + margin + body + reach);
  const distance = Math.max(FRAME_HALF_HEIGHT / tan, halfWidth / (aspect * tan)) * 1.04;

  return { distance, cameraX, eyeY: tight ? 1.5 : 1.18, tight };
}

/**
 * Where the dojo furniture lives, in metres. The camera only ever dollies and
 * pans along +Z, so these are fixed placements the frame is composed around.
 */
const BACKDROP_Z = -13.9;
const CROWD_Z = -8.2;
const SHAFT_Z = -3.2;
/** Where the light shaft is centred across the mat. The dust hangs in it. */
const SHAFT_X = -1.6;

/**
 * The ceiling is an EAVE at the back wall, not a roof over the whole room.
 *
 * The camera is level at chest height with a 34° vertical FOV, so the top edge
 * of the frame is a ray climbing at about 17°. Any ceiling shallower than that
 * ray — which is every flat ceiling, and every ceiling hung at a believable
 * eight metres — is above the frustum at every depth the camera ever takes, and
 * is therefore never drawn. A ceiling you can actually see has to be brought
 * down and tipped steeply toward the lens, and the version that works here is
 * the shallow eave the back wall's rafters would make: it leans away from the
 * camera from just above the shoji transom, and it owns roughly the top fifth
 * of the frame while leaving the lit screen the fighters are read against.
 *
 * Numbers are chosen so the eave's upper edge lands on the top of the frame at
 * both viewports. The camera dollies between ~4.4m (desktop, fighters close) and
 * ~7.2m (portrait, fighters apart), and a fixed plane that only frames at one of
 * those is a plane that is broken at the other.
 */
const CEILING_Y = 6.9;
const CEILING_Z = -13.4;
const CEILING_TILT = 0.26;
const CEILING_W = 20;
const CEILING_H = 5.6;

/**
 * Dust in the air, suspended in the shaft. Positions are a pure function of
 * wall time — no integration, no accumulated state — so a dropped frame or a
 * backgrounded tab resumes in exactly the right place instead of leaving the
 * motes stranded wherever the tab stopped.
 */
const MOTE_COUNT = 18;
const MOTE_Y_MIN = 0.4;
const MOTE_Y_MAX = 4.0;
/** Half-width of the beam's lit core; a mote outside it is only half a mote. */
const MOTE_SPREAD = 2.3;

/**
 * One speck of airborne dust. Positions are derived from wall time every frame
 * rather than integrated, so nothing here is a velocity or an accumulator.
 */
interface Mote {
  readonly mesh: Mesh<PlaneGeometry, MeshBasicMaterial>;
  readonly x: number;
  readonly z: number;
  readonly y0: number;
  readonly phase: number;
  readonly sway: number;
  readonly peak: number;
  readonly rate: number;
}

/** How far the contact shadow reaches across the mat, and how deep it smears. */
const SHADOW_SPAN = 0.98;
const SHADOW_DEPTH = 0.66;
/**
 * Peak alpha right under the feet. 0.44 read as a smudge BEHIND the soles
 * rather than as contact — a crop of the mat showed the gi and the tatami
 * meeting with no dark line between them, and both fighters looked pasted on.
 * The feet need a definite dark core, not a soft average.
 */
const SHADOW_OPACITY = 0.66;
/**
 * The key sits up and at +X+Z, so a body throws its shadow the other way. A
 * perfectly centred blob is the single clearest tell that nobody is standing
 * under a lamp. The offsets are small on purpose: a shadow that has visibly
 * slid off the foot is worse than one that is merely soft.
 */
const SHADOW_OFFSET_X = -0.06;
const SHADOW_OFFSET_Z = -0.05;

/** Radius and strength of the warm pool of light each fighter stands in. */
const POOL_RADIUS = 1.5;
const POOL_OPACITY = 0.24;

/**
 * How much of the room's actual light to lend the unlit sprite planes, as a
 * chroma shift with the brightness held at 1. Full strength grades the fighter
 * sepia; zero leaves them pasted on. This is the point where the effect reads
 * without anyone being able to say why the frame suddenly looks warmer.
 */
const TINT_STRENGTH = 0.7;

export class Stage {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(FOV, 1, 0.1, 200);
  /** The painted room, scaled to cover the frustum. See coverBackdrop(). */
  private backdropPanel: Mesh<PlaneGeometry, MeshBasicMaterial> | null = null;
  private width = 1;
  private height = 1;
  private distance = 8;
  private readonly leftShadow: Mesh<PlaneGeometry, MeshBasicMaterial>;
  private readonly rightShadow: Mesh<PlaneGeometry, MeshBasicMaterial>;
  private readonly leftPool: Mesh<CircleGeometry, MeshBasicMaterial>;
  private readonly rightPool: Mesh<CircleGeometry, MeshBasicMaterial>;
  /** The light the unlit fighter planes are tinted toward, at unit brightness. */
  private readonly fighterTint = new Color(1, 1, 1);
  /**
   * Materials that want this room's light but are built out of a material class
   * that ignores it. Collected once, then re-tinted every frame — see
   * {@link applyRoomLight} for why every frame.
   */
  private readonly unlitCutouts: MeshBasicMaterial[] = [];
  private unlitScanned = false;
  /** Airborne dust in the shaft. Empty until the mote texture resolves. */
  private readonly motes: Mote[] = [];

  /**
   * Resolves when the generated art layer has finished loading, or failed to.
   * It never rejects: every piece of that layer is optional, and a missing
   * texture means "keep the procedural room", not "the boot failed".
   *
   * boot() waits on this so the dojo is already dressed when the pre-boot card
   * lifts. Without it the room is assembled untextured and dresses itself a
   * beat later, in front of the player, with nothing covering the swap.
   */
  readonly ready: Promise<void>;

  constructor(arena: ArenaSpec, baseUrl: string) {
    const backdrop = new Color(arena.backdropColor);
    this.scene.background = backdrop;
    this.scene.fog = new Fog(backdrop, 16, 60);

    // The mat runs past the camera so the frame never finds its front edge.
    const floor = new Mesh(
      new PlaneGeometry(60, 60),
      new MeshStandardMaterial({ color: arena.floorColor, roughness: 0.94, metalness: 0 }),
    );
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);

    const wall = new Mesh(
      new PlaneGeometry(80, 26),
      new MeshStandardMaterial({ color: arena.backdropColor, roughness: 1, metalness: 0 }),
    );
    wall.position.set(0, 13, -14);
    this.scene.add(wall);

    // A tatami seam every metre. Cheap, and it makes spacing legible, which is
    // the whole game. Only ever visible when the generated mat texture failed
    // to load — over real tatami they read as scratches, not seams.
    const seams = new Group();
    const seamMaterial = new MeshStandardMaterial({ color: '#8c6743', roughness: 1 });
    for (let x = -12; x <= 12; x += 1) {
      const seam = new Mesh(new BoxGeometry(0.035, 0.01, 22), seamMaterial);
      seam.position.set(x, 0.006, -3);
      seams.add(seam);
    }
    this.scene.add(seams);

    // The legal fighting area gets its own bright inset edge so a fighter
    // driven to the boundary can see it coming, not just be told by the HUD.
    const boundaryMaterial = new MeshStandardMaterial({
      color: '#d9c08f',
      roughness: 0.8,
      metalness: 0,
    });
    for (const side of [-1, 1]) {
      const edge = new Mesh(new BoxGeometry(0.06, 0.014, 22), boundaryMaterial);
      edge.position.set(side * arena.bounds, 0.009, -3);
      this.scene.add(edge);
    }

    const postMaterial = new MeshStandardMaterial({ color: '#6b4a2f', roughness: 0.8 });
    for (const side of [-1, 1]) {
      const post = new Mesh(new CylinderGeometry(0.12, 0.15, 3.6, 10), postMaterial);
      post.position.set(side * (arena.bounds + 1.1), 1.8, -3.2);
      this.scene.add(post);
    }

    const { group, fallbackBanners } = buildBackdrop(arena);
    this.scene.add(group);

    // Warm key, cool rim, low ambient: the fighters are lit, the room is not.
    const key = new DirectionalLight('#ffe0b8', 2.8);
    key.position.set(3.5, 7, 6);
    this.scene.add(key);

    // A dim opposing light lifts the shadow side. Raising ambient instead would
    // flatten the silhouette, and the silhouette is the read.
    const rim = new DirectionalLight('#7fb2e6', 1.1);
    rim.position.set(-5, 4, -3);
    this.scene.add(rim);
    const ambient = new AmbientLight('#3a4658', 0.32);
    this.scene.add(ambient);

    // An overhead dojo lamp with real falloff, so the mat brightens toward the
    // centre of the ring instead of reading as one flat wash from the two
    // directional lights alone.
    const lamp = new PointLight('#ffd49a', 8, 14, 1.8);
    lamp.position.set(0, 5.4, -1.5);
    this.scene.add(lamp);

    // The sprite fighters are drawn with a material that discards these lights,
    // so the stage hands them the colour of the ones that actually reach them
    // instead. Only the key and the ambient qualify — see planeChroma.
    this.fighterTint.copy(planeChroma([key, ambient]));

    // One soft blob per fighter, tight where the body meets the mat and gone
    // well before the edge. A uniform disc of solid black reads as a hole cut in
    // the floor: no falloff, no contact, and the hard rim is the giveaway.
    const shadowGeometry = new PlaneGeometry(1, 1);
    const shadowMaterial = new MeshBasicMaterial({
      color: '#000000',
      map: contactShadow(),
      transparent: true,
      opacity: SHADOW_OPACITY,
      side: DoubleSide,
      // The shadow darkens the light pool it sits on, so it is composited after
      // it rather than left to a depth sort between two coplanar quads.
      depthWrite: false,
    });
    this.leftShadow = new Mesh(shadowGeometry, shadowMaterial);
    this.rightShadow = new Mesh(shadowGeometry, shadowMaterial.clone());
    for (const blob of [this.leftShadow, this.rightShadow]) {
      blob.rotation.x = -Math.PI / 2;
      blob.scale.set(SHADOW_SPAN, SHADOW_DEPTH, 1);
      blob.position.set(SHADOW_OFFSET_X, 0.008, SHADOW_OFFSET_Z);
      blob.renderOrder = 2;
      this.scene.add(blob);
    }

    // A pool of warm light on the mat per fighter, so the two of them are the
    // brightest things in the room instead of one shared wash that ignores where
    // either of them is standing. Overlapping during a clinch reads as the
    // centre of the ring going bright, which is what a lamp does.
    const poolGeometry = new CircleGeometry(POOL_RADIUS, 40);
    this.leftPool = new Mesh(
      poolGeometry,
      new MeshBasicMaterial({
        map: radialGlow('#ffcf8a'),
        transparent: true,
        opacity: POOL_OPACITY,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    );
    this.rightPool = new Mesh(poolGeometry, this.leftPool.material.clone());
    for (const glow of [this.leftPool, this.rightPool]) {
      glow.rotation.x = -Math.PI / 2;
      glow.position.set(0, 0.004, 0.2);
      glow.renderOrder = 1;
      this.scene.add(glow);
    }

    // The generated art layer. Every piece is optional: a missing asset leaves
    // the procedural room exactly as it was, so the game still boots and still
    // looks deliberate with none of them present.
    this.ready = this.dressWithGeneratedArt(baseUrl, floor, seams, fallbackBanners);
  }

  /**
   * Swaps the flat procedural surfaces for the generated set, one asset at a
   * time and independently. Nothing here is allowed to throw: a 404 on one
   * texture must not take the room down with it.
   */
  private async dressWithGeneratedArt(
    baseUrl: string,
    floor: Mesh,
    seams: Group,
    fallbackBanners: Group,
  ): Promise<void> {
    const [backdrop, mat, crowd, shaft, banner, ceiling, mote] = await Promise.all([
      loadGenerated(baseUrl, 'dojo-backdrop.webp'),
      loadGenerated(baseUrl, 'dojo-floor.webp', { repeat: 8 }),
      loadGenerated(baseUrl, 'crowd-silhouette.webp'),
      loadGenerated(baseUrl, 'volumetric-shaft.webp'),
      loadGenerated(baseUrl, 'banner-vertical.webp'),
      loadGenerated(baseUrl, 'dojo-ceiling.webp'),
      loadGenerated(baseUrl, 'dust-mote.webp'),
    ]);

    if (mat !== null) {
      const material = floor.material as MeshStandardMaterial;
      material.map = mat;
      // The generated mat is a bright, evenly-lit plate. Left at full strength
      // it out-competes the fighters for attention and the frame reads as one
      // flat wash. Tinted down and roughened so the mat sits UNDER the fight.
      material.color.set('#b89668');
      material.roughness = 0.97;
      material.needsUpdate = true;
      // The procedural seams exist to make spacing legible when there is no
      // mat texture. Over real tatami they read as scratches across the weave,
      // so they come out as soon as the texture lands.
      seams.visible = false;
    }

    if (backdrop !== null) {
      // A single plane carrying the painted room, pushed behind the procedural
      // wall so the flat wall never shows through the art. Deliberately dark:
      // it is the room the fighters are lit AGAINST, and anything brighter
      // than the fighters steals the silhouette.
      const panel = new Mesh(
        new PlaneGeometry(34, 15),
        new MeshBasicMaterial({ map: backdrop, toneMapped: true }),
      );
      panel.material.color.set('#968675');
      panel.position.set(0, 5.4, BACKDROP_Z + 0.05);
      this.scene.add(panel);
      this.backdropPanel = panel;
    }

    if (crowd !== null) {
      // Seated students behind the fighting area: depth cue and scale
      // reference. The plane keeps the texture's own 3:1 aspect — stretching
      // it wider flattens every figure into a bowling pin, which reads as
      // blobs on the mat rather than as a distant row of people.
      const row = new Mesh(
        new PlaneGeometry(11, 2.4),
        new MeshBasicMaterial({
          map: crowd,
          transparent: true,
          depthWrite: false,
          // 0.46 read as cutouts rather than as a crowd. Four models have now
          // flagged this row; the warmth fix in round 2 helped the colour but
          // not the depth. What sells distance is the row being *smaller*,
          // *lower* and *further back* than the fighters, and fainter than the
          // mat it sits on. Big and dark at 46% put it in the fighting plane.
          opacity: 0.3,
          toneMapped: true,
        }),
      );
      // Warm, not neutral. A MeshBasicMaterial takes no light, so the row is
      // painted with whatever colour it is given — and at a neutral brown it
      // read as grey cutouts pasted onto a tungsten scene.
      row.material.color.set('#4a3320');
      row.position.set(0, 0.62, CROWD_Z);
      this.scene.add(row);

      // A gold sash across the row.
      //
      // The crowd is four models' worth of "identical light-grey cardboard
      // busts" (qwen3.8-max-prime, r82) and it has been that for eighty rounds:
      // one plane, one tint, no separation between the figures. The tint was
      // warmed twice and neither time broke the row up, because the problem was
      // never the colour — it is that a single flat fill has nothing in it for
      // the eye to separate figures by.
      //
      // A horizontal band at shoulder height does what a recolour cannot: it
      // crosses every figure at the same height, so the eye reads the row as a
      // rank of people wearing the same thing rather than as a strip of grey.
      // It is the one mark that is native to the scene — a dojo where the
      // students all wear the same belt is the whole point of a tournament.
      const sash = new Mesh(
        new PlaneGeometry(11, 0.17),
        new MeshBasicMaterial({
          transparent: true,
          opacity: 0.55,
          depthWrite: false,
          toneMapped: true,
        }),
      );
      sash.material.color.set('#d9a441');
      sash.position.set(0, 0.02, CROWD_Z + 0.02);
      sash.renderOrder = 3;
      this.scene.add(sash);
    }

    if (shaft !== null) {
      // A broad additive cone of haze across the mat, catching the key light.
      // Kept subtle — it is atmosphere, not a spotlight, and at full strength
      // it washes the mat out to white.
      const beam = new Mesh(
        new PlaneGeometry(16, 13),
        new MeshBasicMaterial({
          map: shaft,
          transparent: true,
          opacity: 0.22,
          depthWrite: false,
          blending: AdditiveBlending,
          toneMapped: true,
        }),
      );
      beam.material.color.set('#a08a66');
      beam.position.set(SHAFT_X, 3.4, SHAFT_Z);
      beam.renderOrder = -2;
      this.scene.add(beam);
    }

    if (banner !== null) {
      const bannerMaterial = new MeshBasicMaterial({
        map: banner,
        transparent: true,
        side: DoubleSide,
        toneMapped: true,
      });
      // Tint the cloth to the same oxblood the procedural banner used, so the
      // two can never disagree if both are ever on screen.
      bannerMaterial.color.set('#7a3b36');
      for (const side of [-1, 1]) {
        const cloth = new Mesh(new PlaneGeometry(0.95, 2.5), bannerMaterial);
        cloth.position.set(side * 5.6, 3.9, -13.3);
        this.scene.add(cloth);
      }
      // The procedural banner sat at the same spot in a different colour and
      // was never removed, so the two drew on top of each other as a flat slab
      // with a smaller red panel inset off-centre. Step it aside like the
      // tatami seams do when real art lands.
      fallbackBanners.visible = false;
    }

    if (ceiling !== null) {
      // The room had no lid. Everything above the back wall's shoji was just
      // more of the same wall plate, and the top fifth of a portrait frame is
      // the largest single region in the composition with nothing in it.
      //
      // Leaned away from the camera, not laid flat: a flat lid at this height
      // is seen edge-on and the rafters compress into a stripe, while the
      // eave's own tilt opens the underside up to the lens so the beams read as
      // beams going back over your head. Its lower edge is placed where the
      // wall's lit transom ends, so the art joins the room instead of sitting on
      // it, and its upper edge meets the top of frame. Untinted-dark for the
      // same reason the back wall is: this is the room the fighters are lit
      // AGAINST and must never out-shout them — the ceiling art's paper lantern
      // is a near-white in the source and would steal every silhouette.
      const lid = new Mesh(
        new PlaneGeometry(CEILING_W, CEILING_H),
        new MeshBasicMaterial({ map: ceiling, side: DoubleSide, toneMapped: true }),
      );
      lid.material.color.set('#463a2d');
      lid.position.set(0, CEILING_Y, CEILING_Z);
      lid.rotation.x = -CEILING_TILT;
      lid.renderOrder = -3;
      this.scene.add(lid);
    }

    if (mote !== null) {
      this.spawnMotes(mote);
    }
  }

  /**
   * Seeds the airborne dust: `MOTE_COUNT` independent quads sharing one tiny
   * plane, each with its own material so opacity and drift stay independent.
   * Additive, because a mote is a speck of light caught in a beam and nothing
   * about it should ever darken what is behind it.
   *
   * They are seeded inside the shaft's footprint and nowhere else. A mote out
   * in the unlit half of the room is a speck of light with no beam to belong
   * to, and a field of those reads as noise on the lens.
   *
   * They are also kept near the lens, at the front of the shaft rather than at
   * the back wall. The camera is ~7m out on a phone and ~4.4m on a desktop, so
   * a mote the width of a fingertip at the wall is a sub-pixel grey smudge at
   * that distance — invisible, and invisible on BOTH viewports for the same
   * reason. Up close the same sprite is a legible speck of dust.
   */
  private spawnMotes(texture: Texture): void {
    const geometry = new PlaneGeometry(1, 1);
    for (let i = 0; i < MOTE_COUNT; i += 1) {
      const material = new MeshBasicMaterial({
        map: texture,
        color: new Color('#ffe2b4'),
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: AdditiveBlending,
        toneMapped: true,
      });
      const mesh = new Mesh(geometry, material);
      mesh.visible = false;
      mesh.scale.setScalar(0.055 + (i % 4) * 0.022);
      // In front of the fighters: dust hangs in the air between the lens and
      // the fight, and a mote that the men occlude has stopped being in the
      // room the player is looking at.
      mesh.renderOrder = 11;
      this.scene.add(mesh);
      // Seeded on an even walk rather than Math.random so the motes are never
      // clumped into one corner of the beam by an unlucky draw.
      const t = (i + 0.5) / MOTE_COUNT;
      this.motes.push({
        mesh,
        // A gentle cone, widest at the bottom of the shaft and narrowing as it
        // climbs, which is the shape a beam of light actually makes.
        x: (t - 0.5) * 2 * MOTE_SPREAD + SHAFT_X,
        z: -3.0 + ((i * 7) % 9) * 0.42,
        y0: MOTE_Y_MIN + ((i * 13) % 17) * 0.2,
        phase: i * 1.7,
        sway: 0.22 + (i % 4) * 0.11,
        // Dimmer the further out it hangs. A field of equally bright specks is
        // dirt on the lens; a field brightest down the middle of the beam is
        // the beam being visible.
        peak: (0.4 + (i % 3) * 0.16) * (1 - 0.45 * Math.abs(t * 2 - 1)),
        rate: 0.72 + (i % 6) * 0.09,
      });
    }
  }

  /**
   * Dust, placed from wall time alone.
   *
   * A mote's height is `y0 + (t / rate) mod range`, so nothing is integrated
   * frame to frame: there is no velocity to accumulate, no catch-up burst after
   * a stall, and a tab that was backgrounded for a minute comes back to the
   * same field it left. Opacity eases in and out over the ends of the climb so
   * a mote never pops into existence at the bottom of the beam or vanishes
   * mid-air at the top.
   */
  private updateMotes(nowMs: number): void {
    const span = MOTE_Y_MAX - MOTE_Y_MIN;
    for (const mote of this.motes) {
      const t = (nowMs / 1000 / mote.rate + mote.phase * 3.1) % 1;
      const y = MOTE_Y_MIN + t * span;
      mote.mesh.position.set(
        mote.x + Math.sin(nowMs / 1000 * mote.sway + mote.phase) * 0.34,
        y,
        mote.z + Math.cos(nowMs / 1000 * mote.sway * 0.7 + mote.phase) * 0.18,
      );
      const fade = Math.min(1, t * 6) * Math.min(1, (1 - t) * 4);
      mote.mesh.material.opacity = mote.peak * fade;
      mote.mesh.visible = mote.mesh.material.opacity > 0.004;
    }
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.camera.aspect = width / Math.max(height, 1);
    this.camera.updateProjectionMatrix();
    this.coverBackdrop();
  }

  /**
   * Scale the painted room so it fills the frustum at any aspect.
   *
   * It was a fixed 34x15 world-unit plane, sized for a tall phone: portrait
   * covers it and nothing shows past the edge. Landscape does not — the
   * horizontal frustum at that distance is far wider than 34 units, so the
   * plane's own edges appear inside the viewport as two hard vertical seams,
   * with flat scene-background either side of them. That is the "pillarboxing"
   * and "hard-edged backdrop plane" that gemini-3.6-flash, qwen3.6-27b,
   * qwen3.5-397b-a17b and gpt-5.4-pro have all reported, and it is the single
   * most-repeated unresolved finding in the loop.
   *
   * Cover, not contain: take the larger of the two ratios, so the room always
   * reaches the edges and crops rather than letterboxes. The plane's aspect is
   * allowed to change — it is a painted room behind a lit one, and the visible
   * part of it is the middle either way.
   */
  private coverBackdrop(): void {
    const panel = this.backdropPanel;
    if (panel === null) return;
    const halfFov = (FOV * Math.PI) / 360;
    const dist = Math.abs(this.camera.position.z - (BACKDROP_Z + 0.05));
    const visH = 2 * dist * Math.tan(halfFov);
    const visW = visH * this.camera.aspect;
    const base = panel.geometry.parameters;
    const k = Math.max(visW / base.width, visH / base.height);
    panel.scale.set(k, k, 1);
  }

  /**
   * A portrait phone is a tall slot, so holding a fixed width would push the
   * camera far enough back to turn both fighters into dolls. The frame instead
   * holds only the distance actually between them, dollying in as the exchange
   * closes and back out as it opens.
   *
   * `nowMs` is wall time and drives the airborne dust only. It is presentation
   * and never reaches the simulation, which is fed fixed steps from the clock in
   * the caller.
   */
  frame(midpointX: number, gap: number, immediate = false, nowMs = performance.now(), reach = 0): void {
    const solve = framingSolve(this.width, this.height, midpointX, gap, reach);

    const ease = immediate ? 1 : 0.07;
    this.distance += (solve.distance - this.distance) * ease;

    const x = immediate ? solve.cameraX : this.camera.position.x + (solve.cameraX - this.camera.position.x) * 0.12;

    // Level camera, lifted only slightly on a phone. There the distance is
    // width-driven, so the vertical window is taller than the fighters need
    // and the empty mat under their feet is real — but lifting the camera
    // slides the window up and crops their feet off the bottom, which is a
    // worse trade. A small lift removes most of the dead band and none of the
    // floor under a stance.
    const eyeY = solve.tight ? 1.5 : 1.18;
    this.camera.position.set(x, eyeY, this.distance);
    this.camera.lookAt(x, eyeY, 0);

    const follow = immediate ? 1 : 0.08;
    this.leftPool.position.x += (midpointX - gap / 2 - this.leftPool.position.x) * follow;
    this.rightPool.position.x += (midpointX + gap / 2 - this.rightPool.position.x) * follow;
    this.leftShadow.position.x = midpointX - gap / 2;
    this.rightShadow.position.x = midpointX + gap / 2;
    this.updateMotes(nowMs);
    this.applyRoomLight();
  }

  /**
   * Hands the unlit fighter planes the colour of the light they are standing in.
   *
   * `MeshBasicMaterial` throws away every light in the scene, so a photoreal
   * cutout drawn with one is lit by nothing at all while the mat around it is
   * lit by a warm key. That mismatch — not the resolution, not the outline — is
   * what makes a sprite read as pasted on. Multiplying the material colour is
   * the only lever left, and it is a real one: the tint is the chromaticity of
   * the light where the fighters stand, normalised to unit brightness so
   * nothing about the exposure moves.
   *
   * Re-applied every frame on purpose. The impact flash writes
   * `color.setScalar(1 + amount * 2.4)`, a pure brightness multiplier that
   * would discard a tint left sitting on the material. Painting the resting
   * tint back over on the way into the next frame means the flash still blows
   * out to white while it lasts and the fighter lands back in the room when it
   * ends, without the flash path having to know any of this.
   */
  private applyRoomLight(): void {
    if (!this.unlitScanned) {
      this.unlitScanned = true;
      this.scene.traverse((object) => {
        if (!(object instanceof Mesh)) return;
        const material = object.material as Material | Material[];
        if (!(material instanceof MeshBasicMaterial)) return;
        // A cutout: a baked image behind a hard alpha edge. That is exactly the
        // case where a light the material ignores shows up as a seam between the
        // fighter and the room. It also keeps this off everything else in the
        // scene — the stage's own planes are opaque or already hand-tinted, and
        // the juice particles carry no map at all.
        if (material.map === null || material.alphaTest <= 0) return;
        this.unlitCutouts.push(material);
      });
    }
    for (const material of this.unlitCutouts) material.color.copy(this.fighterTint);
  }
}

/**
 * Restrained depth behind the mat: a beam overhead, shoji-style panels
 * catching the rim light, and a couple of hanging banners. All original
 * shapes, nothing evoking a specific existing game's dojo. This is the
 * fallback room; the generated backdrop covers it when it loads.
 */
function buildBackdrop(arena: ArenaSpec): { group: Group; fallbackBanners: Group } {
  const group = new Group();

  const beamMaterial = new MeshStandardMaterial({ color: '#4a3826', roughness: 0.85 });
  const beam = new Mesh(new BoxGeometry(26, 0.35, 0.35), beamMaterial);
  beam.position.set(0, 5.5, -13.6);
  group.add(beam);

  const panelMaterial = new MeshStandardMaterial({
    color: new Color(arena.backdropColor).lerp(new Color('#e7ddc8'), 0.22),
    roughness: 0.96,
  });
  const frameMaterial = new MeshStandardMaterial({ color: '#2c2117', roughness: 0.8 });
  const panelCount = 7;
  const spacing = 3.1;
  for (let i = 0; i < panelCount; i += 1) {
    const x = (i - (panelCount - 1) / 2) * spacing;
    const panel = new Mesh(new PlaneGeometry(2.5, 4.4), panelMaterial);
    panel.position.set(x, 3.1, -13.9);
    group.add(panel);

    const frame = new Mesh(new BoxGeometry(2.62, 6.52, 0.08), frameMaterial);
    frame.position.set(x, 6.6, -13.95);
    group.add(frame);
  }

  const bannerMaterial = new MeshStandardMaterial({ color: '#5c1f1c', roughness: 0.9 });
  const fallbackBanners = new Group();
  for (const side of [-1, 1]) {
    const banner = new Mesh(new PlaneGeometry(1.05, 2.6), bannerMaterial);
    banner.position.set(side * 5.6, 3.9, -13.3);
    fallbackBanners.add(banner);
  }
  group.add(fallbackBanners);

  return { group, fallbackBanners };
}

/** A soft radial falloff, bright in the middle and gone by the edge. */
function radialGlow(color: string): CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext('2d');
  if (g !== null) {
    const gradient = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, color);
    gradient.addColorStop(0.45, `${color}88`);
    gradient.addColorStop(1, `${color}00`);
    g.fillStyle = gradient;
    g.fillRect(0, 0, size, size);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/**
 * A contact shadow: opaque black under the feet, gone before the edge of the
 * quad, and gone quickly on the way out. The stops matter more than the peak
 * alpha — a real contact shadow is small, tight and soft, and what makes a fake
 * one look punched-out is a long flat plateau with a hard rim on the end of it.
 */
function contactShadow(): CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext('2d');
  if (g !== null) {
    const gradient = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    // A hard dark core, then a fast falloff. The first pass held 0.86 alpha all
    // the way out to 22% radius and read as one soft smudge, so the eye had
    // nothing to grab at and the feet looked pasted onto the mat. Contact is
    // read from the small dark spot directly under the sole, and the wide soft
    // spread around it is the cast shadow — two different things, two different
    // strengths.
    gradient.addColorStop(0, 'rgba(0,0,0,1)');
    gradient.addColorStop(0.1, 'rgba(0,0,0,1)');
    gradient.addColorStop(0.24, 'rgba(0,0,0,0.72)');
    gradient.addColorStop(0.42, 'rgba(0,0,0,0.4)');
    gradient.addColorStop(0.68, 'rgba(0,0,0,0.14)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gradient;
    g.fillRect(0, 0, size, size);
  }
  const texture = new CanvasTexture(canvas);
  // Only the alpha channel carries anything, so this is not a colour map and
  // must not be decoded out of sRGB on the way in.
  texture.colorSpace = NoColorSpace;
  return texture;
}

/**
 * The colour a plane facing +Z at the fighters' spot is standing in, taken from
 * the lights this class builds, returned at unit brightness.
 *
 * Only what such a plane can physically see is counted. Its normal is +Z, so a
 * directional light contributes `N·L` and a light behind the plane contributes
 * nothing at all: the cool rim is behind them and the lamp is up and behind
 * them, and both are excluded here for that reason rather than by taste. The
 * ambient term is the one light with no direction, so it goes in whole. The
 * weights are light intensities and the one `N·L` above — no shading model is
 * being reproduced here, only the ratio between the two colours that reach a
 * fighter, which is the part a missing light actually shows up in.
 */
function planeChroma(lights: readonly (DirectionalLight | AmbientLight)[]): Color {
  const sum = new Color(0, 0, 0);
  for (const light of lights) {
    const weight =
      light instanceof AmbientLight
        ? light.intensity
        : // Both directional lights target the origin, so their position is
          // already the direction from the surface to the light. Only the z
          // component matters: N is +Z, so N·L is L.z.
          light.intensity * (Math.max(0, light.position.z) / Math.max(light.position.length(), 1e-6));
    sum.r += light.color.r * weight;
    sum.g += light.color.g * weight;
    sum.b += light.color.b * weight;
  }
  const peak = Math.max(sum.r, sum.g, sum.b, 1e-6);
  // Unit peak keeps this a hue shift. Anything that multiplies brightness is
  // the impact flash's job, and it is expecting a plain scalar here.
  sum.r /= peak;
  sum.g /= peak;
  sum.b /= peak;
  sum.lerp(new Color(1, 1, 1), 1 - TINT_STRENGTH);
  return sum;
}
