import type { Dir4, StickPair } from '@smkk/sim';
import { DEFAULT_GATE, resolveDirection } from './stick.js';

interface StickBinding {
  readonly zone: HTMLElement;
  readonly face: HTMLElement;
  readonly knob: HTMLElement;
  pointerId: number | null;
  originX: number;
  originY: number;
  dir: Dir4;
}

const KNOB_TRAVEL = 34;

function bind(zoneId: string, stickId: string): StickBinding {
  const zone = document.getElementById(zoneId);
  const face = document.getElementById(stickId);
  const knob = face?.querySelector<HTMLElement>('.knob') ?? null;
  if (zone === null || face === null || knob === null) {
    throw new Error(`missing control elements for ${zoneId}`);
  }
  return { zone, face, knob, pointerId: null, originX: 0, originY: 0, dir: 'neutral' };
}

/**
 * Twin virtual sticks. Each one floats: it re-centres wherever the thumb lands,
 * so the player never has to look down to find it.
 */
export class TouchInput {
  private readonly left = bind('zone-left', 'stick-left');
  private readonly right = bind('zone-right', 'stick-right');
  private readonly cleanup: Array<() => void> = [];
  /** True once any real pointer has driven the pad. */
  active = false;

  constructor() {
    for (const stick of [this.left, this.right]) this.attach(stick);
  }

  private attach(stick: StickBinding): void {
    const down = (event: PointerEvent): void => {
      if (stick.pointerId !== null) return;
      stick.pointerId = event.pointerId;
      stick.originX = event.clientX;
      stick.originY = event.clientY;
      stick.zone.setPointerCapture(event.pointerId);
      stick.zone.classList.add('engaged');
      this.active = true;
      event.preventDefault();
    };

    const move = (event: PointerEvent): void => {
      if (stick.pointerId !== event.pointerId) return;
      const dx = event.clientX - stick.originX;
      const dy = event.clientY - stick.originY;
      stick.dir = resolveDirection(dx, dy, stick.dir, DEFAULT_GATE);
      this.paint(stick, dx, dy);
      event.preventDefault();
    };

    const up = (event: PointerEvent): void => {
      if (stick.pointerId !== event.pointerId) return;
      if (stick.zone.hasPointerCapture(event.pointerId)) {
        stick.zone.releasePointerCapture(event.pointerId);
      }
      stick.pointerId = null;
      stick.dir = 'neutral';
      stick.zone.classList.remove('engaged');
      this.paint(stick, 0, 0);
      event.preventDefault();
    };

    stick.zone.addEventListener('pointerdown', down);
    stick.zone.addEventListener('pointermove', move);
    stick.zone.addEventListener('pointerup', up);
    stick.zone.addEventListener('pointercancel', up);
    this.cleanup.push(() => {
      stick.zone.removeEventListener('pointerdown', down);
      stick.zone.removeEventListener('pointermove', move);
      stick.zone.removeEventListener('pointerup', up);
      stick.zone.removeEventListener('pointercancel', up);
    });
  }

  private paint(stick: StickBinding, dx: number, dy: number): void {
    const distance = Math.hypot(dx, dy);
    const scale = distance > KNOB_TRAVEL ? KNOB_TRAVEL / distance : 1;
    stick.knob.style.transform = `translate3d(${(dx * scale).toFixed(1)}px, ${(dy * scale).toFixed(1)}px, 0)`;
    if (stick.dir === 'neutral') stick.face.removeAttribute('data-dir');
    else stick.face.setAttribute('data-dir', stick.dir);
  }

  read(): StickPair {
    return { left: this.left.dir, right: this.right.dir };
  }

  dispose(): void {
    for (const off of this.cleanup) off();
  }
}
