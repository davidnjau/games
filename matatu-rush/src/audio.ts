// ─────────────────────────────────────────────────────────────
// audio.ts — sound effects synthesised with the Web Audio API.
// No audio files needed: every sound is built from oscillators
// and envelopes. Swap these for recorded clips (a real matatu
// horn, a crowd shouting "Wabebee!") in a later milestone.
// ─────────────────────────────────────────────────────────────

export class Sound {
  private ctx: AudioContext | null = null;
  muted = false;

  /** Browsers only allow audio after a click/tap, so call this from one. */
  unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as any).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  /** One tone with a quick attack and exponential fade. */
  private tone(freq: number, start: number, dur: number, type: OscillatorType, vol = 0.15, endFreq?: number) {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const t = ctx.currentTime + start;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  /** Two-note matatu horn: "peep-peeep". */
  horn(): void {
    this.tone(415, 0, 0.09, 'square', 0.07);
    this.tone(523, 0, 0.09, 'square', 0.05);
    this.tone(415, 0.12, 0.18, 'square', 0.07);
    this.tone(523, 0.12, 0.18, 'square', 0.05);
  }

  /** Metal clank of spikes hitting tarmac. */
  spikes(): void {
    this.tone(160, 0, 0.18, 'triangle', 0.25, 50);
    this.tone(1800, 0, 0.06, 'square', 0.04, 900);
    this.tone(2400, 0.04, 0.05, 'square', 0.03, 1200);
  }

  /** Grumpy buzz for illegal moves. */
  error(): void {
    this.tone(220, 0, 0.12, 'sawtooth', 0.08, 140);
    this.tone(180, 0.13, 0.16, 'sawtooth', 0.08, 110);
  }

  /** Victory fanfare: a rising arpeggio plus horn. */
  victory(): void {
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, i * 0.11, 0.22, 'square', 0.06));
    this.tone(1047, 0.48, 0.5, 'triangle', 0.1);
    setTimeout(() => this.horn(), 600);
  }

  click(): void {
    this.tone(900, 0, 0.03, 'square', 0.03);
  }
}
