import {
  AdditiveBlending,
  NormalBlending,
  CanvasTexture,
  Color,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  type PerspectiveCamera,
  type Scene,
} from 'three/webgpu';
import { loadGenerated } from './artLoader.js';


/**
 * Everything that makes a hit feel like a hit. Presentation only: the one
 * thing it can do to the game is ask the clock for less time, which pauses
 * the simulation without changing a single tick of it.
 */

export type ImpactKind = 'strike' | 'sweep' | 'block';
export type ImpactValue = 'full' | 'half' | 'none';

interface Particle {
  mesh: Mesh<PlaneGeometry, MeshBasicMaterial>;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  gravity: number;
  spin: number;
}

/**
 * A contact burst or a shockwave: one drawn sprite, no motion of its own beyond
 * growing and fading, so it is its own shape rather than another particle.
 */
interface Burst {
  mesh: Mesh<PlaneGeometry, MeshBasicMaterial>;
  life: number;
  maxLife: number;
  from: number;
  to: number;
  peak: number;
}

const POOL_SIZE = 64;
const DUST_POOL = 24;
/** Enough for a flurry; a full-point hit reuses the oldest rather than waiting. */
const FLASH_POOL = 4;
const RING_POOL = 3;
// Additive light is only light if it outruns the surface it lands on. These
// sit on a mid-warm-brown dojo backdrop, and `#fff1c9` added to that is
// *pale tan* — which is why six rounds of tuning left the loop looking at thin
// brown splinters and calling them sparks. The hot end is pushed towards white
// so it wins against the backdrop instead of blending into it, and the cool end
// keeps the warm cast so it still belongs to a tungsten-lit room.
const SPARK = new Color('#fffaf0');
const SPARK_HOT = new Color('#ffd9a0');
const DUST = new Color('#c9a071');
const BLOCK = new Color('#9fd3ff');

export interface Flashable {
  flash?(amount: number): void;
  /**
   * A brief presentation-only shove, away from the strike. Point-karate ends
   * the exchange on contact, so the simulation deliberately does not move
   * anyone — but "fighters idle straight through being struck" is the single
   * most-raised feeling note in twenty-three rounds of review, and a white
   * flash alone does not sell a hit. The view absorbs the recoil and springs
   * back; the sim never knows.
   */
  recoil?(amount: number, facing: 1 | -1): void;
}

/**
 * A spark, drawn once and shared by every particle in the pool.
 *
 * Bright and hard at the leading edge, tapering to nothing at the trailing
 * one, with the long edges softened so the quad it is painted on does not show.
 * Additive blending does the rest.
 */
function sparkStreak(): CanvasTexture {
  const w = 128;
  const h = 32;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d');
  if (g !== null) {
    const along = g.createLinearGradient(0, 0, w, 0);
    // A compact hot core at the leading edge, then a long fade. The old ramp
    // peaked at 0.9 and stayed bright to the very end, so the bright part WAS
    // the whole bar — a uniformly lit stick. Concentrating the energy into the
    // first fifth is what makes it read as something leaving the metal.
    along.addColorStop(0, 'rgba(255,255,255,0)');
    along.addColorStop(0.55, 'rgba(255,255,255,0.10)');
    along.addColorStop(0.82, 'rgba(255,255,255,0.62)');
    along.addColorStop(0.96, 'rgba(255,255,255,1)');
    along.addColorStop(1, 'rgba(255,255,255,0.55)');
    g.fillStyle = along;
    g.fillRect(0, 0, w, h);
    // Soften the long edges so the quad's own outline never shows.
    const across = g.createLinearGradient(0, 0, 0, h);
    across.addColorStop(0, 'rgba(0,0,0,1)');
    across.addColorStop(0.5, 'rgba(0,0,0,0)');
    across.addColorStop(1, 'rgba(0,0,0,1)');
    g.globalCompositeOperation = 'destination-out';
    g.fillStyle = across;
    g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = 'source-over';
  }
  const tex = new CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

export class Juice {
  private readonly particles: Particle[] = [];
  private readonly dustPool: Particle[] = [];
  private readonly bursts: Burst[] = [];
  private readonly rings: Burst[] = [];
  private cursor = 0;
  private dustCursor = 0;
  private readonly pools = [this.particles, this.dustPool];
  private readonly burstPools = [this.bursts, this.rings];
  private hitstopUntil = 0;
  private slowmoUntil = 0;
  private shake = 0;
  private shakeUntil = 0;
  private punch = 0;
  private punchTargetX = 0;
  private readonly fighterFlashes: Array<{ view: Flashable; until: number; peak: number; start: number }> = [];
  private readonly screenFlash: HTMLDivElement;
  private readonly artBaseUrl: string;

  constructor(
    scene: Scene,
    private readonly camera: PerspectiveCamera,
    stageElement: HTMLElement,
    private readonly reducedMotion: () => boolean,
    baseUrl = import.meta.env.BASE_URL as string,
  ) {
    this.artBaseUrl = baseUrl;
    const geometry = new PlaneGeometry(1, 1);
    const streak = sparkStreak();
    // Two pools with fixed blending. One shared pool meant switching a
    // material's blending on every spark, which forces a shader rebuild on
    // the exact frame the hit lands.
    for (let i = 0; i < POOL_SIZE; i += 1) {
      const dust = i >= POOL_SIZE - DUST_POOL;
      const material = new MeshBasicMaterial({
        color: dust ? DUST : SPARK,
        // Sparks carry a tapered streak map. Without one they are plane
        // quads with a solid colour, which at 3x is exactly what they looked
        // like: hard-edged rectangles of uniform width, all the same length,
        // with no taper and no glow. qwen3.8-max-prime read them as "flat
        // opaque rectangle dashes" and "confetti", and they were right — a
        // spark is a thing that tapers and is brighter where it leaves the
        // metal, and a rectangle is neither.
        map: dust ? null : streak,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: dust ? NormalBlending : AdditiveBlending,
      });
      const mesh = new Mesh(geometry, material);
      mesh.visible = false;
      mesh.renderOrder = 10;
      scene.add(mesh);
      (dust ? this.dustPool : this.particles).push({ mesh, vx: 0, vy: 0, life: 0, maxLife: 1, gravity: 0, spin: 0 });
    }

    // The two drawn hit sprites. Their maps arrive after the first frame, so a
    // hit in the opening second still plays — it just lands as an untinted
    // quad rather than as a painted burst, and never as a missing object.
    for (let i = 0; i < FLASH_POOL; i += 1) {
      const mesh = burstMesh(geometry);
      mesh.renderOrder = 12;
      scene.add(mesh);
      this.bursts.push({ mesh, life: 0, maxLife: 1, from: 0.4, to: 1, peak: 1 });
    }
    for (let i = 0; i < RING_POOL; i += 1) {
      const mesh = burstMesh(geometry);
      mesh.renderOrder = 11;
      scene.add(mesh);
      this.rings.push({ mesh, life: 0, maxLife: 1, from: 0.15, to: 1, peak: 1 });
    }

    this.screenFlash = document.createElement('div');
    this.screenFlash.className = 'impact-flash';
    stageElement.appendChild(this.screenFlash);

    void this.dressWithHitArt();
  }

  /**
   * Pulls in the painted hit sprites. Independent of everything else here:
   * neither load is allowed to reject into the caller, and a miss only costs the
   * hit its art, not the fight.
   */
  private async dressWithHitArt(): Promise<void> {
    const [flash, ring] = await Promise.all([
      loadGenerated(this.artBaseUrl, 'impact-flash.webp'),
      loadGenerated(this.artBaseUrl, 'impact-ring.webp'),
    ]);
    if (flash !== null) for (const burst of this.bursts) burst.mesh.material.map = flash;
    if (ring !== null) for (const burst of this.rings) burst.mesh.material.map = ring;
  }

  /** How much wall time the simulation should receive this frame. */
  timeScale(nowMs: number): number {
    if (nowMs < this.hitstopUntil) return 0;
    if (nowMs < this.slowmoUntil) return 0.3;
    return 1;
  }

  impact(options: {
    x: number;
    y: number;
    facing: 1 | -1;
    kind: ImpactKind;
    value: ImpactValue;
    defender: Flashable | null;
    nowMs: number;
  }): void {
    const { x, y, facing, kind, value, defender, nowMs } = options;
    const calm = this.reducedMotion();
    const heavy = value === 'full';

    // The freeze is information, not violence: it shows the contact frame, so
    // it survives reduced motion at a gentler length.
    const freeze = kind === 'block' ? 45 : heavy ? 95 : 65;
    this.hitstopUntil = Math.max(this.hitstopUntil, nowMs + (calm ? freeze * 0.5 : freeze));

    const count = kind === 'block' ? 10 : heavy ? 26 : 16;
    for (let i = 0; i < count; i += 1) this.emit(x, y, facing, kind, heavy);

    // The painted burst at the contact point, and — on a full point only — a
    // shockwave that leaves it. A half point gets sparks and no ring: the ring
    // is the part of the frame that says the technique scored clean all the way
    // through, and spending it on waza-ari would mean it means nothing.
    const flash = kind === 'block' ? 0.55 : heavy ? 1 : 0.78;
    this.burst(this.bursts, x, y, heavy ? 0.62 : 0.34, heavy ? 1.15 : 0.8, flash);
    if (heavy) this.burst(this.rings, x, y, 0.25, 2.2, 0.8);

    if (!calm) {
      this.shake = kind === 'block' ? 0.04 : heavy ? 0.16 : 0.08;
      this.shakeUntil = nowMs + (heavy ? 260 : 170);
      this.punch = heavy ? 0.14 : kind === 'block' ? 0.03 : 0.07;
      this.punchTargetX = x;
      if (kind !== 'block') {
        if (defender?.flash !== undefined) {
          // Shorter as well as dimmer: the pop has to be out of the way before
          // the fighter's recoil is worth watching.
          this.fighterFlashes.push({ view: defender, start: nowMs, until: nowMs + (heavy ? 95 : 70), peak: heavy ? 1 : 0.7 });
        }
        // Pushed away from the striker, harder on a full point, and always
        // sprung back to zero by the rig.
        defender?.recoil?.(heavy ? 0.075 : 0.045, facing);
      }
      if (heavy) this.flashScreen(0.5);
    }

    const pattern = kind === 'block' ? [12] : heavy ? [40, 30, 70] : [28];
    globalThis.navigator?.vibrate?.(pattern);
  }

  /** The bout is decided: let the last moment breathe. */
  matchPoint(nowMs: number): void {
    if (this.reducedMotion()) return;
    this.slowmoUntil = nowMs + 1100;
    this.flashScreen(0.7);
  }

  private flashScreen(peak: number): void {
    this.screenFlash.style.setProperty('--peak', String(peak));
    this.screenFlash.classList.remove('go');
    // Force a style flush so the animation restarts on back-to-back hits.
    void this.screenFlash.offsetWidth;
    this.screenFlash.classList.add('go');
  }

  /**
   * Fires the next free sprite in a pool, growing it from `from` to `to`
   * metres over its lifetime and fading it out on the way.
   *
   * Steals the oldest slot rather than dropping the hit when the pool is busy:
   * a flurry of techniques must never land one frame with no burst at all, and
   * a burst that is already three-quarters faded is the one worth losing.
   *
   * Life is set in seconds, not on a wall clock, so it decays on exactly the
   * same `dt` the sparks do — the flash cannot outlive its own contact frame
   * when the tab is throttled or the frame rate dips.
   */
  private burst(pool: Burst[], x: number, y: number, from: number, to: number, peak: number): void {
    const busy = pool.filter((b) => b.life > 0);
    const slot = busy.length < pool.length ? busy[0] : pool.reduce((a, b) => (a.life < b.life ? a : b));
    if (slot === undefined) return;
    slot.from = from;
    slot.to = to;
    slot.peak = peak;
    // 620ms is long enough for a full-point shockwave to leave the contact
    // point and thin out; the flash is shorter so it reads as the punch and the
    // ring reads as what the punch left behind.
    slot.maxLife = to > 1.5 ? 0.62 : 0.34;
    slot.life = slot.maxLife;
    slot.mesh.position.set(x, y, 0.4);
    slot.mesh.scale.setScalar(from);
    slot.mesh.material.opacity = peak;
    slot.mesh.visible = true;
  }

  private emit(x: number, y: number, facing: 1 | -1, kind: ImpactKind, heavy: boolean): void {
    const sweep = kind === 'sweep';
    const pool = sweep ? this.dustPool : this.particles;
    const index = sweep ? this.dustCursor : this.cursor;
    const p = pool[index];
    if (sweep) this.dustCursor = (this.dustCursor + 1) % pool.length;
    else this.cursor = (this.cursor + 1) % pool.length;
    if (p === undefined) return;

    const material = p.mesh.material;
    const angle = (Math.random() - 0.5) * (kind === 'sweep' ? 1.1 : 2.4);
    const speed = (kind === 'sweep' ? 1.2 : 2.6) * (0.4 + Math.random()) * (heavy ? 1.35 : 1);

    if (kind === 'sweep') {
      material.color.copy(DUST);
      p.vx = facing * Math.cos(angle) * speed;
      // Round 93 measured the burst on `11-phone-impact`: sparks ran from above
      // Asmongold's head down to his belt, a column the height of his whole
      // torso, while the contact — round 80's fix — is at the chest. The cause
      // is arithmetic. Speed peaks at 2.6 * 1.4 * 1.35 = 4.9 u/s, and the old
      // 0.7 factor plus a 0.4 floor let `vy` reach ~3.8; against gravity 3.2 a
      // particle rises v^2/2g = 2.26 world units, and the fighters are 1.7 tall.
      // So the throw carried a spark clean over the defender's head every time.
      //
      // A hit throws material away from the contact, not upward. Horizontal
      // spread is `vx` and is untouched; this only brings the vertical back to
      // a rise of about a quarter of a fighter's height, which is a burst.
      p.vy = Math.abs(Math.sin(angle)) * speed * 0.3 + 0.15;
      p.gravity = 3.2;
      p.maxLife = 0.55 + Math.random() * 0.35;
      p.mesh.scale.setScalar(0.07 + Math.random() * 0.09);
    } else {
      material.color.copy(kind === 'block' ? BLOCK : Math.random() < 0.35 ? SPARK_HOT : SPARK);
      // Sparks spray back along the strike's line, the way splinters fly.
      p.vx = -facing * Math.cos(angle) * speed * 0.6 + facing * speed * 0.35 * Math.random();
      p.vy = Math.sin(angle) * speed;
      p.gravity = 5.5;
      p.maxLife = 0.22 + Math.random() * 0.22;
      // Length varies far more than width, and the shortest are genuinely short.
    // Every spark being a similar 4:1 bar is what made the pool read as a
    // handful of sticks rather than as a burst; a real spark field is mostly
    // small and fast with a few long strays.
    p.mesh.scale.set(
      0.028 + Math.random() * Math.random() * 0.075,
      0.011 + Math.random() * 0.009,
      1,
    );
    }
    p.spin = Math.atan2(p.vy, p.vx);
    p.life = p.maxLife;
    p.mesh.position.set(x, y, 0.35);
    p.mesh.rotation.z = p.spin;
    p.mesh.visible = true;
  }

  /** Advance effects. Runs on wall time so the freeze frame still sparkles. */
  update(nowMs: number, dtMs: number): void {
    const dt = Math.min(dtMs, 50) / 1000;
    for (const pool of this.pools) {
      for (const p of pool) {
        if (!p.mesh.visible) continue;
        p.life -= dt;
        if (p.life <= 0) {
          p.mesh.visible = false;
          continue;
        }
        p.vy -= p.gravity * dt;
        p.mesh.position.x += p.vx * dt;
        p.mesh.position.y = Math.max(0.02, p.mesh.position.y + p.vy * dt);
        p.mesh.rotation.z = Math.atan2(p.vy, p.vx);
        const t = p.life / p.maxLife;
        p.mesh.material.opacity = Math.min(1, t * 1.6);
      }
    }

    for (const pool of this.burstPools) {
      for (const b of pool) {
        if (b.life <= 0) continue;
        b.life -= dt;
        if (b.life <= 0) {
          b.life = 0;
          b.mesh.visible = false;
          continue;
        }
        const t = 1 - b.life / b.maxLife;
        // Ease-out, so most of the growth happens in the first third of the
        // life. A linear expansion spends half the burst crawling at a size the
        // eye has already stopped reading.
        const grow = 1 - Math.pow(1 - t, 2.2);
        b.mesh.scale.setScalar(b.from + (b.to - b.from) * grow);
        // Fades on a curve that holds its brightness early and then drops away
        // fast, which is what keeps the contact frame from reading as a
        // half-opacity sticker sitting over the fighters.
        b.mesh.material.opacity = b.peak * Math.pow(1 - t, 1.7);
      }
    }

    for (let i = this.fighterFlashes.length - 1; i >= 0; i -= 1) {
      const f = this.fighterFlashes[i];
      if (f === undefined) continue;
      const span = f.until - f.start;
      const k = Math.max(0, 1 - (nowMs - f.start) / span);
      f.view.flash?.(f.peak * k);
      if (k <= 0) this.fighterFlashes.splice(i, 1);
    }

    this.punch *= Math.pow(0.0015, dt);
  }

  /**
   * How hard the frame should be pushed right now, 0..~0.14. The post stack
   * reads this to lift saturation and grain on impact, so the visual punch
   * decays on exactly the same curve as the camera punch-in — the hit and its
   * colour kick end together instead of one trailing the other.
   */
  impactPunch(): number {
    return this.punch;
  }

  /** Apply shake and punch-in on top of wherever the stage put the camera. */
  applyCamera(nowMs: number): void {
    if (this.punch > 0.001) {
      const pull = this.punch;
      this.camera.position.x += (this.punchTargetX - this.camera.position.x) * pull * 0.6;
      this.camera.position.z *= 1 - pull;
    }
    if (nowMs < this.shakeUntil) {
      const left = (this.shakeUntil - nowMs) / 260;
      const amp = this.shake * Math.min(1, left * 1.4);
      this.camera.position.x += (Math.random() * 2 - 1) * amp;
      this.camera.position.y += (Math.random() * 2 - 1) * amp * 0.7;
    }
  }
}

/**
 * One drawn hit sprite, hidden until a hit asks for it.
 *
 * `map` is left unset and attached when the texture resolves, so the material
 * is built once, up front, with its blending already decided — attaching a map
 * later is cheap, but rebuilding a material mid-fight is not. `alphaTest` is
 * deliberately left at 0: the stage scans for baked cutouts by
 * `map !== null && alphaTest > 0` in order to tint the fighters to the room
 * light, and a hit flash is not a cutout standing in the room. It must not be
 * dragged into that pass, or a hit would repaint the contact frame amber.
 */
function burstMesh(geometry: PlaneGeometry): Mesh<PlaneGeometry, MeshBasicMaterial> {
  const mesh = new Mesh(
    geometry,
    new MeshBasicMaterial({
      color: '#ffffff',
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: AdditiveBlending,
      toneMapped: true,
    }),
  );
  mesh.visible = false;
  return mesh;
}
