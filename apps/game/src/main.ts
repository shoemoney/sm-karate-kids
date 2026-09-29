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
  beginMove,
  createFighter,
  createMatch,
  indexMoves,
  step,
  type InputFrame,
  type MatchEvent,
  type MatchState,
  type StickPair,
} from '@smkk/sim';
import { Audio } from './audio.js';
import { mountBootScreen, type BootScreen } from './bootScreen.js';
import type { FighterView } from './fighterView.js';
import { Hud } from './hud.js';
import { PlayerInput } from './input/index.js';
import { loadCareer, loadPlayerName, recordBoutResult, recordRun, savePlayerName } from './persist.js';
import { Leaderboard } from './leaderboard.js';
import { createRenderer } from './renderer.js';
import { createPostStack } from './post.js';
import { FighterRig, loadEmblem } from './rig.js';
import { SettingsStore, type Settings } from './settings.js';
import { tryLoadSpriteViews } from './spriteRig.js';
import { Stage } from './stage.js';
import { Juice } from './juice.js';
import { createControlCoach } from './coach.js';

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
    // The renderer badge is a diagnostic, and the performance HUD already
    // prints the backend inside it. Shipping it unconditionally put "WEBGPU" in
    // the corner of every screen for a player who cannot act on it, so it now
    // rides the setting that means "I am looking at diagnostics".
    body.classList.toggle('show-perf', value.showPerf);

    audio.setMuted(value.muted);
    hud.setPerfVisible(value.showPerf);
  });
}

async function boot(screen: BootScreen): Promise<void> {
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

  // The round/result card's painted backdrop. Set as a token rather than written
  // into styles.css because the stylesheet cannot know the app's base URL, and
  // this build ships with `base: './'` — a literal `/generated/...` in CSS
  // breaks the moment the bundle is served from a subdirectory, which is
  // exactly what the arcade does. `body.high-contrast` overrides the token back
  // to `none`, so the art never survives into contrast mode.
  document.documentElement.style.setProperty(
    '--card-plate',
    `url("${import.meta.env.BASE_URL}generated/title-backdrop.webp")`,
  );

  let state = createMatch({ content, startSeparation });
  let opponent = makeOpponent(mode, seed);

  // The photoreal sprite fighters are the default. ?fighters=mesh selects the
  // procedural 3D rigs, which are also the fallback if the atlas fails to load.
  const wantSprite = params.get('fighters') !== 'mesh';
  // The atlas arrives a page at a time, and each page that lands moves the bar.
  // The whole 2.3 MB as one lump would leave the card sitting still for the
  // longest part of the wait and then jumping, which is the shape a progress
  // bar has when it is not measuring anything.
  const onAtlasPage = (done: number, total: number): void => {
    if (total === 0) return;
    screen.advance('fighters', done / total, `Lacing the fighters — ${done}/${total} pages`);
  };
  const [{ renderer, label }, spriteViews] = await Promise.all([
    createRenderer(canvas, forceWebGL),
    wantSprite
      ? tryLoadSpriteViews(
          state.fighters.map((fighter) => fighter.spec),
          import.meta.env.BASE_URL,
          onAtlasPage,
        )
      : Promise.resolve(null),
  ]);
  // Counted whole, whether or not the atlas actually loaded: a mesh fallback
  // has finished the same work by a different route, and the bar must not be
  // left short of the truth either way.
  screen.advance('renderer');
  screen.advance('fighters', 1, 'Lacing the fighters');
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

  const stage = new Stage(state.arena, import.meta.env.BASE_URL);
  for (const view of views) stage.scene.add(view.root);
  hud.setNames(state.fighters[0].spec.name, state.fighters[1].spec.name);
  const coach = createControlCoach();
  // The stance stick has no simulation event of its own — moving is not a move —
  // so the coach learns about it from the input layer instead.
  input.touch.onEngage = (side) => coach.used(side);
  let coachOffered = false;

  // The last real transfer. Waiting for it here is what lets the pre-boot card
  // show an honest bar, and what stops the dojo changing its clothes in front
  // of the player the instant that card lifts.
  await stage.ready;
  screen.advance('dojo');

  // Bloom, grade, grain and vignette. This runs on the same node system under
  // both backends — `forceWebGL` selects the identical WebGL2 backend the
  // automatic WebGPU fallback uses — so there is exactly one render path and no
  // capability branch to keep in sync.
  const post = createPostStack(renderer, stage.scene, stage.camera);

  const resize = (): void => {
    const width = stageEl.clientWidth;
    const height = stageEl.clientHeight;
    if (width === 0 || height === 0) return;
    renderer.setSize(width, height, false);
    stage.resize(width, height);
    // PassNode re-reads the drawing buffer size every frame, so this is belt
    // and braces rather than the mechanism — but an explicit size keeps the
    // first frame after a rotation from allocating a stale target.
    post.resize(width, height);
    stage.frame(0, state.separation, true);
  };
  new ResizeObserver(resize).observe(stageEl);
  resize();

  const unlock = (): void => audio.unlock();
  document.addEventListener('pointerdown', unlock, { once: true });
  document.addEventListener('keydown', unlock, { once: true });

  const juice = new Juice(stage.scene, stage.camera, stageEl, () =>
    document.body.classList.contains('reduced-motion'), import.meta.env.BASE_URL);

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
        if (event.player === 0) {
          hud.showTechnique(moveName(event.moveId), nowMs);
          // The technique stick has been used. The marks retire once both
          // sticks have been, not on the first technique.
          coach.used('right');
        }
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
          // The lesson belongs to a live bout. See clearBoutUi.
        coach.dismiss();
        // The lesson belongs to a live bout. See clearBoutUi.
    coach.dismiss();
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
  /**
   * A score, for anywhere outside the HUD.
   *
   * The in-match score is `points()` — a half point is `2½`. The result card,
   * the run total and the career best were all `toLocaleString()`, which renders
   * the same value as `2.5`. So the product showed one notation for the whole
   * bout and a different one the moment the bout ended, and `2.5` is a decimal
   * that reads ambiguously at a glance — two-and-a-half, or a tally of two
   * and a bit?
   *
   * Six models across six rounds reported it without agreement on why: "cluttered
   * fraction notation", "hard to parse quickly", "unclear half-point fraction
   * with no explanation", "typographic clash", "hard to read". They were all
   * looking at the result screen and all describing the same thing, which is the
   * one place a score is shown in a notation the player has never seen before.
   *
   * Thousands separators are kept, so a four-figure career total still reads as
   * one.
   */
  const formatScore = (n: number): string => {
    if (n === 0.5) return '½'; // matches points(): half a point is not "0½"
    const whole = Math.floor(n);
    const grouped = whole.toLocaleString();
    return n === whole ? grouped : `${grouped}½`;
  };

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
    hud.clearTechnique();
    // The first-run coach is an in-bout aid. It used to survive the end of the
    // bout, so the result card rendered REMATCH on top of it and the legend
    // stayed readable straight through the button — "◄ step ▼ crouch" legible
    // behind the one control the player has to press. glm-5.3-flashx reported
    // it as "ghost legend bleeds through the REMATCH button", which is exactly
    // and only what it is. A lesson about a fight is finished when the fight is.
    coach.dismiss();
    hud.hideResult();
  };

  const restart = (): void => {
    state = createMatch({ content, startSeparation });
    opponent = makeOpponent(mode, seed);
    clearBoutUi();
  };

  // ---- The tournament: a run up the ladder, ended by the first loss. ----
  const tournament = mode === 'tournament';
  const run = { round: 0, score: 0, techniques: 0, ippons: 0, startedAt: 0, id: 0 };
  const leaderboard = new Leaderboard();
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
    // No kicker. The HUD strip directly above already reads "Round 1/5" and
    // the headline below is the round's own name, so a third statement of the
    // same two facts stacked 60px apart was pure redundancy — and it was the
    // loudest thing on a screen whose job is to start the fight.
    // The lesson belongs to a live bout. See clearBoutUi.
    coach.dismiss();
    hud.showResult({
      headline: round.name,
      tone: 'full',
      phase: 'prefight',
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
    run.techniques = 0;
    run.ippons = 0;
    run.startedAt = nowMs;
    run.id += 1;
    leaderboard.startRun();
    startRound(nowMs);
  };

  const finishTournamentBout = (won: boolean, nowMs: number): void => {
    const round = TOURNAMENT[run.round]!;
    const earned = scoreBout({ ...tally, ticksLeft: state.timerTicks, won }, round);
    run.score += earned;
    run.techniques += tally.ippon + tally.wazaAri;
    run.ippons += tally.ippon;
    const last = run.round === TOURNAMENT.length - 1;

    if (won && !last) {
      const next = TOURNAMENT[run.round + 1]!;
      // The lesson belongs to a live bout. See clearBoutUi.
    coach.dismiss();
    hud.showResult({
        kicker: `Round ${run.round + 1} cleared`,
        headline: `+${formatScore(earned)}`,
        tone: 'full',
        score: `Run ${formatScore(run.score)}`,
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
    // The lesson belongs to a live bout. See clearBoutUi.
    coach.dismiss();
    hud.showResult({
      kicker: won ? 'Tournament complete' : `Out in the ${round.name}`,
      headline: won ? 'CHAMPION' : 'DEFEATED',
      tone: won ? 'full' : 'neutral',
      score: formatScore(run.score),
      detail: newBest
        ? 'New best score'
        : `Best ${formatScore(record.bestScore)} · titles ${record.championships}`,
      action: 'NEW TOURNAMENT',
      rematch: () => act(),
    });
    schedule(() => newRun(performance.now()), REMATCH_AFTER_MS, nowMs);
    offerLeaderboard(nowMs);
  };

  /** If this run makes the board, stop the countdown and ask for a name. */
  const offerLeaderboard = (nowMs: number): void => {
    if (!leaderboard.available || run.score <= 0) return;
    const runId = run.id;
    const metrics = {
      score: run.score,
      rounds: run.round + 1,
      techniques: run.techniques,
      ippons: run.ippons,
      seconds: Math.max(0, (nowMs - run.startedAt) / 1000),
    };
    void leaderboard.board().then((board) => {
      // The player may already have started another run while this was in flight.
      if (board === null || run.id !== runId || !Leaderboard.qualifies(metrics.score, board)) return;
      // Nobody should lose a leaderboard entry to a countdown while typing.
      pendingAt = 0;
      hud.setRematchCountdown(0);
      hud.offerNameEntry({
        initial: loadPlayerName(),
        prompt: 'You made the board',
        submit: async (name) => {
          savePlayerName(name);
          const result = await leaderboard.submit(name, metrics);
          return result.ok ? `#${result.rank} on the arcade board` : result.message;
        },
      });
    });
  };

  const clock = new FixedClock();
  let previous = performance.now();
  let elapsedTicks = 0;

  let perfWindowStart = previous;
  let perfFrames = 0;
  let perfTicks = 0;

  // Flipped on the first frame that reaches the screen. The pre-boot card
  // lifts then, and not a moment sooner: nothing underneath it should ever be
  // a blank canvas, and __smkk.ready is the e2e contract for "the game is
  // visible", so a test that screenshots on it must never find the card.
  let handedOver = false;

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
    // The coach mark appears the moment the bout is live, not before it — a
    // hint sitting over the round card teaches nothing about the sticks.
    if (!coachOffered && state.phase === 'fight') {
      coachOffered = true;
      coach.show();
    }
    // The impact punch decays on the same curve as the camera punch-in, so the
    // colour kick and the hit land together instead of trailing each other.
    post.punch.value = juice.impactPunch() * 6;
    post.render();

    if (!handedOver) {
      handedOver = true;
      screen.advance('firstFrame');
      void screen.close().then(publishTestSurface);
    }

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
  // Published only once the pre-boot card has left the DOM, which is the whole
  // contract: every e2e test that screenshots does so off `__smkk.ready`.
  const publishTestSurface = (): void => {
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
          p2Move: state.fighters[1].move?.id ?? null,
          p2Phase: state.fighters[1].phase,
        }),
        /**
         * The atlas cell each fighter last drew, with the pose it came from and
         * the phase the simulation was in. Lets the e2e suite assert the real
         * renderer is running the same frame rule the unit tests pin down.
         */
        spriteFrames: () =>
          views.map((view) => view.frameInfo?.() ?? { cell: -1, pose: 'none', phase: 'neutral' as const }),
        /**
         * Drives every technique in the game through the live view, one tick at
         * a time, and reports the atlas cell the view actually drew.
         *
         * A real bout only ever throws a handful of techniques — the other
         * fighter is a person, and a person standing still does not swing — so
         * waiting for the fight to cover the whole move list is not a test, it
         * is a coin toss. This walks the real `SpriteFighterView` through each
         * move's startup, active and recovery ticks instead, which covers every
         * technique in milliseconds and cannot race the render loop. The view is
         * restored by the next animation frame, and no frame is drawn during the
         * sweep because it is synchronous.
         */
        spriteSweep: () => {
          const view = views[0];
          if (view?.frameInfo === undefined) return null; // the mesh rig has no cells
          const moves = indexMoves(content);
          const report: Array<{
            id: string;
            seen: Array<{ phase: string; cell: number }>;
          }> = [];

          for (const move of moves.values()) {
            // A throwaway fighter, stepped through the phase sequence the
            // simulation would produce for this move.
            const fighter = createFighter(content.fighters[0]!, -1.5, 1);
            beginMove(fighter, move);
            const seen: Array<{ phase: string; cell: number }> = [];
            const total = move.startup + move.active + move.recovery;

            for (let tick = 0; tick < total; tick += 1) {
              if (tick < move.startup) {
                fighter.phase = 'startup';
                fighter.phaseTicks = tick;
              } else if (tick < move.startup + move.active) {
                fighter.phase = 'active';
                fighter.phaseTicks = tick - move.startup;
              } else {
                fighter.phase = 'recovery';
                fighter.phaseTicks = tick - move.startup - move.active;
              }
              view.apply(fighter, tick);
              // Read the cell back after every apply: frameInfo() hands out a
              // fresh record each call, so capturing one before the loop would
              // report the same stale cell for every tick.
              seen.push({ phase: fighter.phase, cell: view.frameInfo()?.cell ?? -1 });
            }
            report.push({ id: move.id, seen });
          }
          return report;
        },
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
  };
}

// Taken before boot() is called, so the card is already under this module's
// control — and so a boot that throws on its very first line still has
// something to tear it down.
const screen = mountBootScreen();

void boot(screen).catch((error: unknown) => {
  // Straight out, with no dissolve. This boot has already cost the player the
  // whole of their wait; the banner underneath is the only thing that says
  // what went wrong, and a card fading politely over it would hide the answer
  // behind an animation.
  screen.abandon();
  const banner = document.getElementById('banner');
  if (banner !== null) {
    banner.textContent = 'FAILED TO START';
    banner.dataset['tone'] = 'neutral';
    banner.classList.add('show');
  }
  console.error(error);
});
