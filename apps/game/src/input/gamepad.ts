import type { Dir4, StickPair } from '@smkk/sim';

const AXIS_THRESHOLD = 0.5;

function quantize(x: number | undefined, y: number | undefined): Dir4 {
  const ax = x ?? 0;
  const ay = y ?? 0;
  if (Math.abs(ax) < AXIS_THRESHOLD && Math.abs(ay) < AXIS_THRESHOLD) return 'neutral';
  if (Math.abs(ax) >= Math.abs(ay)) return ax < 0 ? 'left' : 'right';
  return ay < 0 ? 'up' : 'down';
}

/** Analog sticks quantized onto the same four-way gate the grammar expects. */
export class GamepadInput {
  read(): StickPair {
    const pads = typeof navigator === 'undefined' ? [] : (navigator.getGamepads?.() ?? []);
    for (const pad of pads) {
      if (pad === null || !pad.connected) continue;
      const left = quantize(pad.axes[0], pad.axes[1]);
      const right = quantize(pad.axes[2], pad.axes[3]);
      if (left !== 'neutral' || right !== 'neutral') return { left, right };
      const dpad = this.dpad(pad);
      if (dpad !== 'neutral') return { left: dpad, right: 'neutral' };
    }
    return { left: 'neutral', right: 'neutral' };
  }

  private dpad(pad: Gamepad): Dir4 {
    const pressed = (index: number): boolean => pad.buttons[index]?.pressed === true;
    if (pressed(12)) return 'up';
    if (pressed(13)) return 'down';
    if (pressed(14)) return 'left';
    if (pressed(15)) return 'right';
    return 'neutral';
  }
}
