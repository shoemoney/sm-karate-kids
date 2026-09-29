import { moveIdFor, type AttackFamily, type MatchState, type MoveSpec, type Qualifier, type RefereeCall } from '@smkk/sim';
import type { CareerRecord } from './persist.js';

function el(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (node === null) throw new Error(`missing hud element #${id}`);
  return node;
}

const FAMILY_GLYPH: Record<AttackFamily, string> = {
  forward: '▶',
  back: '◀',
  up: '▲',
  down: '▼',
};

const FAMILY_LABEL: Record<AttackFamily, string> = {
  forward: 'Right stick forward',
  back: 'Right stick back',
  up: 'Right stick up',
  down: 'Right stick down',
};

const QUALIFIER_GLYPH: Record<Qualifier, string> = {
  neutral: '•',
  up: '▲',
  down: '▼',
  forward: '▶',
  back: '◀',
};

const FAMILIES: readonly AttackFamily[] = ['forward', 'back', 'up', 'down'];
const QUALIFIERS: readonly Qualifier[] = ['neutral', 'up', 'down', 'forward', 'back'];

const POINT_LABEL = new Map<number, string>([
  [0, '0'],
  [0.5, '½'],
  [1, '1'],
  [1.5, '1½'],
  [2, '2'],
  [2.5, '2½'],
  [3, '3'],
]);

export class Hud {
  private readonly points = [el('points-0'), el('points-1')];
  private readonly names = [el('name-0'), el('name-1')];
  private readonly timer = el('timer');
  private readonly backend = el('backend');
  private readonly banner = el('banner');
  private readonly bannerSub = el('banner-sub');
  private readonly technique = el('technique');
  private readonly perf = el('perf-hud');
  private bannerUntil = 0;
  private techniqueUntil = 0;
  /**
   * How long a move name stays up. Long enough to confirm the input registered
   * and to be read mid-motion, short enough that it is gone well before the
   * fighter returns to their guard.
   *
   * It used to have no expiry at all. `showTechnique` set the text and nothing
   * ever cleared it, so the last move you threw sat on screen for the rest of
   * the bout — which reads as a state readout, not a confirmation, and makes
   * the *next* strike indistinguishable from a stale label. Two reviewers
   * independently reported the banner being up "while the fighter is still in
   * the untouched idle stance", which is exactly right: they were seeing a
   * label left over from a move that had already finished.
   */
  private static readonly TECHNIQUE_HOLD_MS = 700;

  setNames(a: string, b: string): void {
    this.names[0]!.textContent = a;
    this.names[1]!.textContent = b;
  }

  setBackend(label: string): void {
    this.backend.textContent = label;
  }

  private lastScores: [number, number] = [0, 0];

  /** Restart a one-shot CSS animation even if it is already mid-flight. */
  private static replay(el: HTMLElement, className: string): void {
    el.classList.remove(className);
    void el.offsetWidth;
    el.classList.add(className);
  }

  update(state: MatchState, nowMs: number): void {
    for (const index of [0, 1] as const) {
      const score = state.fighters[index].score;
      const el = this.points[index]!;
      el.textContent = POINT_LABEL.get(score) ?? String(score);
      if (score > this.lastScores[index]) Hud.replay(el, 'pop');
      this.lastScores[index] = score;
    }
    this.timer.textContent = String(Math.ceil(state.timerTicks / 60));

    if (this.bannerUntil !== 0 && nowMs > this.bannerUntil) {
      this.banner.classList.remove('show');
      this.bannerUntil = 0;
    }

    if (this.techniqueUntil !== 0 && nowMs > this.techniqueUntil) {
      this.technique.textContent = '';
      this.techniqueUntil = 0;
    }
  }

  say(text: string, tone: 'full' | 'half' | 'neutral', nowMs: number, holdMs = 1500): void {
    this.banner.textContent = text;
    this.banner.dataset['tone'] = tone;
    this.banner.classList.add('show');
    Hud.replay(this.banner, 'slam');
    this.bannerUntil = nowMs + holdMs;
  }

  /** The referee's call is the payoff, so it lands as a stamp, not a caption. */
  call(call: RefereeCall, scorerName: string, moveName: string, nowMs: number): void {
    const word = document.createElement('span');
    word.className = 'call-word';
    word.textContent = call.value === 'full' ? 'IPPON' : 'WAZA-ARI';
    const who = document.createElement('span');
    who.className = 'call-name';
    who.textContent = scorerName;
    // The move that scored goes INSIDE the stamp. It used to be written to the
    // separate technique pill, which sits at 25% of the stage while this stamp
    // spans 18%–31% — the pill landed entirely inside the stamp, 25px of
    // overlap, with two competing plates over the fighters' heads. Three
    // unrelated reviewers reported the IPPON callout as unreadable and
    // colliding with the move name, and all three were right.
    //
    // A scored point is one statement, so it is now one element. The pill is
    // the mid-move confirmation; the stamp is the payoff, and it keeps its
    // own copy of the move name rather than borrowing the pill's.
    const how = document.createElement('span');
    how.className = 'call-move';
    how.textContent = moveName;
    this.banner.replaceChildren(word, who, how);
    this.banner.dataset['tone'] = call.value;
    this.banner.classList.add('show');
    Hud.replay(this.banner, 'slam');
    this.bannerUntil = nowMs + 1800;
    // Clear the mid-move pill outright: the stamp now carries the move name,
    // and leaving the pill up put two plates in the same band of screen.
    this.clearTechnique();
  }

  /** A new bout starts clean. */
  resetScores(): void {
    this.lastScores = [0, 0];
  }

  showTechnique(name: string, nowMs: number): void {
    this.technique.textContent = name;
    this.techniqueUntil = nowMs + Hud.TECHNIQUE_HOLD_MS;
  }

  /** A new bout starts with no move name left over from the last one. */
  clearTechnique(): void {
    this.technique.textContent = '';
    this.techniqueUntil = 0;
  }

  /** Unobtrusive career line shown alongside the match-over banner. */
  showCareer(record: CareerRecord): void {
    const best = record.bestWinTicks === null ? '—' : `${(record.bestWinTicks / 60).toFixed(1)}s`;
    this.bannerSub.textContent = `Bouts won ${record.boutsWon} / ${record.boutsPlayed} · best ${best}`;
  }

  clearCareer(): void {
    this.bannerSub.textContent = '';
  }

  private result: HTMLElement | null = null;
  private resultButton: HTMLButtonElement | null = null;

  /**
   * The bout is over: a card you choose to leave, not a banner that times out
   * under you. `rematch` fires on the button; the countdown label is updated
   * by the caller so the game loop stays the only clock.
   */
  showResult(opts: {
    headline: string;
    tone: 'full' | 'neutral';
    score: string;
    detail: string;
    rematch: () => void;
    /** The button's label. Defaults to REMATCH. */
    action?: string;
    /** A small line above the headline, e.g. the round. */
    kicker?: string;
    /**
     * Pre-fight round card or post-fight result. They share a class but want
     * opposite vertical rhythms: the result is the payoff and can own the
     * frame, while the round card is a doorway the player is waiting to walk
     * through, and at full size it pushed the fighters off the screen.
     */
    phase?: 'prefight' | 'result';
  }): void {
    if (this.result === null) {
      const stage = document.getElementById('stage');
      if (stage === null) return;
      this.result = document.createElement('div');
      this.result.className = 'result';
      this.result.setAttribute('role', 'dialog');
      this.result.setAttribute('aria-label', 'Bout result');
      stage.appendChild(this.result);
    }
    const headline = document.createElement('div');
    headline.className = 'result-headline';
    headline.textContent = opts.headline;
    const score = document.createElement('div');
    score.className = 'result-score';
    score.textContent = opts.score;
    const detail = document.createElement('div');
    detail.className = 'result-detail';
    detail.textContent = opts.detail;
    const kicker = document.createElement('div');
    kicker.className = 'result-kicker';
    kicker.textContent = opts.kicker ?? '';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'result-rematch';
    this.resultAction = opts.action ?? 'REMATCH';
    button.textContent = this.resultAction;
    button.addEventListener('click', opts.rematch, { once: true });
    this.resultButton = button;
    this.result.dataset['tone'] = opts.tone;
    this.result.dataset['phase'] = opts.phase ?? 'result';
    this.result.replaceChildren(kicker, headline, score, detail, button);
    this.banner.classList.remove('show');
    this.result.classList.add('show');
    Hud.replay(this.result, 'slam');
    // Never pull focus away from someone typing.
    const active = document.activeElement;
    const typing = active instanceof HTMLElement && (active.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName));
    if (!typing) button.focus({ preventScroll: true });
  }

  private resultAction = 'REMATCH';

  setRematchCountdown(seconds: number): void {
    if (this.resultButton === null) return;
    // Zero means no countdown is running: show the plain label.
    if (seconds <= 0) {
      this.resultButton.textContent = this.resultAction;
      this.resultButton.setAttribute('aria-label', this.resultAction);
      return;
    }
    // "FIGHT · 3" put a bare number on a gold pill next to a score, and a bare
    // number on that surface reads as a point total. The verb is the label and
    // the number is a clock, so the clock gets its own mark and the two are
    // marked apart for anything reading it aloud or navigating by voice.
    this.resultButton.textContent = this.resultAction;
    const clock = document.createElement('span');
    clock.className = 'result-count';
    clock.setAttribute('aria-hidden', 'true');
    clock.textContent = String(seconds);
    this.resultButton.appendChild(clock);
    this.resultButton.setAttribute(
      'aria-label',
      `${this.resultAction}, starting in ${seconds} second${seconds === 1 ? '' : 's'}`,
    );
  }

  private roundTag: HTMLElement | null = null;

  /** The ladder position, shown under the clock during a tournament. */
  setRound(label: string): void {
    if (this.roundTag === null) {
      // Its own row under the scoreline: inside the clock column it widened
      // that column and squeezed both fighters' names to an ellipsis.
      const hud = document.getElementById('hud');
      if (hud === null) return;
      this.roundTag = document.createElement('div');
      this.roundTag.className = 'round-tag';
      hud.appendChild(this.roundTag);
    }
    this.roundTag.textContent = label;
    this.roundTag.hidden = label === '';
  }

  /**
   * Offer a name for the leaderboard inside the result card, above its main
   * button. `submit` resolves to the line to show afterwards.
   */
  offerNameEntry(opts: { initial: string; prompt: string; submit: (name: string) => Promise<string> }): void {
    if (this.result === null) return;
    const form = document.createElement('form');
    form.className = 'result-entry';
    const label = document.createElement('label');
    label.className = 'result-entry-label';
    label.textContent = opts.prompt;
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 24;
    input.required = true;
    input.setAttribute('autocomplete', 'nickname');
    input.enterKeyHint = 'done';
    input.value = opts.initial;
    input.placeholder = 'Your name';
    label.appendChild(input);
    const send = document.createElement('button');
    send.type = 'submit';
    send.className = 'result-entry-send';
    send.textContent = 'SUBMIT';
    const status = document.createElement('div');
    status.className = 'result-entry-status';
    status.setAttribute('aria-live', 'polite');
    form.append(label, send, status);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const name = input.value.trim();
      if (name === '') return;
      input.disabled = true;
      send.disabled = true;
      status.textContent = 'Saving…';
      void opts.submit(name).then((message) => {
        status.textContent = message;
        send.hidden = true;
      });
    });
    this.result.insertBefore(form, this.resultButton);
    // The player earned this: put the cursor where the name goes.
    input.focus({ preventScroll: true });
  }

  hideResult(): void {
    this.result?.classList.remove('show');
    this.resultButton = null;
  }

  setPerfVisible(visible: boolean): void {
    this.perf.hidden = !visible;
  }

  updatePerf(fps: number, ticksPerSecond: number, backend: string, drawCalls: number): void {
    this.perf.textContent = `FPS  ${fps.toFixed(0)}\nTPS  ${ticksPerSecond.toFixed(0)}\nGPU  ${backend}\nDRAW ${drawCalls}`;
  }

  /** Builds the technique reference list straight from content — no second copy of the move list. */
  renderTechniques(container: HTMLElement, moves: ReadonlyMap<string, MoveSpec>): void {
    container.replaceChildren();
    for (const family of FAMILIES) {
      const group = document.createElement('section');
      group.className = 'tech-group';

      const heading = document.createElement('h3');
      heading.textContent = `${FAMILY_GLYPH[family]} ${FAMILY_LABEL[family]}`;
      group.appendChild(heading);

      const list = document.createElement('ul');
      list.className = 'tech-list';

      for (const qualifier of QUALIFIERS) {
        const move = moves.get(moveIdFor(family, qualifier));
        if (move === undefined) continue;

        const item = document.createElement('li');
        item.className = 'tech-item';

        // The combo used to be spelled out in full — "• stance + ► technique" —
        // on every one of the twenty rows, which spent about 40% of a phone's
        // width restating the same two words and squeezed the move names until
        // "Crouching Punch" and "Somersault Kick" wrapped. The group heading
        // above already says which technique direction the rows belong to, so
        // the row only needs to say which STICK and which DIRECTION: two lit
        // glyphs. The spelled-out form is kept for assistive tech, where the
        // compact version would be cryptic.
        const combo = document.createElement('span');
        combo.className = 'tech-combo';
        const spoken = `${QUALIFIER_GLYPH[qualifier]} stance plus ${FAMILY_GLYPH[family]} technique`;
        combo.setAttribute('aria-label', spoken);
        combo.setAttribute('role', 'img');
        for (const glyph of [QUALIFIER_GLYPH[qualifier], FAMILY_GLYPH[family]]) {
          const pip = document.createElement('span');
          pip.className = 'tech-pip';
          pip.setAttribute('aria-hidden', 'true');
          pip.textContent = glyph;
          combo.appendChild(pip);
        }
        const plus = document.createElement('span');
        plus.className = 'tech-plus';
        plus.setAttribute('aria-hidden', 'true');
        plus.textContent = '+';
        combo.appendChild(plus);

        const name = document.createElement('span');
        name.className = 'tech-name';
        name.textContent = move.name;

        const meta = document.createElement('span');
        meta.className = 'tech-meta';
        meta.textContent = `${move.height} · ${move.value === 'full' ? 'Full point' : 'Half point'}`;

        item.append(combo, name, meta);
        list.appendChild(item);
      }

      group.appendChild(list);
      container.appendChild(group);
    }
  }
}
