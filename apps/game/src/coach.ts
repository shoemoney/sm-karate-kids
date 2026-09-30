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
  // The two horizontal directions were both labelled "step", while the technique
  // stick's are "back" and "forward". So the sheet taught a distinction the
  // coach did not make, and a player comparing the two could not tell which way
  // "step" went. `openai/gpt-6.1-sol` (via codex) put it as "both horizontal
  // STANCE hints say 'step', while the neighbouring TECHNIQUE hints distinguish
  // 'back' from 'forward'" — the same class as rounds 102-105, a decision made
  // in one surface and not the other. The words now match the sheet's legend:
  // retreating and lunging.
  { zone: 'zone-left', title: 'Stance', pairs: ['◀ back', '▲ jump', '▶ in', '▼ crouch'] },
  // The Moves sheet groups every technique under RIGHT STICK FORWARD / BACK /
  // UP / DOWN. The legend used to say reverse/forward/high/low for the same
  // four directions, so a player who learned the controls from the coach and
  // then opened the reference to look up a move was matching two vocabularies.
  // claude-opus-5.5 called it "the on-screen stick legend is ambiguous and
  // conflicts with the Moves list", and they are right — the sheet is what
  // people actually go and look things up in, so the coach follows it.
  { zone: 'zone-right', title: 'Technique', pairs: ['◀ back', '▶ forward', '▲ up', '▼ down'] },
];

export function createControlCoach(): ControlCoach {
  let shown = false;
  const touched = new Set<'left' | 'right'>();

  const clear = (): void => {
    for (const node of document.querySelectorAll('.coach-strip')) node.remove();
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
        placed += 1;
      }
      if (placed === 0) return;

      // One strip, not two. The lesson is about the pair — "this is the move
      // stick, that is the technique stick" is a relationship, and splitting it
      // across two rings made the player read it twice. It also keeps the rings
      // clear: a control being pressed should be showing the control.
      const strip = document.createElement('div');
      strip.className = 'coach-strip';
      strip.setAttribute('aria-hidden', 'true');
      for (const lesson of LESSONS) {
        const half = document.createElement('div');
        half.className = 'coach-half';
        const title = document.createElement('strong');
        title.textContent = lesson.title;
        const legend = document.createElement('span');
        legend.className = 'coach-legend';
        for (const pair of lesson.pairs) {
          const cell = document.createElement('i');
          cell.textContent = pair;
          legend.appendChild(cell);
        }
        half.append(title, legend);
        strip.appendChild(half);
      }
      const pad = document.getElementById('pad');
      if (pad === null) return;
      pad.appendChild(strip);

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
