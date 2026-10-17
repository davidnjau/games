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

  /** Dice tumbling — two quick knocks. */
  roll(): void {
    this.tone(220, 0, 0.04, 'square', 0.05);
    this.tone(260, 0.05, 0.04, 'square', 0.05);
  }

  /** Cash coming in. */
  cashGood(): void {
    [660, 880, 1100].forEach((f, i) => this.tone(f, i * 0.06, 0.14, 'square', 0.06));
  }

  /** Cash going out. */
  cashBad(): void {
    this.tone(260, 0, 0.16, 'sawtooth', 0.08, 140);
  }

  /** Bought a property. */
  buy(): void {
    [523, 659, 784, 1046].forEach((f, i) => this.tone(f, i * 0.05, 0.12, 'triangle', 0.07));
  }

  /** Card flip. */
  card(): void {
    this.tone(500, 0, 0.05, 'square', 0.05, 800);
  }

  /** Sent to Kanjo Custody. */
  jail(): void {
    this.tone(500, 0, 0.22, 'square', 0.05, 900);
    this.tone(900, 0.2, 0.22, 'square', 0.05, 500);
  }

  /** Left jail successfully. */
  freed(): void {
    [392, 523, 659].forEach((f, i) => this.tone(f, i * 0.08, 0.16, 'triangle', 0.07));
  }

  /** Bankrupted. */
  bankrupt(): void {
    [440, 392, 349, 294].forEach((f, i) => this.tone(f, i * 0.16, 0.26, 'sawtooth', 0.08, f * 0.6));
  }

  win(): void {
    [523, 659, 784, 1046, 1318].forEach((f, i) => this.tone(f, i * 0.1, 0.22, 'triangle', 0.08));
  }
}
