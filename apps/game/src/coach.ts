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
  /**
   * Records that a stick was used. The marks retire once BOTH have been, not
   * on the first touch of either: a player who has learned to step but has
   * never seen the technique stick has not finished the lesson, and retiring
   * on the first input threw away half of it.
   */
  used(zone: 'left' | 'right'): void;
  /** Force-retires the marks, for a bout that ended or a sheet that opened. */
  dismiss(): void;
}

/**
 * The title on each mark is the control's own name, not a description of it.
 * The pad labels them STANCE and TECHNIQUE, the aria-labels say "Stance stick"
 * and "Technique stick", and the reference sheet is "Techniques" — the coach
 * was calling the right-hand one STRIKE, so the same control had three names
 * depending on where you met it. The legend below the title is where the
 * description lives, which is what the mark is for.
 */
const LESSONS: ReadonlyArray<{
  zone: string;
  title: string;
  pairs: readonly string[];
}> = [
  { zone: 'zone-left', title: 'Stance', pairs: ['◀ step', '▲ jump', '▶ step', '▼ crouch'] },
  { zone: 'zone-right', title: 'Technique', pairs: ['◀ reverse', '▶ forward', '▲ high', '▼ low'] },
];

export function createControlCoach(): ControlCoach {
  let shown = false;
  const touched = new Set<'left' | 'right'>();

  const clear = (): void => {
    for (const node of document.querySelectorAll('.coach-mark')) node.remove();
    document.body.classList.remove('coach-active');
    shown = false;
  };

  const retire = (): void => {
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
        // One element per direction. A single run of text let the browser break
        // between a glyph and its word — "▲" on one line, "high" on the next —
        // which is worse than overflow: the reader has to reassemble it. Each
        // pair is now its own grid cell and can never be split.
        const body = document.createElement('span');
        body.className = 'coach-legend';
        for (const pair of lesson.pairs) {
          const cell = document.createElement('i');
          cell.textContent = pair;
          body.appendChild(cell);
        }
        mark.append(title, body);
        zone.appendChild(mark);
        placed += 1;
      }
      if (placed === 0) return;
      shown = true;
      document.body.classList.add('coach-active');
    },

    used(zone: 'left' | 'right'): void {
      if (!shown) return;
      touched.add(zone);
      if (touched.size >= 2) retire();
    },

    dismiss: retire,
  };
}
