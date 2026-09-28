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
    this.banner.replaceChildren(word, who);
    this.banner.dataset['tone'] = call.value;
    this.banner.classList.add('show');
    Hud.replay(this.banner, 'slam');
    this.bannerUntil = nowMs + 1800;
    this.technique.textContent = `${moveName}${call.counter ? ' · counter' : ''}`;
  }

  /** A new bout starts clean. */
  resetScores(): void {
    this.lastScores = [0, 0];
  }

  showTechnique(name: string): void {
    this.technique.textContent = name;
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
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'result-rematch';
    button.textContent = 'REMATCH';
    button.addEventListener('click', opts.rematch, { once: true });
    this.resultButton = button;
    this.result.dataset['tone'] = opts.tone;
    this.result.replaceChildren(headline, score, detail, button);
    this.banner.classList.remove('show');
    this.result.classList.add('show');
    Hud.replay(this.result, 'slam');
    button.focus({ preventScroll: true });
  }

  setRematchCountdown(seconds: number): void {
    if (this.resultButton !== null) this.resultButton.textContent = `REMATCH · ${seconds}`;
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

        const combo = document.createElement('span');
        combo.className = 'tech-combo';
        combo.textContent = `${QUALIFIER_GLYPH[qualifier]} stance + ${FAMILY_GLYPH[family]} technique`;

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
