import {
  AmbientLight,
  BoxGeometry,
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
  Scene,
} from 'three/webgpu';
import type { ArenaSpec } from '@smkk/sim';

const FOV = 34;
/** Metres of headroom the frame always keeps above and below the action. */
const FRAME_HALF_HEIGHT = 1.3;
/** The tightest the camera will ever pull in, so a clinch is not a close-up. */
const MIN_HALF_WIDTH = 1.25;
/** Breathing room outside the pair, in metres. */
const EDGE_MARGIN = 0.6;

export class Stage {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(FOV, 1, 0.1, 200);
  private width = 1;
  private height = 1;
  private distance = 8;
  private readonly leftShadow: Mesh<CircleGeometry, MeshBasicMaterial>;
  private readonly rightShadow: Mesh<CircleGeometry, MeshBasicMaterial>;

  constructor(arena: ArenaSpec) {
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
    // the whole game.
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

    const key = new DirectionalLight('#fff2d8', 2.5);
    key.position.set(3.5, 7, 6);
    this.scene.add(key);

    // A dim opposing light lifts the shadow side. Raising ambient instead would
    // flatten the silhouette, and the silhouette is the read.
    const rim = new DirectionalLight('#8fbfe8', 0.8);
    rim.position.set(-5, 4, -3);
    this.scene.add(rim);
    this.scene.add(new AmbientLight('#4e5f75', 0.5));

    // An overhead dojo lamp with real falloff, so the mat brightens toward the
    // centre of the ring instead of reading as one flat wash from the two
    // directional lights alone.
    const lamp = new PointLight('#ffe4bd', 6, 14, 1.8);
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

    this.leftShadow.position.x = midpointX - gap / 2;
    this.rightShadow.position.x = midpointX + gap / 2;
  }
}

/**
 * Restrained depth behind the mat: a beam overhead, shoji-style panels
 * catching the rim light, and a couple of hanging banners. All original
 * shapes, nothing evoking a specific existing game's dojo.
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
