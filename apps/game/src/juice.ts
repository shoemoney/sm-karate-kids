import {
  AdditiveBlending,
  Color,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  type PerspectiveCamera,
  type Scene,
} from 'three/webgpu';

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

const POOL_SIZE = 64;
const SPARK = new Color('#fff1c9');
const SPARK_HOT = new Color('#ffb347');
const DUST = new Color('#c9a071');
const BLOCK = new Color('#9fd3ff');

export interface Flashable {
  flash?(amount: number): void;
}

export class Juice {
  private readonly particles: Particle[] = [];
  private cursor = 0;
  private hitstopUntil = 0;
  private slowmoUntil = 0;
  private shake = 0;
  private shakeUntil = 0;
  private punch = 0;
  private punchTargetX = 0;
  private readonly flashes: Array<{ view: Flashable; until: number; peak: number; start: number }> = [];
  private readonly screenFlash: HTMLDivElement;

  constructor(
    scene: Scene,
    private readonly camera: PerspectiveCamera,
    stageElement: HTMLElement,
    private readonly reducedMotion: () => boolean,
  ) {
    const geometry = new PlaneGeometry(1, 1);
    for (let i = 0; i < POOL_SIZE; i += 1) {
      const material = new MeshBasicMaterial({
        color: SPARK,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: AdditiveBlending,
      });
      const mesh = new Mesh(geometry, material);
      mesh.visible = false;
      mesh.renderOrder = 10;
      scene.add(mesh);
      this.particles.push({ mesh, vx: 0, vy: 0, life: 0, maxLife: 1, gravity: 0, spin: 0 });
    }

    this.screenFlash = document.createElement('div');
    this.screenFlash.className = 'impact-flash';
    stageElement.appendChild(this.screenFlash);
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

    if (!calm) {
      this.shake = kind === 'block' ? 0.04 : heavy ? 0.16 : 0.08;
      this.shakeUntil = nowMs + (heavy ? 260 : 170);
      this.punch = heavy ? 0.14 : kind === 'block' ? 0.03 : 0.07;
      this.punchTargetX = x;
      if (defender?.flash !== undefined && kind !== 'block') {
        this.flashes.push({ view: defender, start: nowMs, until: nowMs + (heavy ? 140 : 100), peak: heavy ? 1 : 0.7 });
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

  private emit(x: number, y: number, facing: 1 | -1, kind: ImpactKind, heavy: boolean): void {
    const p = this.particles[this.cursor];
    this.cursor = (this.cursor + 1) % this.particles.length;
    if (p === undefined) return;

    const material = p.mesh.material;
    const angle = (Math.random() - 0.5) * (kind === 'sweep' ? 1.1 : 2.4);
    const speed = (kind === 'sweep' ? 1.2 : 2.6) * (0.4 + Math.random()) * (heavy ? 1.35 : 1);

    if (kind === 'sweep') {
      material.color.copy(DUST);
      p.vx = facing * Math.cos(angle) * speed;
      p.vy = Math.abs(Math.sin(angle)) * speed * 0.7 + 0.4;
      p.gravity = 3.2;
      p.maxLife = 0.55 + Math.random() * 0.35;
      material.blending = 1; // NormalBlending: dust is matter, not light
      p.mesh.scale.setScalar(0.07 + Math.random() * 0.09);
    } else {
      material.color.copy(kind === 'block' ? BLOCK : Math.random() < 0.35 ? SPARK_HOT : SPARK);
      // Sparks spray back along the strike's line, the way splinters fly.
      p.vx = -facing * Math.cos(angle) * speed * 0.6 + facing * speed * 0.35 * Math.random();
      p.vy = Math.sin(angle) * speed;
      p.gravity = 5.5;
      p.maxLife = 0.22 + Math.random() * 0.22;
      material.blending = AdditiveBlending;
      p.mesh.scale.set(0.05 + Math.random() * 0.05, 0.012 + Math.random() * 0.012, 1);
    }
    material.needsUpdate = true;
    p.spin = Math.atan2(p.vy, p.vx);
    p.life = p.maxLife;
    p.mesh.position.set(x, y, 0.35);
    p.mesh.rotation.z = p.spin;
    p.mesh.visible = true;
  }

  /** Advance effects. Runs on wall time so the freeze frame still sparkles. */
  update(nowMs: number, dtMs: number): void {
    const dt = Math.min(dtMs, 50) / 1000;
    for (const p of this.particles) {
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

    for (let i = this.flashes.length - 1; i >= 0; i -= 1) {
      const f = this.flashes[i];
      if (f === undefined) continue;
      const span = f.until - f.start;
      const k = Math.max(0, 1 - (nowMs - f.start) / span);
      f.view.flash?.(f.peak * k);
      if (k <= 0) this.flashes.splice(i, 1);
    }

    this.punch *= Math.pow(0.0015, dt);
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
