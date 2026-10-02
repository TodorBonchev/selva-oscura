/**
 * Tiny procedural blips. No audio files. The context is created on the first
 * user gesture; master gain stays low; mute persists; a hidden tab stays silent.
 */

const MUTE_KEY = "selva.sfxMute";
const MASTER = 0.18;

type OscType = OscillatorType;

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  muted: boolean;

  constructor() {
    let stored = false;
    try {
      stored = localStorage.getItem(MUTE_KEY) === "1";
    } catch {
      stored = false;
    }
    this.muted = stored;
    const arm = () => this.unlock();
    window.addEventListener("pointerdown", arm);
    window.addEventListener("keydown", arm);
    document.addEventListener("visibilitychange", () => {
      const ctx = this.ctx;
      if (!ctx) return;
      if (document.hidden) void ctx.suspend();
      else if (!this.muted) void ctx.resume();
    });
  }

  /** Call from a gesture. Safe to call often. */
  unlock() {
    if (this.muted || document.hidden) return;
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    if (!this.ctx) {
      try {
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = MASTER;
        this.master.connect(this.ctx.destination);
      } catch {
        this.ctx = null;
        this.master = null;
        return;
      }
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  toggleMuted(): boolean {
    this.muted = !this.muted;
    try {
      localStorage.setItem(MUTE_KEY, this.muted ? "1" : "0");
    } catch {
      /* private mode */
    }
    if (this.muted) {
      if (this.ctx && this.ctx.state === "running") void this.ctx.suspend();
    } else {
      this.unlock();
    }
    return this.muted;
  }

  hit() {
    this.tone(150, 0.07, "sine", 0.55);
    this.tone(70, 0.09, "triangle", 0.35);
  }
  heavy() {
    this.tone(90, 0.16, "square", 0.4);
    this.tone(48, 0.2, "sine", 0.5);
  }
  kill() {
    this.tone(72, 0.16, "sine", 0.55);
    this.tone(146, 0.12, "triangle", 0.32);
    window.setTimeout(() => this.tone(220, 0.16, "sine", 0.22), 60);
    window.setTimeout(() => this.tone(440, 0.22, "triangle", 0.16), 120);
  }
  match() {
    this.tone(392, 0.1, "triangle", 0.28);
    window.setTimeout(() => this.tone(523, 0.12, "sine", 0.3), 80);
    window.setTimeout(() => this.tone(784, 0.2, "triangle", 0.26), 170);
  }
  tick() {
    this.tone(660, 0.05, "square", 0.22);
  }
  gong() {
    this.tone(110, 0.55, "sine", 0.5);
    this.tone(220, 0.4, "triangle", 0.22);
  }
  victory() {
    this.tone(523, 0.22, "sine", 0.28);
    window.setTimeout(() => this.tone(659, 0.22, "sine", 0.26), 90);
    window.setTimeout(() => this.tone(784, 0.34, "triangle", 0.24), 180);
  }
  defeat() {
    this.glide(140, 48, 0.7, "sawtooth", 0.28);
  }
  announce() {
    this.tone(520, 0.08, "triangle", 0.3);
    this.tone(740, 0.12, "sine", 0.22);
  }

  /** Level-up: a short rising bone-gold chime. */
  levelUp() {
    this.tone(523, 0.12, "sine", 0.26);
    window.setTimeout(() => this.tone(659, 0.12, "sine", 0.24), 70);
    window.setTimeout(() => this.tone(784, 0.14, "triangle", 0.22), 140);
    window.setTimeout(() => this.tone(1046, 0.22, "sine", 0.2), 210);
  }

  /** One short voice per skill family. */
  skill(kind: "melee" | "fire" | "wind" | "holy" | "shadow" | "buff") {
    if (kind === "melee") {
      this.tone(180, 0.08, "sawtooth", 0.2);
      this.tone(90, 0.1, "triangle", 0.18);
    } else if (kind === "fire") {
      this.tone(140, 0.16, "sawtooth", 0.22);
      this.tone(70, 0.18, "square", 0.12);
    } else if (kind === "wind") {
      this.tone(620, 0.1, "sine", 0.16);
      this.tone(880, 0.12, "triangle", 0.1);
    } else if (kind === "shadow") {
      this.tone(110, 0.08, "square", 0.2);
      this.tone(220, 0.06, "triangle", 0.12);
    } else if (kind === "buff") {
      this.tone(392, 0.1, "triangle", 0.18);
      this.tone(523, 0.14, "sine", 0.14);
    } else {
      this.tone(880, 0.1, "sine", 0.18);
      this.tone(1320, 0.12, "sine", 0.1);
    }
  }

  private tone(freq: number, dur: number, type: OscType, amp: number) {
    const ctx = this.live();
    if (!ctx || !this.master) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(Math.max(0.0001, amp), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
    o.onended = () => {
      o.disconnect();
      g.disconnect();
    };
  }

  private glide(from: number, to: number, dur: number, type: OscType, amp: number) {
    const ctx = this.live();
    if (!ctx || !this.master) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(from, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + dur);
    g.gain.setValueAtTime(Math.max(0.0001, amp), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
    o.onended = () => {
      o.disconnect();
      g.disconnect();
    };
  }

  private live(): AudioContext | null {
    if (this.muted || document.hidden) return null;
    const ctx = this.ctx;
    if (!ctx || ctx.state !== "running" || !this.master) return null;
    return ctx;
  }
}
