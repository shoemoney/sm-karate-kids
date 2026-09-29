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
  RepeatWrapping,
  Scene,
  TextureLoader,
  type Material,
} from 'three/webgpu';
import type { Texture } from 'three/webgpu';
import type { ArenaSpec } from '@smkk/sim';

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
 * Where the dojo furniture lives, in metres. The camera only ever dollies and
 * pans along +Z, so these are fixed placements the frame is composed around.
 */
const BACKDROP_Z = -13.9;
const CROWD_Z = -8.2;
const SHAFT_Z = -3.2;

/** How far the contact shadow reaches across the mat, and how deep it smears. */
const SHADOW_SPAN = 0.98;
const SHADOW_DEPTH = 0.66;
/** Peak alpha right under the feet. The falloff lives in the texture, not here. */
const SHADOW_OPACITY = 0.44;
/**
 * The key sits up and at +X+Z, so a body throws its shadow the other way. A
 * perfectly centred blob is the single clearest tell that nobody is standing
 * under a lamp.
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

function loadTexture(url: string, opts: { srgb?: boolean; repeat?: number } = {}): Promise<Texture> {
  return new Promise<Texture>((resolve, reject) => {
    new TextureLoader().load(
      url,
      (texture) => {
        texture.colorSpace = SRGBColorSpace;
        if (opts.repeat !== undefined) {
          texture.wrapS = RepeatWrapping;
          texture.wrapT = RepeatWrapping;
          texture.repeat.set(opts.repeat, opts.repeat);
        }
        resolve(texture);
      },
      undefined,
      (error) => reject(error instanceof Error ? error : new Error(String(error))),
    );
  });
}

/**
 * Loads a generated asset, returning null instead of throwing when it is
 * genuinely absent.
 *
 * There is deliberately no HEAD probe here. A HEAD preflight costs a second
 * request per asset and — worse — many CDNs and object stores answer HEAD with
 * 405, at which point this would silently drop the entire art layer and fall
 * back to the procedural room with nothing in the console. TextureLoader
 * already distinguishes "not found" from "loaded", so a single GET is both
 * cheaper and more honest; the warn below is what makes a miss diagnosable.
 */
async function tryLoad(url: string, opts?: { repeat?: number }): Promise<Texture | null> {
  try {
    return await loadTexture(url, opts ?? {});
  } catch {
    console.warn(
      `[smkk] generated art "${url}" failed to load; the dojo keeps its procedural fallback for this piece`,
    );
    return null;
  }
}

export class Stage {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(FOV, 1, 0.1, 200);
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
    const [backdrop, mat, crowd, shaft, banner] = await Promise.all([
      tryLoad(`${baseUrl}generated/dojo-backdrop.webp`),
      tryLoad(`${baseUrl}generated/dojo-floor.webp`, { repeat: 8 }),
      tryLoad(`${baseUrl}generated/crowd-silhouette.webp`),
      tryLoad(`${baseUrl}generated/volumetric-shaft.webp`),
      tryLoad(`${baseUrl}generated/banner-vertical.webp`),
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
    }

    if (crowd !== null) {
      // Seated students behind the fighting area: depth cue and scale
      // reference. The plane keeps the texture's own 3:1 aspect — stretching
      // it wider flattens every figure into a bowling pin, which reads as
      // blobs on the mat rather than as a distant row of people.
      const row = new Mesh(
        new PlaneGeometry(9, 3),
        new MeshBasicMaterial({
          map: crowd,
          transparent: true,
          depthWrite: false,
          opacity: 0.55,
          toneMapped: true,
        }),
      );
      row.material.color.set('#2e241a');
      row.position.set(0, 0.85, CROWD_Z);
      this.scene.add(row);
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
      beam.position.set(-1.6, 3.4, SHAFT_Z);
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
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.camera.aspect = width / Math.max(height, 1);
    this.camera.updateProjectionMatrix();
  }

  /**
   * A portrait phone is a tall slot, so holding a fixed width would push the
   * camera far enough back to turn both fighters into dolls. The frame instead
   * holds only the distance actually between them, dollying in as the exchange
   * closes and back out as it opens.
   */
  frame(midpointX: number, gap: number, immediate = false): void {
    const aspect = this.width / Math.max(this.height, 1);
    const halfFov = (FOV * Math.PI) / 360;
    const tan = Math.tan(halfFov);
    // The gap is measured centre to centre, but a fighter is not a point: a
    // wide lunge stance throws a foot well past its own centre, and framing on
    // the gap alone sliced that foot off at the frame edge on the strike pose.
    // Budget for half a body on each side of the pair.
    const halfWidth = Math.max(
      MIN_HALF_WIDTH,
      Math.abs(gap) / 2 + EDGE_MARGIN + FIGHTER_HALF_WIDTH,
    );
    const target = Math.max(FRAME_HALF_HEIGHT / tan, halfWidth / (aspect * tan)) * 1.04;

    const ease = immediate ? 1 : 0.07;
    this.distance += (target - this.distance) * ease;

    const targetX = midpointX * 0.7;
    const x = immediate ? targetX : this.camera.position.x + (targetX - this.camera.position.x) * 0.12;

    // A level camera at chest height. Tilting down on a tall viewport buys a
    // third of a screen of empty foreground mat and nothing else.
    this.camera.position.set(x, 1.18, this.distance);
    this.camera.lookAt(x, 1.18, 0);

    const follow = immediate ? 1 : 0.08;
    this.leftPool.position.x += (midpointX - gap / 2 - this.leftPool.position.x) * follow;
    this.rightPool.position.x += (midpointX + gap / 2 - this.rightPool.position.x) * follow;
    this.leftShadow.position.x = midpointX - gap / 2;
    this.rightShadow.position.x = midpointX + gap / 2;
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
    gradient.addColorStop(0, 'rgba(0,0,0,1)');
    gradient.addColorStop(0.22, 'rgba(0,0,0,0.86)');
    gradient.addColorStop(0.45, 'rgba(0,0,0,0.42)');
    gradient.addColorStop(0.7, 'rgba(0,0,0,0.13)');
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
