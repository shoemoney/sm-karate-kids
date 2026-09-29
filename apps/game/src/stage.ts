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
  PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  RepeatWrapping,
  Scene,
  TextureLoader,
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
 * Where the dojo furniture lives, in metres. The camera only ever dollies and
 * pans along +Z, so these are fixed placements the frame is composed around.
 */
const BACKDROP_Z = -13.9;
const CROWD_Z = -8.2;
const SHAFT_Z = -3.2;

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

/** Resolves whether a generated asset exists, without throwing on a 404. */
async function tryLoad(url: string, opts?: { repeat?: number }): Promise<Texture | null> {
  try {
    const response = await fetch(url, { method: 'HEAD' });
    if (!response.ok) return null;
    return await loadTexture(url, opts ?? {});
  } catch {
    return null;
  }
}

export class Stage {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(FOV, 1, 0.1, 200);
  private width = 1;
  private height = 1;
  private distance = 8;
  private readonly leftShadow: Mesh<CircleGeometry, MeshBasicMaterial>;
  private readonly rightShadow: Mesh<CircleGeometry, MeshBasicMaterial>;
  private readonly pool: Mesh<CircleGeometry, MeshBasicMaterial>;

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

    this.scene.add(buildBackdrop(arena));

    // Warm key, cool rim, low ambient: the fighters are lit, the room is not.
    const key = new DirectionalLight('#ffe0b8', 2.8);
    key.position.set(3.5, 7, 6);
    this.scene.add(key);

    // A dim opposing light lifts the shadow side. Raising ambient instead would
    // flatten the silhouette, and the silhouette is the read.
    const rim = new DirectionalLight('#7fb2e6', 1.1);
    rim.position.set(-5, 4, -3);
    this.scene.add(rim);
    this.scene.add(new AmbientLight('#3a4658', 0.32));

    // An overhead dojo lamp with real falloff, so the mat brightens toward the
    // centre of the ring instead of reading as one flat wash from the two
    // directional lights alone.
    const lamp = new PointLight('#ffd49a', 8, 14, 1.8);
    lamp.position.set(0, 5.4, -1.5);
    this.scene.add(lamp);

    const shadowGeometry = new CircleGeometry(0.34, 24);
    const shadowMaterial = new MeshBasicMaterial({
      color: '#000000',
      transparent: true,
      opacity: 0.38,
      side: DoubleSide,
    });
    this.leftShadow = new Mesh(shadowGeometry, shadowMaterial);
    this.rightShadow = new Mesh(shadowGeometry, shadowMaterial.clone());
    for (const blob of [this.leftShadow, this.rightShadow]) {
      blob.rotation.x = -Math.PI / 2;
      blob.position.y = 0.008;
      this.scene.add(blob);
    }

    // A pool of warm light on the mat that follows the fight, so wherever the
    // exchange goes, that is where the room is brightest.
    this.pool = new Mesh(
      new CircleGeometry(3.2, 48),
      new MeshBasicMaterial({
        map: radialGlow('#ffcf8a'),
        transparent: true,
        opacity: 0.32,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    );
    this.pool.rotation.x = -Math.PI / 2;
    this.pool.position.set(0, 0.004, 0.2);
    this.scene.add(this.pool);

    // The generated art layer. Every piece is optional: a missing asset leaves
    // the procedural room exactly as it was, so the game still boots and still
    // looks deliberate with none of them present.
    void this.dressWithGeneratedArt(baseUrl, floor, seams);
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
      material.color.set('#8d7458');
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
      panel.material.color.set('#7d6e5e');
      panel.position.set(0, 5.4, BACKDROP_Z + 0.05);
      this.scene.add(panel);
    }

    if (crowd !== null) {
      // Seated students behind the fighting area: depth cue and scale
      // reference. Sunk low against the mat and pushed well back, so it reads
      // as a distant row of spectators rather than as shapes floating at the
      // fighters' shoulder height.
      const row = new Mesh(
        new PlaneGeometry(13, 1.5),
        new MeshBasicMaterial({
          map: crowd,
          transparent: true,
          depthWrite: false,
          opacity: 0.62,
          toneMapped: true,
        }),
      );
      row.material.color.set('#3a2f24');
      row.position.set(0, 0.62, CROWD_Z);
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
      for (const side of [-1, 1]) {
        const cloth = new Mesh(new PlaneGeometry(0.95, 2.5), bannerMaterial);
        cloth.position.set(side * 5.4, 3.9, -13.3);
        this.scene.add(cloth);
      }
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
    const halfWidth = Math.max(MIN_HALF_WIDTH, Math.abs(gap) / 2 + EDGE_MARGIN);
    const target = Math.max(FRAME_HALF_HEIGHT / tan, halfWidth / (aspect * tan)) * 1.04;

    const ease = immediate ? 1 : 0.07;
    this.distance += (target - this.distance) * ease;

    const targetX = midpointX * 0.7;
    const x = immediate ? targetX : this.camera.position.x + (targetX - this.camera.position.x) * 0.12;

    // A level camera at chest height. Tilting down on a tall viewport buys a
    // third of a screen of empty foreground mat and nothing else.
    this.camera.position.set(x, 1.18, this.distance);
    this.camera.lookAt(x, 1.18, 0);

    this.pool.position.x += (midpointX - this.pool.position.x) * (immediate ? 1 : 0.08);
    this.leftShadow.position.x = midpointX - gap / 2;
    this.rightShadow.position.x = midpointX + gap / 2;
  }
}

/**
 * Restrained depth behind the mat: a beam overhead, shoji-style panels
 * catching the rim light, and a couple of hanging banners. All original
 * shapes, nothing evoking a specific existing game's dojo. This is the
 * fallback room; the generated backdrop covers it when it loads.
 */
function buildBackdrop(arena: ArenaSpec): Group {
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
  for (const side of [-1, 1]) {
    const banner = new Mesh(new PlaneGeometry(1.05, 2.6), bannerMaterial);
    banner.position.set(side * 5.6, 3.9, -13.3);
    group.add(banner);
  }

  return group;
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
