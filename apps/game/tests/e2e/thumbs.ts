import type { CDPSession, Page } from '@playwright/test';

interface Point {
  x: number;
  y: number;
}

/**
 * Real touch input, dispatched through the browser's input pipeline rather
 * than synthesised in page script. If the game only responds to fabricated
 * events, these tests would pass on a build no thumb could play.
 */
export class Thumbs {
  private readonly active = new Map<number, Point>();

  private constructor(private readonly cdp: CDPSession) {}

  static async attach(page: Page): Promise<Thumbs> {
    const cdp = await page.context().newCDPSession(page);
    return new Thumbs(cdp);
  }

  private async dispatch(type: 'touchStart' | 'touchMove' | 'touchEnd'): Promise<void> {
    const touchPoints = [...this.active.entries()].map(([id, point]) => ({
      x: Math.round(point.x),
      y: Math.round(point.y),
      id,
    }));
    await this.cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
  }

  async down(id: number, x: number, y: number): Promise<void> {
    if (this.active.has(id)) {
      await this.move(id, x, y);
      return;
    }
    this.active.set(id, { x, y });
    await this.dispatch('touchStart');
  }

  async move(id: number, x: number, y: number): Promise<void> {
    if (!this.active.has(id)) return;
    this.active.set(id, { x, y });
    await this.dispatch('touchMove');
  }

  async up(id: number): Promise<void> {
    if (!this.active.delete(id)) return;
    await this.dispatch('touchEnd');
  }

  async release(): Promise<void> {
    for (const id of [...this.active.keys()]) await this.up(id);
  }
}

export type Dir = 'neutral' | 'up' | 'down' | 'left' | 'right';

/** Well past the dead zone, so the gate has no excuse to read neutral. */
const THROW = 58;

export function offsetFor(dir: Dir): Point {
  if (dir === 'up') return { x: 0, y: -THROW };
  if (dir === 'down') return { x: 0, y: THROW };
  if (dir === 'left') return { x: -THROW, y: 0 };
  if (dir === 'right') return { x: THROW, y: 0 };
  return { x: 0, y: 0 };
}

export interface StickAnchor {
  readonly id: number;
  readonly x: number;
  readonly y: number;
}

export async function anchorOf(page: Page, selector: string, id: number): Promise<StickAnchor> {
  const box = await page.locator(selector).boundingBox();
  if (box === null) throw new Error(`no box for ${selector}`);
  return { id, x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Holds a direction on one stick until told otherwise. */
export async function hold(thumbs: Thumbs, anchor: StickAnchor, dir: Dir): Promise<void> {
  const offset = offsetFor(dir);
  if (dir === 'neutral') {
    await thumbs.up(anchor.id);
    return;
  }
  await thumbs.down(anchor.id, anchor.x, anchor.y);
  await thumbs.move(anchor.id, anchor.x + offset.x, anchor.y + offset.y);
}
