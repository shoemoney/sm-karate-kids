import { content } from '@smkk/content';
import {
  ARCHETYPES,
  CpuController,
  FixedClock,
  TOURNAMENT,
  checksumOf,
  emptyTally,
  roundArchetype,
  scoreBout,
  tallyCall,
  heightOf,
  createMatch,
  indexMoves,
  step,
  type InputFrame,
  type MatchEvent,
  type MatchState,
  type StickPair,
} from '@smkk/sim';
import { Audio } from './audio.js';
import type { FighterView } from './fighterView.js';
import { Hud } from './hud.js';
import { PlayerInput } from './input/index.js';
import { loadCareer, recordBoutResult, recordRun } from './persist.js';
import { createRenderer } from './renderer.js';
import { FighterRig, loadEmblem } from './rig.js';
import { SettingsStore, type Settings } from './settings.js';
import { tryLoadSpriteViews } from './spriteRig.js';
import { Stage } from './stage.js';
import { Juice } from './juice.js';

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

/** Adapts the existing 3D rig to `FighterView` without touching rig.ts. */
function wrapMeshRig(rig: FighterRig): FighterView {
  return {
    root: rig.root,
    apply: (fighter, elapsedTicks, renderX) => {
      rig.apply(fighter, elapsedTicks);
      if (renderX !== undefined) rig.root.position.x = renderX;
    },
    emblemInfo: () => {
      const map = rig.emblem.material.map;
      const image = map?.image as { width?: number; height?: number; src?: string } | undefined;
      return {
        bound: map !== null && map !== undefined,
        width: image?.width ?? 0,
        height: image?.height ?? 0,
        src: image?.src ?? '',
        visible: rig.emblem.visible,
      };
    },
  };
}

function makeOpponent(mode: string, seed: number): Opponent {
  if (mode === 'dojo') return new TrainingDummy();
  if (mode === 'tournament') return new CpuController(roundArchetype(TOURNAMENT[0]!), seed, 1);
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
  const mode = params.get('mode') ?? 'tournament';
  const seed = Number.parseInt(params.get('seed') ?? '1337', 10) || 1337;
  const forceWebGL = params.get('renderer') === 'webgl';
  // Dojo drill distance. Out of the dojo the ruleset owns the opening distance.
  const spacingParam = Number.parseFloat(params.get('spacing') ?? '');
  const startSeparation =
    mode === 'dojo' && Number.isFinite(spacingParam) ? spacingParam : undefined;

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

  let state = createMatch({ content, startSeparation });
  let opponent = makeOpponent(mode, seed);

  // The photoreal sprite fighters are the default. ?fighters=mesh selects the
  // procedural 3D rigs, which are also the fallback if the atlas fails to load.
  const wantSprite = params.get('fighters') !== 'mesh';
  const [{ renderer, label }, spriteViews] = await Promise.all([
    createRenderer(canvas, forceWebGL),
    wantSprite
      ? tryLoadSpriteViews(state.fighters.map((fighter) => fighter.spec), import.meta.env.BASE_URL)
      : Promise.resolve(null),
  ]);
  hud.setBackend(label);

  let fighterMode: 'sprite' | 'mesh';
  let views: readonly FighterView[];
  if (spriteViews !== null) {
    views = spriteViews;
    fighterMode = 'sprite';
  } else {
    if (wantSprite) {
      console.warn('[smkk] sprite fighters requested but unavailable; falling back to the 3D rig');
    }
    const emblem = await loadEmblem();
    views = state.fighters.map((fighter) => wrapMeshRig(new FighterRig(fighter.spec, emblem)));
    fighterMode = 'mesh';
  }

  const stage = new Stage(state.arena);
  for (const view of views) stage.scene.add(view.root);
  hud.setNames(state.fighters[0].spec.name, state.fighters[1].spec.name);

  const resize = (): void => {
    const width = stageEl.clientWidth;
    const height = stageEl.clientHeight;
    if (width === 0 || height === 0) return;
    renderer.setSize(width, height, false);
    stage.resize(width, height);
    stage.frame(0, state.separation, true);
  };
  new ResizeObserver(resize).observe(stageEl);
  resize();

  const unlock = (): void => audio.unlock();
  document.addEventListener('pointerdown', unlock, { once: true });
  document.addEventListener('keydown', unlock, { once: true });

  const juice = new Juice(stage.scene, stage.camera, stageEl, () =>
    document.body.classList.contains('reduced-motion'),
  );

  // The rules measure distance in tournament metres; the art is drawn at human
  // proportions, and a strike in the art reaches about half as far as the
  // simulation's reach (measured over all 18 strikes, median 0.50). Drawing the
  // gap between the fighters at that ratio makes a hit visibly land exactly
  // when the rules say it does — without touching the rules. The floor keeps a
  // clinch from drawing one fighter inside the other.
  const SPACING_SCALE = 0.5;
  const MIN_VISUAL_GAP = 0.55;
  const spacing = { mid: 0, k: SPACING_SCALE };
  const updateSpacing = (): void => {
    const [a, b] = state.fighters;
    spacing.mid = (a.x + b.x) / 2;
    const simGap = Math.abs(b.x - a.x);
    spacing.k = simGap < 1e-6 ? SPACING_SCALE : Math.max(MIN_VISUAL_GAP, simGap * SPACING_SCALE) / simGap;
  };
  const renderX = (x: number): number => spacing.mid + (x - spacing.mid) * spacing.k;

  // Where a technique actually lands: the strike point along the mat, at the
  // height band it targets, lifted by the attacker's jump if airborne.
  const BAND_HEIGHT = { low: 0.32, mid: 1.05, high: 1.5 } as const;
  const impactAt = (player: 0 | 1, moveId: string) => {
    const attacker = state.fighters[player];
    const move = state.moves.get(moveId);
    const reach = move?.reach ?? 1.5;
    updateSpacing();
    return {
      x: renderX(attacker.x + attacker.facing * reach * 0.92),
      y: BAND_HEIGHT[move?.height ?? 'mid'] + heightOf(attacker),
      facing: attacker.facing,
      low: move?.height === 'low',
    };
  };

  const moveName = (id: string): string => state.moves.get(id)?.name ?? id;

  const handle = (events: readonly MatchEvent[], nowMs: number): void => {
    for (const event of events) {
      if (event.type === 'move_start') {
        lastStarted = { player: event.player, moveId: event.moveId, tick: state.tick };
        if (event.player === 0) hud.showTechnique(moveName(event.moveId));
        audio.play('strike');
      } else if (event.type === 'contact') {
        const at = impactAt(event.player, event.moveId);
        juice.impact({
          x: at.x, y: at.y, facing: at.facing,
          kind: at.low ? 'sweep' : 'strike',
          value: event.value,
          defender: views[event.player === 0 ? 1 : 0] ?? null,
          nowMs,
        });
      } else if (event.type === 'blocked') {
        hud.say('BLOCKED', 'neutral', nowMs, 900);
        audio.play('block');
        const at = impactAt(event.player, event.moveId);
        juice.impact({ x: at.x, y: at.y, facing: at.facing, kind: 'block', value: 'none', defender: null, nowMs });
      } else if (event.type === 'simultaneous') {
        hud.say('AIUCHI', 'neutral', nowMs, 1200);
        audio.play('contact');
      } else if (event.type === 'call') {
        tallyCall(tally, event.call.scorer, event.call.value, event.call.counter);
        audio.play(event.call.value === 'full' ? 'ippon' : 'contact');
        if (state.fighters[event.call.scorer].score >= state.ruleset.pointsToWin) juice.matchPoint(nowMs);
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
        const record = recordBoutResult(winner === 0, winner === 0 ? state.tick : null);
        audio.play('bell');
        if (tournament) {
          finishTournamentBout(winner === 0, nowMs);
        } else {
          const [a, b] = state.fighters;
          const best = record.bestWinTicks === null ? '—' : `${(record.bestWinTicks / 60).toFixed(1)}s`;
          hud.showResult({
            headline: winner === null ? 'DRAW' : `${state.fighters[winner].spec.name} WINS`,
            tone: winner === null ? 'neutral' : 'full',
            score: `${points(a.score)} — ${points(b.score)}`,
            detail: `Bouts won ${record.boutsWon} / ${record.boutsPlayed} · best ${best}`,
            rematch: () => act(),
          });
          schedule(restart, REMATCH_AFTER_MS, nowMs);
        }
        audio.play('bell');
      }
    }
  };

  let lastStarted: { player: 0 | 1; moveId: string; tick: number } | null = null;
  const REMATCH_AFTER_MS = 8000;
  const ROUND_INTRO_MS = 4000;
  const points = (n: number): string => (Number.isInteger(n) ? String(n) : n === 0.5 ? '½' : `${Math.floor(n)}½`);

  // Every card ends in one pending action, fired by its button or by the
  // countdown, whichever comes first — never both.
  let pending: (() => void) | null = null;
  let pendingAt = 0;
  const schedule = (action: () => void, delayMs: number, nowMs: number): void => {
    pending = action;
    pendingAt = nowMs + delayMs;
  };
  const act = (): void => {
    const action = pending;
    pending = null;
    pendingAt = 0;
    action?.();
  };

  const clearBoutUi = (): void => {
    hud.clearCareer();
    hud.resetScores();
    hud.hideResult();
  };

  const restart = (): void => {
    state = createMatch({ content, startSeparation });
    opponent = makeOpponent(mode, seed);
    clearBoutUi();
  };

  // ---- The tournament: a run up the ladder, ended by the first loss. ----
  const tournament = mode === 'tournament';
  const run = { round: 0, score: 0 };
  let tally = emptyTally();
  // Held while a round card is up: the bout clock gets no time, so the fight
  // never starts behind the card.
  let held = false;

  const STYLE: Record<string, string> = {
    counter: 'Patient. He waits for your wind-up — then makes you pay.',
    sensei: 'Balanced. Reads the distance and picks his moment.',
    pressure: 'Relentless. Keeps stepping in and throwing.',
  };

  const beginBout = (): void => {
    held = false;
    hud.hideResult();
  };

  const startRound = (nowMs: number): void => {
    const round = TOURNAMENT[run.round]!;
    state = createMatch({ content, startSeparation });
    opponent = new CpuController(roundArchetype(round), seed + run.round * 101, 1);
    tally = emptyTally();
    clearBoutUi();
    held = true;
    hud.setRound(`Round ${run.round + 1}/${TOURNAMENT.length} · ${round.name}`);
    hud.showResult({
      kicker: `Round ${run.round + 1} of ${TOURNAMENT.length}`,
      headline: round.name,
      tone: 'full',
      score: `vs ${state.fighters[1].spec.name}`,
      detail: STYLE[round.archetype] ?? '',
      action: 'FIGHT',
      rematch: () => act(),
    });
    schedule(beginBout, ROUND_INTRO_MS, nowMs);
  };

  const newRun = (nowMs: number): void => {
    run.round = 0;
    run.score = 0;
    startRound(nowMs);
  };

  const finishTournamentBout = (won: boolean, nowMs: number): void => {
    const round = TOURNAMENT[run.round]!;
    const earned = scoreBout({ ...tally, ticksLeft: state.timerTicks, won }, round);
    run.score += earned;
    const last = run.round === TOURNAMENT.length - 1;

    if (won && !last) {
      const next = TOURNAMENT[run.round + 1]!;
      hud.showResult({
        kicker: `Round ${run.round + 1} cleared`,
        headline: `+${earned.toLocaleString()}`,
        tone: 'full',
        score: `Run ${run.score.toLocaleString()}`,
        detail: `Next: the ${next.name}`,
        action: 'NEXT ROUND',
        rematch: () => act(),
      });
      schedule(() => {
        run.round += 1;
        startRound(performance.now());
      }, REMATCH_AFTER_MS, nowMs);
      return;
    }

    const { record, newBest } = recordRun(run.score, run.round, won && last);
    hud.showResult({
      kicker: won ? 'Tournament complete' : `Out in the ${round.name}`,
      headline: won ? 'CHAMPION' : 'DEFEATED',
      tone: won ? 'full' : 'neutral',
      score: run.score.toLocaleString(),
      detail: newBest
        ? 'New best score'
        : `Best ${record.bestScore.toLocaleString()} · titles ${record.championships}`,
      action: 'NEW TOURNAMENT',
      rematch: () => act(),
    });
    schedule(() => newRun(performance.now()), REMATCH_AFTER_MS, nowMs);
  };

  const clock = new FixedClock();
  let previous = performance.now();
  let elapsedTicks = 0;

  let perfWindowStart = previous;
  let perfFrames = 0;
  let perfTicks = 0;

  const frame = (now: number): void => {
    const frameDt = now - previous;
    // Hit-stop and slow motion only change how much time the clock is given.
    // Every tick that runs is the same tick it would have been.
    const ticks = clock.drain(held ? 0 : frameDt * juice.timeScale(now));
    previous = now;

    for (let i = 0; i < ticks; i += 1) {
      const inputFrame: InputFrame = { p1: input.read(), p2: opponent.poll(state) };
      handle(step(state, inputFrame), now);
      elapsedTicks += 1;
    }

    // The result card waits for a tap, but an idle screen still rolls into
    // the next bout rather than sitting on it forever.
    if (pendingAt !== 0) hud.setRematchCountdown(Math.max(0, Math.ceil((pendingAt - now) / 1000)));
    if (pendingAt !== 0 && now > pendingAt) act();

    updateSpacing();
    for (const index of [0, 1] as const) {
      const fighter = state.fighters[index];
      views[index]!.apply(fighter, elapsedTicks, renderX(fighter.x));
      // Distinct depths so overlapping fighters never fight over the same
      // pixels; whoever is throwing a technique is the one drawn in front.
      const attacking = fighter.phase === 'startup' || fighter.phase === 'active';
      views[index]!.root.position.z = attacking ? 0.08 : index === 0 ? 0.02 : -0.02;
    }
    const [left, right] = state.fighters;
    stage.frame(spacing.mid, renderX(right.x) - renderX(left.x));
    juice.update(now, frameDt);
    juice.applyCamera(now);
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
  if (tournament) newRun(performance.now());
  else hud.setRound('');
  requestAnimationFrame(frame);

  // Test surface. Read-only: nothing here can score a point or move a fighter.
  Object.defineProperty(globalThis, '__smkk', {
    value: {
      ready: true,
      backend: label,
      mode,
      fighters: fighterMode,
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
        lastStarted,
        p1Phase: state.fighters[0].phase,
      }),
      checksum: () => checksumOf(state),
      tournament: () => ({
        active: tournament,
        round: run.round,
        roundId: TOURNAMENT[run.round]?.id ?? null,
        score: run.score,
        held,
      }),
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
      emblems: () => views.map((view) => view.emblemInfo()),
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
