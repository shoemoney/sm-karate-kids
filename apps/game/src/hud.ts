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

  update(state: MatchState, nowMs: number): void {
    for (const index of [0, 1] as const) {
      const score = state.fighters[index].score;
      this.points[index]!.textContent = POINT_LABEL.get(score) ?? String(score);
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
    this.bannerUntil = nowMs + holdMs;
  }

  call(call: RefereeCall, scorerName: string, moveName: string, nowMs: number): void {
    const value = call.value === 'full' ? 'IPPON' : 'WAZA-ARI';
    this.say(`${value} — ${scorerName}`, call.value, nowMs, 1800);
    this.technique.textContent = `${moveName}${call.counter ? ' · counter' : ''}`;
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
