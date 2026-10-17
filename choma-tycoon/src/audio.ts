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

  click(): void {
    this.tone(900, 0, 0.03, 'square', 0.025);
  }

  /** Correct ingredient dropped into the tray. */
  good(): void {
    this.tone(700, 0, 0.06, 'triangle', 0.08, 1000);
  }

  /** Wrong ingredient — tray resets. */
  bad(): void {
    this.tone(220, 0, 0.14, 'sawtooth', 0.08, 110);
  }

  /** Order fully assembled and handed over — a little cash-register flourish. */
  serve(): void {
    [660, 880, 1100].forEach((f, i) => this.tone(f, i * 0.07, 0.16, 'square', 0.06));
  }

  /** A customer gave up and left angry. */
  angry(): void {
    this.tone(300, 0, 0.18, 'sawtooth', 0.07, 160);
    this.tone(220, 0.16, 0.22, 'sawtooth', 0.06, 120);
  }

  /** Kanjo siren — sweeping wail, repeats while the warning is up. */
  siren(): void {
    this.tone(500, 0, 0.22, 'square', 0.05, 900);
    this.tone(900, 0.2, 0.22, 'square', 0.05, 500);
  }

  /** Successfully hid the cart in time. */
  safe(): void {
    [523, 659, 784].forEach((f, i) => this.tone(f, i * 0.1, 0.2, 'triangle', 0.07));
  }

  /** Caught by Kanjo — fined. */
  fine(): void {
    this.tone(220, 0, 0.3, 'sawtooth', 0.09, 70);
  }

  gameOver(): void {
    [440, 392, 349, 294].forEach((f, i) => this.tone(f, i * 0.18, 0.3, 'triangle', 0.08));
  }
}
