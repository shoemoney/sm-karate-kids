/**
 * The pre-boot publisher card.
 *
 * Boot is real work: a GPU device, 2.3 MB of sprite atlas and 0.6 MB of
 * generated dojo art, and until the last of it lands there is nothing on
 * screen but a black canvas. This owns the card that covers that gap — and,
 * more to the point, it owns the four rules for taking that card away again,
 * because a loading screen that is wrong about loading is worse than no
 * loading screen at all:
 *
 *  - The bar tracks COMPLETED UNITS OF REAL WORK, weighted by what each unit
 *    actually costs. It is never animated on a timer. A bar that creeps to
 *    90% because a CSS transition is running is a bar that lies.
 *  - Units are marked complete in whatever order they land, because the
 *    renderer and the atlas really do load concurrently and a strictly
 *    sequential counter would stall at the first await.
 *  - The card only lifts once a frame has actually been drawn, so what is
 *    underneath it is never a blank canvas.
 *  - Nothing in here is focusable while it is up, and nothing in here ever
 *    calls focus(). Two e2e tests assert that typing keeps working through
 *    the whole of a bout; a splash that grabbed the caret would break them.
 */

export type BootUnit = 'renderer' | 'fighters' | 'dojo' | 'firstFrame';

interface Unit {
  /** Share of the bar this unit is worth on completion. Sums to 100. */
  readonly weight: number;
  /** Shown, and announced, as the newest thing to have finished. */
  readonly label: string;
}

/**
 * Weights are cost-informed, not evenly divided. `fighters` is 2.3 MB across
 * six atlas pages and is the longest transfer the game makes; `dojo` is 0.6 MB
 * across five textures; `renderer` moves no bytes at all but WebGPU device and
 * pipeline creation is the single longest await on a cold start. Evening them
 * out would make the bar's shape a lie about where the time actually goes.
 */
const UNITS: Readonly<Record<BootUnit, Unit>> = {
  fighters: { weight: 40, label: 'Lacing the fighters' },
  renderer: { weight: 27, label: 'Starting the renderer' },
  dojo: { weight: 25, label: 'Lighting the dojo' },
  firstFrame: { weight: 8, label: 'Drawing the first frame' },
};

const TOTAL_WEIGHT = 100;

/**
 * How long the card is worth keeping on screen.
 *
 * Below this the exit is a hard cut rather than a dissolve. A full-screen card
 * that fades up and straight back down inside two frames is a flicker, and
 * the entrance animation is the thing that bounds how bright that flicker can
 * get: a card removed at 35ms was only ever at ~0.6 opacity, where a card
 * removed instantly at full brightness is a strobe. Above this the entrance
 * has finished, the content is at full opacity, and a dissolve is a real
 * cross-fade rather than a flash.
 *
 * Must match `--dur-base`, the duration of `boot-enter` on `.boot-card`.
 */
const MIN_DWELL_MS = 180;

/** Must match `--dur-slow`, the transition on `.boot`. Only ever a ceiling. */
const EXIT_MS = 300;

export interface BootScreen {
  /**
   * Credit one unit of real boot work.
   *
   * `share` is how much of that unit is done *now* as a fraction, cumulatively
   * across the calls for it — 1 for a unit that lands in one go, or a running
   * count for one that arrives in pieces. The atlas is the case that matters:
   * 2.3 MB across six pages, reported as it goes, because a card that sits
   * still for two seconds and then jumps is a bar nobody believes.
   *
   * `note` overrides the unit's label for the units that can say more than
   * the default ("3 of 6 pages" beats "lacing the fighters").
   *
   * Idempotent in aggregate: a unit's credit only ever grows, so a repeated or
   * out-of-order report can never take the bar backwards or past its end.
   */
  advance(unit: BootUnit, share?: number, note?: string): void;
  /** Takes the card down properly. Resolves once it has left the DOM. */
  close(): Promise<void>;
  /** Takes it down at once, with no dissolve, so an error can be read. */
  abandon(): void;
}

function isReducedMotion(): boolean {
  // Both signals, deliberately: `body.reduced-motion` is the in-game toggle
  // and the only one present by the time the card is taken down, but the media
  // query is the one that was already true on the first paint.
  if (document.body.classList.contains('reduced-motion')) return true;
  try {
    return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  } catch {
    return false;
  }
}

/**
 * Fades `el` out and resolves when it is done — on `transitionend`, or on a
 * timer, whichever arrives first. The timer is not belt-and-braces: a
 * transition on an element the browser is not painting never fires its end
 * event, and a card that never resolves would leave `__smkk` unpublished for
 * the rest of the session.
 */
function fadeOut(el: HTMLElement, ms: number): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    // Spelled this way because @types/node reaches this project through
    // playwright.config.ts, so bare `setTimeout` has two return types here and
    // the browser one is the only one that actually runs.
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimeout(timer);
      el.removeEventListener('transitionend', onEnd);
      resolve();
    };
    const onEnd = (event: TransitionEvent): void => {
      if (event.target === el && event.propertyName === 'opacity') finish();
    };
    el.addEventListener('transitionend', onEnd);
    timer = setTimeout(finish, ms + 120);
    el.dataset['state'] = 'leaving';
  });
}

/**
 * Takes control of the card already sitting in the document.
 *
 * A missing card is not an error: the markup is ours, but a build that
 * stripped it should degrade to a blank warm page rather than throw out of
 * here and bury the real boot error under a splash failure. Every method is
 * then a no-op.
 */
export function mountBootScreen(): BootScreen {
  const el = document.getElementById('boot');
  const bar = document.getElementById('boot-bar');
  const fill = document.getElementById('boot-fill');
  const stage = document.getElementById('boot-stage');

  if (el === null || bar === null || fill === null || stage === null) {
    const inert: BootScreen = {
      advance: () => undefined,
      close: () => Promise.resolve(),
      abandon: () => undefined,
    };
    return inert;
  }

  const bornAt = performance.now();
  const shares = new Map<BootUnit, number>();
  let earned = 0;
  let closed: Promise<void> | null = null;

  const remove = (): void => {
    el.dataset['state'] = 'done';
    el.remove();
  };

  return {
    advance(unit: BootUnit, share = 1, note?: string): void {
      if (el.isConnected === false) return;
      const wanted = Math.min(Math.max(share, 0), 1);
      const already = shares.get(unit) ?? 0;
      // Only ever grows, so a late, repeated or out-of-order report cannot
      // take the bar backwards.
      if (wanted <= already) return;
      shares.set(unit, wanted);

      earned = 0;
      for (const [key, done] of shares) earned += UNITS[key].weight * done;

      const percent = Math.min(100, Math.round((earned / TOTAL_WEIGHT) * 100));
      fill.style.inlineSize = `${percent}%`;
      bar.setAttribute('aria-valuenow', String(percent));
      // The percentage rides along with the stage name. The first unit of real
      // work is a bundle fetch, so on a slow connection the bar legitimately
      // sits at 0% for a second and a half — and a gauge reading zero with no
      // number looks broken rather than busy. The number is the same real
      // value the bar is showing, not a spinner standing in for one.
      stage.textContent = `${note ?? UNITS[unit].label} · ${percent}%`;
    },

    close(): Promise<void> {
      if (closed !== null) return closed;

      // The bar lands on a full bar before the dissolve, so a screen reader
      // that caught the value change heard "complete" rather than "97%".
      fill.style.inlineSize = '100%';
      bar.setAttribute('aria-valuenow', '100');
      stage.textContent = 'Ready';

      const dwell = performance.now() - bornAt;
      if (isReducedMotion() || dwell < MIN_DWELL_MS) {
        // Too quick to dissolve without flickering, or motion is off and a
        // dissolve is exactly what was asked not to happen. Straight to the
        // DOM, at whatever opacity the entrance had reached.
        remove();
        closed = Promise.resolve();
        return closed;
      }

      closed = fadeOut(el, EXIT_MS).then(remove);
      return closed;
    },

    abandon(): void {
      // No dissolve. A boot that threw has already cost the player its whole
      // wait, and the banner underneath is the only thing that tells them
      // what went wrong — it has to be readable the instant the card goes.
      closed ??= Promise.resolve();
      remove();
    },
  };
}
