import { content } from '@smkk/content';
import {
  ARCHETYPES,
  CpuController,
  FixedClock,
  checksumOf,
  createMatch,
  indexMoves,
  step,
  type InputFrame,
  type MatchEvent,
  type MatchState,
  type StickPair,
} from '@smkk/sim';
import { Audio } from './audio.js';
import { Hud } from './hud.js';
import { PlayerInput } from './input/index.js';
import { loadCareer, recordBoutResult } from './persist.js';
import { createRenderer } from './renderer.js';
import { FighterRig, loadEmblem } from './rig.js';
import { SettingsStore, type Settings } from './settings.js';
import { Stage } from './stage.js';

function byId<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (node === null) throw new Error(`missing element #${id}`);
  return node as T;
}

const NEUTRAL: StickPair = { left: 'neutral', right: 'neutral' };

interface Opponent {
  poll(state: MatchState): StickPair;
}

/** The dojo partner holds stance and lets you work. It is a practice mode. */
class TrainingDummy implements Opponent {
  poll(): StickPair {
    return NEUTRAL;
  }
}

function query(): URLSearchParams {
  return new URLSearchParams(globalThis.location?.search ?? '');
}

function makeOpponent(mode: string, seed: number): Opponent {
  if (mode === 'dojo') return new TrainingDummy();
  const archetype = ARCHETYPES[mode === 'pressure' ? 'pressure' : mode === 'counter' ? 'counter' : 'sensei'];
  return new CpuController(archetype, seed, 1);
}

function updateCareerSummary(): void {
  const record = loadCareer();
  const best = record.bestWinTicks === null ? '—' : `${(record.bestWinTicks / 60).toFixed(1)}s`;
  byId<HTMLElement>('career-summary').textContent =
    `Career — played ${record.boutsPlayed} · won ${record.boutsWon} · best time ${best}`;
}

/** Slides a sheet open/closed, skipping the transition wait when motion is reduced. */
function toggleSheet(sheetEl: HTMLElement, open: boolean, reducedMotion: boolean): void {
  if (open) {
    sheetEl.hidden = false;
    requestAnimationFrame(() => sheetEl.classList.add('open'));
    return;
  }
  sheetEl.classList.remove('open');
  if (reducedMotion) {
    sheetEl.hidden = true;
    return;
  }
  const onEnd = (event: TransitionEvent): void => {
    if (event.propertyName !== 'transform') return;
    sheetEl.hidden = true;
    sheetEl.removeEventListener('transitionend', onEnd);
  };
  sheetEl.addEventListener('transitionend', onEnd);
}

/** Wires the settings sheet, technique reference, and every accessibility toggle to live DOM state. */
function bindSettingsUI(settings: SettingsStore, hud: Hud, audio: Audio): void {
  const body = document.body;
  const settingsSheet = byId<HTMLElement>('settings-sheet');
  const techSheet = byId<HTMLElement>('tech-ref');

  const checkboxes: Record<keyof Settings, HTMLInputElement> = {
    reducedMotion: byId('opt-reduced-motion'),
    highContrast: byId('opt-high-contrast'),
    largeControls: byId('opt-large-controls'),
    leftHanded: byId('opt-left-handed'),
    muted: byId('opt-muted'),
    showPerf: byId('opt-show-perf'),
  };

  for (const key of Object.keys(checkboxes) as Array<keyof Settings>) {
    checkboxes[key].addEventListener('change', () => {
      settings.set(key, checkboxes[key].checked);
    });
  }

  byId<HTMLButtonElement>('btn-settings').addEventListener('click', () => {
    updateCareerSummary();
    toggleSheet(settingsSheet, true, settings.get().reducedMotion);
  });
  byId<HTMLButtonElement>('settings-close').addEventListener('click', () => {
    toggleSheet(settingsSheet, false, settings.get().reducedMotion);
  });
  byId<HTMLButtonElement>('btn-techniques').addEventListener('click', () => {
    toggleSheet(techSheet, true, settings.get().reducedMotion);
  });
  byId<HTMLButtonElement>('tech-ref-close').addEventListener('click', () => {
    toggleSheet(techSheet, false, settings.get().reducedMotion);
  });

  settings.subscribe((value) => {
    checkboxes.reducedMotion.checked = value.reducedMotion;
    checkboxes.highContrast.checked = value.highContrast;
    checkboxes.largeControls.checked = value.largeControls;
    checkboxes.leftHanded.checked = value.leftHanded;
    checkboxes.muted.checked = value.muted;
    checkboxes.showPerf.checked = value.showPerf;

    body.classList.toggle('reduced-motion', value.reducedMotion);
    body.classList.toggle('high-contrast', value.highContrast);
    body.classList.toggle('large-controls', value.largeControls);
    body.classList.toggle('left-handed', value.leftHanded);

    audio.setMuted(value.muted);
    hud.setPerfVisible(value.showPerf);
  });
}

async function boot(): Promise<void> {
  const params = query();
  const mode = params.get('mode') ?? 'classic';
  const seed = Number.parseInt(params.get('seed') ?? '1337', 10) || 1337;
  const forceWebGL = params.get('renderer') === 'webgl';

  const canvas = document.getElementById('view') as HTMLCanvasElement | null;
  const stageEl = document.getElementById('stage');
  if (canvas === null || stageEl === null) throw new Error('missing canvas');

  const hud = new Hud();
  const audio = new Audio();
  const input = new PlayerInput();
  const settings = new SettingsStore();
  bindSettingsUI(settings, hud, audio);
  hud.renderTechniques(byId('tech-ref-list'), indexMoves(content));
  updateCareerSummary();

  const [{ renderer, label }, emblem] = await Promise.all([
    createRenderer(canvas, forceWebGL),
    loadEmblem(),
  ]);
  hud.setBackend(label);

  let state = createMatch({ content });
  let opponent = makeOpponent(mode, seed);

  const stage = new Stage(state.arena);
  const rigs = state.fighters.map((fighter) => new FighterRig(fighter.spec, emblem));
  for (const rig of rigs) stage.scene.add(rig.root);
  hud.setNames(state.fighters[0].spec.name, state.fighters[1].spec.name);

  const resize = (): void => {
    const width = stageEl.clientWidth;
    const height = stageEl.clientHeight;
    if (width === 0 || height === 0) return;
    renderer.setSize(width, height, false);
    stage.resize(width, height);
    stage.frame(0, state.ruleset.startSeparation, true);
  };
  new ResizeObserver(resize).observe(stageEl);
  resize();

  const unlock = (): void => audio.unlock();
  document.addEventListener('pointerdown', unlock, { once: true });
  document.addEventListener('keydown', unlock, { once: true });

  const moveName = (id: string): string => state.moves.get(id)?.name ?? id;

  const handle = (events: readonly MatchEvent[], nowMs: number): void => {
    for (const event of events) {
      if (event.type === 'move_start') {
        if (event.player === 0) hud.showTechnique(moveName(event.moveId));
        audio.play('strike');
      } else if (event.type === 'blocked') {
        hud.say('BLOCKED', 'neutral', nowMs, 900);
        audio.play('contact');
      } else if (event.type === 'simultaneous') {
        hud.say('AIUCHI', 'neutral', nowMs, 1200);
        audio.play('contact');
      } else if (event.type === 'call') {
        audio.play(event.call.value === 'full' ? 'ippon' : 'contact');
        hud.call(
          event.call,
          state.fighters[event.call.scorer].spec.name,
          moveName(event.call.moveId),
          nowMs,
        );
      } else if (event.type === 'timeout') {
        audio.play('bell');
      } else if (event.type === 'match_over') {
        const winner = event.winner;
        hud.say(
          winner === null ? 'DRAW' : `${state.fighters[winner].spec.name} WINS`,
          winner === null ? 'neutral' : 'full',
          nowMs,
          4000,
        );
        const record = recordBoutResult(winner === 0, winner === 0 ? state.tick : null);
        hud.showCareer(record);
        audio.play('bell');
      }
    }
  };

  let restartAt = 0;
  const restart = (): void => {
    state = createMatch({ content });
    opponent = makeOpponent(mode, seed);
    restartAt = 0;
    hud.clearCareer();
  };

  const clock = new FixedClock();
  let previous = performance.now();
  let elapsedTicks = 0;

  let perfWindowStart = previous;
  let perfFrames = 0;
  let perfTicks = 0;

  const frame = (now: number): void => {
    const ticks = clock.drain(now - previous);
    previous = now;

    for (let i = 0; i < ticks; i += 1) {
      const inputFrame: InputFrame = { p1: input.read(), p2: opponent.poll(state) };
      handle(step(state, inputFrame), now);
      elapsedTicks += 1;
    }

    if (state.phase === 'over' && restartAt === 0) restartAt = now + 4200;
    if (restartAt !== 0 && now > restartAt) restart();

    for (const index of [0, 1] as const) rigs[index]!.apply(state.fighters[index], elapsedTicks);
    const [left, right] = state.fighters;
    stage.frame((left.x + right.x) / 2, right.x - left.x);
    hud.update(state, now);
    renderer.render(stage.scene, stage.camera);

    perfFrames += 1;
    perfTicks += ticks;
    const perfElapsed = now - perfWindowStart;
    if (perfElapsed >= 500) {
      const seconds = perfElapsed / 1000;
      hud.updatePerf(perfFrames / seconds, perfTicks / seconds, label, renderer.info.render.calls);
      perfFrames = 0;
      perfTicks = 0;
      perfWindowStart = now;
    }

    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  // Test surface. Read-only: nothing here can score a point or move a fighter.
  Object.defineProperty(globalThis, '__smkk', {
    value: {
      ready: true,
      backend: label,
      mode,
      state: () => ({
        tick: state.tick,
        phase: state.phase,
        timerTicks: state.timerTicks,
        scores: [state.fighters[0].score, state.fighters[1].score] as [number, number],
        positions: [state.fighters[0].x, state.fighters[1].x] as [number, number],
        winner: state.winner,
        draw: state.draw,
        lastCall: state.lastCall,
        p1Move: state.fighters[0].move?.id ?? null,
        p1Phase: state.fighters[0].phase,
      }),
      checksum: () => checksumOf(state),
      /**
       * Runs a fresh seeded bout to a tick count with no wall clock involved,
       * then reports the fingerprint. Two renderer backends must agree here:
       * the simulation is not allowed to notice which one is drawing.
       */
      bench: (ticks: number, benchSeed: number) => {
        const probe = createMatch({ content });
        const driver = new CpuController(ARCHETYPES.sensei, benchSeed, 0);
        const foil = new CpuController(ARCHETYPES.pressure, benchSeed + 7, 1);
        for (let i = 0; i < ticks && probe.phase !== 'over'; i += 1) {
          step(probe, { p1: driver.poll(probe), p2: foil.poll(probe) });
        }
        return {
          checksum: checksumOf(probe),
          tick: probe.tick,
          phase: probe.phase,
          scores: [probe.fighters[0].score, probe.fighters[1].score] as [number, number],
        };
      },
      sticks: () => input.read(),
      emblems: () =>
        rigs.map((rig) => {
          const map = rig.emblem.material.map;
          const image = map?.image as { width?: number; height?: number; src?: string } | undefined;
          return {
            bound: map !== null && map !== undefined,
            width: image?.width ?? 0,
            height: image?.height ?? 0,
            src: image?.src ?? '',
            visible: rig.emblem.visible,
          };
        }),
    },
    writable: false,
    configurable: true,
  });
}

void boot().catch((error: unknown) => {
  const banner = document.getElementById('banner');
  if (banner !== null) {
    banner.textContent = 'FAILED TO START';
    banner.dataset['tone'] = 'neutral';
    banner.classList.add('show');
  }
  console.error(error);
});
