/**
 * A four-sound audio bed built from oscillators. No files to license, no
 * decode cost, and it unlocks on the first touch like every mobile browser
 * insists.
 */
export type Cue = 'strike' | 'contact' | 'ippon' | 'bell';

export class Audio {
  private context: AudioContext | null = null;
  private muted = false;

  unlock(): void {
    if (this.context !== null) return;
    const Ctor = globalThis.AudioContext;
    if (Ctor === undefined) return;
    this.context = new Ctor();
    void this.context.resume();
  }

  setMuted(value: boolean): void {
    this.muted = value;
  }

  play(cue: Cue): void {
    const context = this.context;
    if (context === null || this.muted) return;

    const now = context.currentTime;
    const gain = context.createGain();
    gain.connect(context.destination);

    const shape: Record<Cue, { type: OscillatorType; from: number; to: number; length: number; peak: number }> = {
      strike: { type: 'square', from: 220, to: 120, length: 0.07, peak: 0.05 },
      contact: { type: 'triangle', from: 660, to: 180, length: 0.14, peak: 0.16 },
      ippon: { type: 'sine', from: 880, to: 1320, length: 0.34, peak: 0.16 },
      bell: { type: 'sine', from: 1200, to: 700, length: 0.7, peak: 0.13 },
    };
    const spec = shape[cue];

    const osc = context.createOscillator();
    osc.type = spec.type;
    osc.frequency.setValueAtTime(spec.from, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(spec.to, 1), now + spec.length);
    osc.connect(gain);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(spec.peak, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + spec.length);

    osc.start(now);
    osc.stop(now + spec.length + 0.02);
  }
}
