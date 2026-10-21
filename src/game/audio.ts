export type Sfx = "abduct" | "hit" | "over" | "alert";

export class SaucerAudio {
  muted = false;
  private ctx: AudioContext | null = null;
  private drone: OscillatorNode | null = null;
  private droneGain: GainNode | null = null;
  private beam: OscillatorNode | null = null;
  private beamGain: GainNode | null = null;

  ensure() {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;
    const drone = ctx.createOscillator();
    drone.type = "sawtooth";
    drone.frequency.value = 52;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 240;
    const droneGain = ctx.createGain();
    droneGain.gain.value = 0;
    drone.connect(filter);
    filter.connect(droneGain);
    droneGain.connect(ctx.destination);
    drone.start();
    const beam = ctx.createOscillator();
    beam.type = "sine";
    beam.frequency.value = 310;
    const beamGain = ctx.createGain();
    beamGain.gain.value = 0;
    beam.connect(beamGain);
    beamGain.connect(ctx.destination);
    beam.start();
    this.drone = drone;
    this.droneGain = droneGain;
    this.beam = beam;
    this.beamGain = beamGain;
    void ctx.resume();
  }

  sync(speed: number, beamOn: boolean, active: boolean) {
    if (!this.ctx || !this.drone || !this.droneGain || !this.beam || !this.beamGain) return;
    const t = this.ctx.currentTime;
    const audible = active && !this.muted;
    const dg = audible ? 0.012 + Math.min(Math.abs(speed) / 340, 1) * 0.03 : 0;
    this.drone.frequency.setTargetAtTime(46 + Math.min(Math.abs(speed), 340) * 0.12, t, 0.08);
    this.droneGain.gain.setTargetAtTime(dg, t, 0.08);
    const bg = audible && beamOn ? 0.028 : 0;
    this.beam.frequency.setTargetAtTime(beamOn ? 360 : 280, t, 0.05);
    this.beamGain.gain.setTargetAtTime(bg, t, 0.04);
  }

  play(kind: Sfx) {
    if (!this.ctx || this.muted) return;
    if (kind === "abduct") {
      this.tone(523, 0.09, "triangle", 0.06, 0);
      this.tone(659, 0.1, "triangle", 0.05, 0.07);
      this.tone(784, 0.16, "sine", 0.05, 0.13);
      return;
    }
    if (kind === "alert") {
      this.tone(740, 0.08, "square", 0.03, 0);
      this.tone(880, 0.1, "square", 0.028, 0.12);
      return;
    }
    if (kind === "hit") {
      this.tone(96, 0.22, "sawtooth", 0.07, 0);
      this.noise(0.18, 0.08);
      return;
    }
    this.tone(392, 0.16, "triangle", 0.05, 0);
    this.tone(311, 0.2, "triangle", 0.05, 0.14);
    this.tone(196, 0.32, "sine", 0.05, 0.28);
  }

  dispose() {
    this.drone?.stop();
    this.beam?.stop();
    void this.ctx?.close();
    this.ctx = null;
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, at: number) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + at;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(Math.max(vol, 0.0002), t + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private noise(dur: number, vol: number) {
    if (!this.ctx) return;
    const frames = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buffer = this.ctx.createBuffer(1, frames, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const gain = this.ctx.createGain();
    gain.gain.value = vol;
    src.connect(gain);
    gain.connect(this.ctx.destination);
    src.start();
  }
}
