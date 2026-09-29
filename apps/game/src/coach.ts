/**
 * First-run control coach.
 *
 * The sticks carried two glyph rings and a word under them, and the only place
 * the grammar was written down was the Techniques sheet — a screen a new player
 * has no reason to open before their first bout. This paints a one-time coach
 * mark over each stick on the first bout only, and it is deliberately
 * non-blocking: it never pauses the clock, never takes focus, and never traps
 * a tap. A player who ignores it loses nothing but the hint.
 */
import { loadValue, saveValue } from './persist';

const SEEN_KEY = 'coach-seen-v1';

const isTrue = (value: unknown): value is boolean => typeof value === 'boolean';

export interface ControlCoach {
  /** True when this is genuinely a first run and the marks should be shown. */
  shouldShow(): boolean;
  show(): void;
  /** Called on the first real stick input, which is the moment the hint has done its job. */
  dismiss(): void;
}

const LESSONS: ReadonlyArray<{
  zone: string;
  title: string;
  body: string;
}> = [
  { zone: 'zone-left', title: 'Move & jump', body: '◀ ▶ step · ▲ jump · ▼ crouch' },
  { zone: 'zone-right', title: 'Strike', body: '◀ reverse · ▲ high · ▼ low · ▶ forward' },
];

export function createControlCoach(): ControlCoach {
  let shown = false;

  const clear = (): void => {
    for (const node of document.querySelectorAll('.coach-mark')) node.remove();
    document.body.classList.remove('coach-active');
    shown = false;
  };

  const dismiss = (): void => {
    if (!shown) return;
    clear();
    saveValue(SEEN_KEY, true);
  };

  return {
    shouldShow: () => !loadValue(SEEN_KEY, isTrue, false),

    show(): void {
      if (shown || loadValue(SEEN_KEY, isTrue, false)) return;
      // Only ever on a real touch device. A desktop player has a keyboard and
      // the hint would be clutter, and the e2e suite runs desktop.
      if (!matchMedia('(hover: none) and (pointer: coarse)').matches) return;

      let placed = 0;
      for (const lesson of LESSONS) {
        const zone = document.getElementById(lesson.zone);
        if (zone === null) continue;
        const mark = document.createElement('div');
        mark.className = 'coach-mark';
        // Decorative, and the stick's own aria-label already names it.
        mark.setAttribute('aria-hidden', 'true');
        const title = document.createElement('strong');
        title.textContent = lesson.title;
        const body = document.createElement('span');
        body.textContent = lesson.body;
        mark.append(title, body);
        zone.appendChild(mark);
        placed += 1;
      }
      if (placed === 0) return;
      shown = true;
      document.body.classList.add('coach-active');
    },

    dismiss,
  };
}
