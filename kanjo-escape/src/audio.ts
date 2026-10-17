// audio.ts — synthesised sound effects (Web Audio API, no files needed).

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

  private tone(freq: number, start: number, dur: number, type: OscillatorType, vol = 0.12, endFreq?: number) {
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

  /** A pea whistle: high tone with a fast trill (an LFO wobbling the pitch). */
  private trill(start: number, dur: number) {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const t = ctx.currentTime + start;
    const osc = ctx.createOscillator();
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(2900, t);
    lfo.frequency.setValueAtTime(28, t);
    lfoGain.gain.setValueAtTime(260, t);
    lfo.connect(lfoGain).connect(osc.frequency);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.09, t + 0.02);
    gain.gain.setValueAtTime(0.09, t + dur - 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    lfo.start(t);
    osc.stop(t + dur + 0.02);
    lfo.stop(t + dur + 0.02);
  }

  /** "Wale wale!" — two whistle blasts. */
  whistle(): void {
    this.trill(0, 0.32);
    this.trill(0.42, 0.5);
  }

  step(): void {
    this.tone(320, 0, 0.05, 'triangle', 0.08, 200);
  }

  engine(): void {
    this.tone(70, 0, 0.35, 'sawtooth', 0.06, 110);
    this.tone(140, 0.05, 0.25, 'square', 0.025, 190);
  }

  miss(): void {
    this.tone(500, 0, 0.08, 'triangle', 0.06, 420);
  }

  error(): void {
    this.tone(220, 0, 0.12, 'sawtooth', 0.07, 140);
  }

  /** A stuck matatu honking twice — the traffic jam event. */
  traffic(): void {
    this.tone(300, 0, 0.1, 'sawtooth', 0.08, 260);
    this.tone(300, 0.16, 0.1, 'sawtooth', 0.08, 260);
  }

  /** A relieved little rising chirp — bail paid, back on the street. */
  bail(): void {
    this.tone(500, 0, 0.08, 'triangle', 0.08, 700);
    this.tone(700, 0.08, 0.14, 'triangle', 0.07, 950);
  }

  caught(): void {
    // Siren sweeping up and down, then a thud.
    for (let i = 0; i < 3; i++) {
      this.tone(600, i * 0.3, 0.15, 'square', 0.05, 950);
      this.tone(950, i * 0.3 + 0.15, 0.15, 'square', 0.05, 600);
    }
    this.tone(90, 0.95, 0.3, 'triangle', 0.25, 40);
  }

  escape(): void {
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, i * 0.11, 0.22, 'square', 0.05));
    this.tone(1047, 0.48, 0.5, 'triangle', 0.09);
    // Two-note matatu horn.
    this.tone(415, 0.7, 0.2, 'square', 0.05);
    this.tone(523, 0.7, 0.2, 'square', 0.04);
  }

  click(): void {
    this.tone(900, 0, 0.03, 'square', 0.025);
  }
}
