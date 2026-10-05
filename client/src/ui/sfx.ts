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
  /** White noise, created once per AudioContext (~1 s). */
  private noiseBuf: AudioBuffer | null = null;
  private noiseCtx: AudioContext | null = null;
  /** Last skillVoice time (ms) per id. Split so the key is the caller's string. */
  private castAt = new Map<string, number>();
  private impactAt = new Map<string, number>();
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

  /** PvE melee: the blade meeting a foe (finisher: a heavier thump under the cut). */
  slash(fin = false) {
    if (this.gated("slash", 55)) return;
    this.noise(0.05, fin ? 0.2 : 0.14, "bandpass", 2600, 900, 1.1);
    this.note(150, 72, 0.07, "triangle", fin ? 0.3 : 0.2);
    if (fin) this.note(70, 44, 0.14, "sine", 0.28, 0.01);
  }
  /** PvE: a foe struck you (a dull, short knock; throttled under swarm hits). */
  hurt(heavy = false) {
    if (this.gated("hurt", heavy ? 90 : 140)) return;
    this.note(heavy ? 120 : 190, heavy ? 52 : 110, heavy ? 0.16 : 0.08, "triangle", heavy ? 0.3 : 0.18);
    this.noise(0.05, heavy ? 0.16 : 0.08, "lowpass", 900, 180, 0.7);
  }
  /** PvE: your killing blow (lighter than the PvP kill fanfare). */
  fell(boss = false) {
    if (this.gated("fell", 70)) return;
    this.note(boss ? 70 : 110, boss ? 36 : 60, boss ? 0.32 : 0.14, "sine", boss ? 0.32 : 0.22);
    this.noise(boss ? 0.22 : 0.08, boss ? 0.16 : 0.08, "lowpass", 1200, 120, 0.6);
    if (boss) window.setTimeout(() => this.tone(220, 0.3, "triangle", 0.16), 90);
  }
  /** A heavy windup aimed at you (boss slams, eruptions): a low rising warning. */
  warn(boss = false) {
    if (this.gated("warn", 380)) return;
    this.note(boss ? 82 : 120, boss ? 150 : 210, boss ? 0.32 : 0.2, "sawtooth", boss ? 0.13 : 0.09);
  }
  /** Wrath: a wrathful shade enrages nearby (a growl). */
  enrage(boss = false) {
    if (this.gated("enrage", 250)) return;
    this.note(boss ? 92 : 130, boss ? 52 : 78, boss ? 0.42 : 0.26, "sawtooth", boss ? 0.2 : 0.14);
    this.noise(boss ? 0.36 : 0.22, boss ? 0.12 : 0.08, "bandpass", 420, 220, 1.6);
  }

  /** Loot into the bag: a soft coin tick; magic+ a brighter second note, uniques a third. */
  pickup(tier: 0 | 1 | 2 | 3 = 0) {
    if (this.gated("pickup", 70)) return;
    this.note(880, 1180, 0.05, "triangle", 0.12);
    if (tier >= 1) this.note(1320, 1560, 0.08, "sine", 0.1, 0.05);
    if (tier >= 2) this.note(1760, 1980, 0.12, "sine", 0.09, 0.11);
    if (tier >= 3) this.note(660, 990, 0.3, "triangle", 0.1, 0.16);
  }
  /** Kneeling at a shrine / pyre: a low warm swell. */
  mend() {
    if (this.gated("mend", 400)) return;
    this.note(196, 262, 0.34, "sine", 0.16);
    this.note(294, 392, 0.4, "sine", 0.1, 0.08);
  }

  private gateAt = new Map<string, number>();
  /** True (skip) when the same cue played under `ms` ago. */
  private gated(key: string, ms: number): boolean {
    const now = performance.now();
    const prev = this.gateAt.get(key);
    if (prev !== undefined && now - prev < ms) return true;
    this.gateAt.set(key, now);
    return false;
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

  /**
   * One recipe per active (and a few passives). `intensity` scales amplitude
   * (clamped 0..1.5). The same id+phase is dropped inside 60 ms.
   */
  skillVoice(id: string, phase: "cast" | "impact" = "cast", intensity = 1) {
    if (!this.live()) return;
    let k = intensity;
    if (!(k > 0)) return;
    if (k > 1.5) k = 1.5;
    const now = performance.now();
    const gate = phase === "impact" ? this.impactAt : this.castAt;
    const prev = gate.get(id);
    if (prev !== undefined && now - prev < 60) return;
    gate.set(id, now);
    const hit = phase === "impact";

    switch (id) {
      case "furious_cleave":
        if (hit) {
          this.note(180, 70, 0.06, "sawtooth", 0.24 * k);
          this.noise(0.045, 0.12 * k, "highpass", 2800, 700, 0.5);
          return;
        }
        this.noise(0.14, 0.2 * k, "bandpass", 2200, 220, 0.55);
        this.note(280, 90, 0.08, "sawtooth", 0.2 * k, 0.03);
        return;
      case "wrath_charge":
        if (hit) {
          this.note(62, 40, 0.1, "sine", 0.28 * k);
          this.noise(0.06, 0.16 * k, "lowpass", 220, 70, 0.7);
          return;
        }
        this.note(48, 120, 0.28, "sawtooth", 0.18 * k);
        this.noise(0.26, 0.1 * k, "lowpass", 80, 240, 0.7);
        return;
      case "war_cry":
        if (hit) {
          this.noise(0.07, 0.14 * k, "bandpass", 980, 520, 2.2);
          this.note(110, 70, 0.06, "sawtooth", 0.12 * k);
          return;
        }
        this.note(98, 70, 0.36, "sawtooth", 0.15 * k);
        this.note(106, 76, 0.34, "sawtooth", 0.12 * k);
        this.noise(0.3, 0.09 * k, "bandpass", 720, 1100, 3.2);
        this.noise(0.22, 0.05 * k, "bandpass", 1400, 1800, 4, 0.04);
        return;
      case "earthsplitter":
        if (hit) {
          this.note(42, 32, 0.18, "sine", 0.28 * k);
          this.noise(0.1, 0.18 * k, "lowpass", 640, 90, 0.55);
          return;
        }
        this.note(70, 46, 0.16, "sine", 0.14 * k);
        this.noise(0.14, 0.12 * k, "lowpass", 700, 160, 0.45);
        return;
      case "infernal_burst":
        if (hit) {
          this.noise(0.07, 0.16 * k, "highpass", 2800, 800, 0.55);
          this.note(100, 60, 0.06, "sine", 0.14 * k);
          return;
        }
        this.note(190, 46, 0.16, "sine", 0.24 * k);
        this.noise(0.08, 0.1 * k, "highpass", 2400, 900, 0.6, 0.02);
        this.noise(0.05, 0.08 * k, "highpass", 3600, 1400, 0.45, 0.07);
        return;
      case "lance_of_light":
        if (hit) {
          this.note(1480, 880, 0.14, "sine", 0.16 * k);
          this.note(2200, 1760, 0.1, "triangle", 0.06 * k);
          return;
        }
        this.note(2400, 640, 0.08, "sine", 0.14 * k);
        this.note(880, 880, 0.26, "sine", 0.13 * k, 0.05);
        this.note(1320, 1320, 0.18, "triangle", 0.05 * k, 0.06);
        return;
      case "grace":
        if (hit) return;
        this.note(523, 620, 0.18, "sine", 0.11 * k);
        this.note(659, 784, 0.18, "sine", 0.1 * k, 0.055);
        this.note(784, 932, 0.18, "sine", 0.09 * k, 0.11);
        this.note(1046, 1244, 0.2, "triangle", 0.08 * k, 0.165);
        return;
      case "pillar_of_flame":
        if (hit) {
          this.noise(0.13, 0.2 * k, "bandpass", 420, 2400, 0.65);
          this.note(130, 55, 0.1, "sawtooth", 0.14 * k);
          this.noise(0.06, 0.08 * k, "highpass", 1800, 700, 0.4, 0.02);
          return;
        }
        this.note(64, 190, 0.32, "sawtooth", 0.15 * k);
        this.noise(0.32, 0.13 * k, "bandpass", 180, 980, 0.75);
        return;
      case "halo":
        if (hit) return;
        this.note(330, 336, 0.48, "sine", 0.1 * k);
        this.note(495, 500, 0.46, "sine", 0.08 * k, 0.03);
        this.note(660, 654, 0.44, "sine", 0.06 * k, 0.06);
        this.note(248, 252, 0.4, "triangle", 0.04 * k, 0.02);
        return;
      case "gale_bolt":
        if (hit) {
          this.note(1900, 1100, 0.05, "sine", 0.1 * k);
          return;
        }
        this.note(880, 1680, 0.12, "sine", 0.13 * k);
        this.noise(0.12, 0.05 * k, "bandpass", 1100, 2200, 4.5);
        return;
      case "shadow_step":
        if (hit) {
          this.note(210, 140, 0.04, "sine", 0.16 * k);
          this.noise(0.035, 0.1 * k, "highpass", 3400, 1600, 0.45);
          return;
        }
        this.noise(0.12, 0.16 * k, "bandpass", 260, 2600, 1.1);
        return;
      case "snare_glyph":
        if (hit) {
          this.noise(0.045, 0.18 * k, "bandpass", 2000, 480, 1.8);
          this.note(150, 70, 0.055, "square", 0.12 * k);
          return;
        }
        this.note(2480, 2480, 0.04, "sine", 0.11 * k);
        this.note(3720, 3600, 0.03, "triangle", 0.04 * k);
        return;
      case "summon_shade":
        if (hit) return;
        this.note(96, 58, 0.42, "triangle", 0.15 * k);
        this.note(192, 116, 0.4, "sine", 0.05 * k);
        this.noise(0.38, 0.04 * k, "bandpass", 200, 110, 1.6);
        return;
      case "tempest":
        if (hit) {
          this.noise(0.08, 0.16 * k, "bandpass", 900, 380, 0.9);
          return;
        }
        this.noise(0.42, 0.17 * k, "bandpass", 260, 1700, 1.3);
        this.noise(0.34, 0.07 * k, "bandpass", 700, 280, 0.6, 0.04);
        return;
      case "whirl_ward":
        if (hit) {
          this.note(860, 740, 0.05, "triangle", 0.12 * k);
          return;
        }
        this.note(480, 640, 0.16, "triangle", 0.1 * k);
        this.note(720, 980, 0.15, "triangle", 0.08 * k, 0.045);
        this.note(1080, 1320, 0.13, "sine", 0.055 * k, 0.09);
        this.note(1560, 1720, 0.11, "triangle", 0.04 * k, 0.13);
        return;
      case "bastion":
        if (hit) {
          this.note(74, 48, 0.09, "sine", 0.22 * k);
          this.noise(0.06, 0.1 * k, "lowpass", 360, 80, 0.6);
          return;
        }
        this.note(86, 86, 0.46, "sine", 0.2 * k);
        this.note(172, 172, 0.28, "triangle", 0.07 * k);
        this.note(140, 300, 0.34, "sine", 0.09 * k, 0.02);
        return;
      case "thorns":
        this.note(hit ? 2800 : 3400, hit ? 1600 : 2200, 0.03, "square", 0.09 * k);
        this.noise(0.025, 0.06 * k, "highpass", 4200, 1800, 0.5);
        return;
      case "bloodthirst":
        if (hit) return;
        this.note(220, 340, 0.2, "sine", 0.09 * k);
        this.note(165, 230, 0.18, "triangle", 0.05 * k);
        return;
      case "last_stand":
        if (hit) {
          this.note(58, 40, 0.09, "sine", 0.24 * k);
          this.noise(0.05, 0.1 * k, "lowpass", 240, 60, 0.7);
          return;
        }
        this.note(62, 62, 0.4, "sine", 0.22 * k);
        this.note(124, 124, 0.26, "triangle", 0.07 * k);
        this.note(100, 380, 0.2, "sawtooth", 0.1 * k, 0.02);
        return;
      case "mana_deny":
        this.note(92, 84, hit ? 0.05 : 0.12, "square", (hit ? 0.06 : 0.08) * k);
        if (!hit) this.note(98, 90, 0.1, "square", 0.045 * k);
        return;
      default:
        this.skill(this.family(id));
    }
  }

  /** Same buckets as skillSfxKind, for ids without their own recipe. */
  private family(id: string): "melee" | "fire" | "wind" | "holy" | "shadow" | "buff" {
    switch (id) {
      case "furious_cleave":
      case "wrath_charge":
      case "war_cry":
      case "earthsplitter":
      case "thorns":
        return "melee";
      case "infernal_burst":
      case "pillar_of_flame":
        return "fire";
      case "gale_bolt":
      case "tempest":
        return "wind";
      case "shadow_step":
      case "snare_glyph":
      case "summon_shade":
        return "shadow";
      case "whirl_ward":
      case "bastion":
        return "buff";
      default:
        return "holy";
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

  /** Pitch glide, short linear attack, exponential decay. `delay` is seconds from currentTime. */
  private note(from: number, to: number, dur: number, type: OscType, amp: number, delay = 0) {
    const ctx = this.live();
    if (!ctx || !this.master) return;
    if (!(amp > 0.001) || !(dur > 0)) return;
    if (amp > 0.35) amp = 0.35;
    const t0 = ctx.currentTime + (delay > 0 ? delay : 0);
    const atk = Math.min(0.018, Math.max(0.003, dur * 0.22));
    const end = dur > atk + 0.008 ? dur : atk + 0.008;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    const a = from < 20 ? 20 : from > 12000 ? 12000 : from;
    const b = to < 20 ? 20 : to > 12000 ? 12000 : to;
    o.frequency.setValueAtTime(a, t0);
    if (b !== a) o.frequency.exponentialRampToValueAtTime(b, t0 + end);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(amp, t0 + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + end);
    o.connect(g);
    g.connect(this.master);
    o.start(t0);
    o.stop(t0 + end + 0.02);
    o.onended = () => {
      o.disconnect();
      g.disconnect();
    };
  }

  /** Cached ~1 s white noise through a sweeping biquad and an exponential gain envelope. */
  private noise(dur: number, amp: number, filterType: BiquadFilterType, f0: number, f1: number, q: number, delay = 0) {
    const ctx = this.live();
    if (!ctx || !this.master) return;
    if (!(amp > 0.001) || !(dur > 0)) return;
    if (amp > 0.35) amp = 0.35;
    const t0 = ctx.currentTime + (delay > 0 ? delay : 0);
    const atk = dur > 0.03 ? 0.008 : dur * 0.3;
    const end = dur > atk + 0.008 ? dur : atk + 0.008;
    const src = ctx.createBufferSource();
    src.buffer = this.white(ctx);
    src.loop = end > 0.9;
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.Q.setValueAtTime(q > 0.0001 ? q : 0.0001, t0);
    const a = f0 < 20 ? 20 : f0 > 12000 ? 12000 : f0;
    const b = f1 < 20 ? 20 : f1 > 12000 ? 12000 : f1;
    filter.frequency.setValueAtTime(a, t0);
    if (b !== a) filter.frequency.exponentialRampToValueAtTime(b, t0 + end);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(amp, t0 + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + end);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.master);
    src.start(t0);
    src.stop(t0 + end + 0.02);
    src.onended = () => {
      src.disconnect();
      filter.disconnect();
      g.disconnect();
    };
  }

  private white(ctx: AudioContext): AudioBuffer {
    if (this.noiseBuf && this.noiseCtx === ctx) return this.noiseBuf;
    const n = ctx.sampleRate;
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
    this.noiseCtx = ctx;
    return buf;
  }

  private live(): AudioContext | null {
    if (this.muted || document.hidden) return null;
    const ctx = this.ctx;
    if (!ctx || ctx.state !== "running" || !this.master) return null;
    return ctx;
  }
}
