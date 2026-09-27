/** Fixed-step simulation clock. Gameplay never reads wall time. */
export const TICK_HZ = 60;
export const TICK_MS = 1000 / TICK_HZ;

/** Drains accumulated real milliseconds into whole simulation ticks. */
export class FixedClock {
  private accumulator = 0;
  private elapsed = 0;

  constructor(private readonly maxTicksPerDrain = 5) {}

  /** Returns how many ticks to run for the given frame delta. */
  drain(deltaMs: number): number {
    this.accumulator += Math.max(0, Math.min(deltaMs, 250));
    let ticks = 0;
    while (this.accumulator >= TICK_MS && ticks < this.maxTicksPerDrain) {
      this.accumulator -= TICK_MS;
      ticks += 1;
    }
    if (ticks === this.maxTicksPerDrain) this.accumulator = 0;
    this.elapsed += ticks;
    return ticks;
  }

  /** 0..1 progress toward the next tick, for presentation interpolation only. */
  get alpha(): number {
    return this.accumulator / TICK_MS;
  }

  get tick(): number {
    return this.elapsed;
  }
}
