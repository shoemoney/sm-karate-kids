/**
 * Synthesised on the fly: no files to license, no decode cost, and it unlocks
 * on the first touch like every mobile browser insists. Noise does the heavy
 * lifting — a hit is mostly a crack of filtered noise over a low body thump.
 */
export type Cue = 'strike' | 'contact' | 'ippon' | 'block' | 'bell';

export class Audio {
  private context: AudioContext | null = null;
  private noise: AudioBuffer | null = null;
  private master: GainNode | null = null;
  private muted = false;

  unlock(): void {
    if (this.context !== null) return;
    const Ctor = globalThis.AudioContext;
    if (Ctor === undefined) return;
    const context = new Ctor();
    this.context = context;
    void context.resume();

    const length = Math.floor(context.sampleRate * 0.6);
    this.noise = context.createBuffer(1, length, context.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;

    // A gentle compressor so a flurry of hits stays loud without clipping.
    const squash = context.createDynamicsCompressor();
    squash.threshold.value = -14;
    squash.ratio.value = 6;
    this.master = context.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(squash).connect(context.destination);
  }

  setMuted(value: boolean): void {
    this.muted = value;
  }

  play(cue: Cue): void {
    const context = this.context;
    const out = this.master;
    if (context === null || out === null || this.muted) return;
    const t = context.currentTime;

    if (cue === 'strike') {
      // The whoosh of a limb committing: band-passed noise sweeping upward.
      this.noiseBurst(t, 0.16, 0.22, 'bandpass', 700, 2600, 1.4);
    } else if (cue === 'contact') {
      this.thump(t, 150, 55, 0.18, 0.55);
      this.noiseBurst(t, 0.07, 0.5, 'highpass', 1800, 900, 0.7);
    } else if (cue === 'ippon') {
      // Heavier body, longer crack, and a clean tone to say "that counted".
      this.thump(t, 120, 40, 0.3, 0.8);
      this.noiseBurst(t, 0.12, 0.6, 'highpass', 1400, 600, 0.7);
      this.tone(t + 0.05, 'triangle', 880, 1320, 0.5, 0.12);
    } else if (cue === 'block') {
      // Wood on wood: a short resonant knock, no body.
      this.noiseBurst(t, 0.05, 0.35, 'bandpass', 1100, 900, 8);
      this.thump(t, 320, 200, 0.07, 0.25);
    } else if (cue === 'bell') {
      this.tone(t, 'sine', 1180, 1170, 1.2, 0.18);
      this.tone(t, 'sine', 2360, 2350, 0.8, 0.06);
    }
  }

  private noiseBurst(
    t: number,
    length: number,
    peak: number,
    type: BiquadFilterType,
    fromHz: number,
    toHz: number,
    q: number,
  ): void {
    const context = this.context;
    if (context === null || this.noise === null || this.master === null) return;
    const source = context.createBufferSource();
    source.buffer = this.noise;
    const filter = context.createBiquadFilter();
    filter.type = type;
    filter.Q.value = q;
    filter.frequency.setValueAtTime(fromHz, t);
    filter.frequency.exponentialRampToValueAtTime(Math.max(toHz, 20), t + length);
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
    source.connect(filter).connect(gain).connect(this.master);
    source.start(t);
    source.stop(t + length + 0.02);
  }

  private thump(t: number, fromHz: number, toHz: number, length: number, peak: number): void {
    this.tone(t, 'sine', fromHz, toHz, length, peak);
  }

  private tone(t: number, type: OscillatorType, fromHz: number, toHz: number, length: number, peak: number): void {
    const context = this.context;
    if (context === null || this.master === null) return;
    const osc = context.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(fromHz, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(toHz, 1), t + length);
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
    osc.connect(gain).connect(this.master);
    osc.start(t);
    osc.stop(t + length + 0.02);
  }
}
