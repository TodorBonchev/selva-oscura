/**
 * Render quality tiers, adaptive resolution and 60fps pacing.
 *
 * The tier is picked once from the layout heuristic (compact → low, else high) unless
 * `?gfx=low|mid|high|auto` (remembered in localStorage) overrides it. At runtime the
 * FrameGovernor watches frame times: it first trades resolution inside the tier's
 * [minRatio, maxRatio] band, and only when frames stay slow at the floor ratio does it
 * step the tier down (high → mid → low). It never steps up, so it cannot flip-flop.
 *
 * Tiers (all keep the same scene content and the same lean post chain — scene into a
 * HalfFloat target, one tone-map/hit-flash pass — so transparent/additive effects blend
 * in linear light exactly as before; only shading cost changes):
 *  - high: + bloom (3 mips), sun shadows near the hero.
 *  - mid:  no bloom, no shadows (disc shadows only).
 *  - low:  anisotropy 1 (the floor's two map fetches dominate phone GPU time), two
 *          pooled point lights instead of three (plus the hero's lantern on every tier).
 * (Rendering straight to the canvas measured ~1ms cheaper on phones but blends
 * additive/transparent layers in sRGB space — portals, gale ribbons and disc shadows
 * visibly changed — so every tier keeps the linear target.)
 */
export type Tier = "low" | "mid" | "high";

export type TierFlags = {
  tier: Tier;
  bloom: boolean;
  shadows: boolean;
  anisotropy: number;
  maxRatio: number;
  minRatio: number;
  /** Pooled scene point lights (the hero lantern is extra and always on). */
  pointLights: number;
};

const ORDER: Tier[] = ["low", "mid", "high"];
const STORE_KEY = "selva.gfx";

export function flagsFor(tier: Tier, compact: boolean): TierFlags {
  if (tier === "high") {
    return {
      tier,
      bloom: true,
      shadows: true,
      anisotropy: 4,
      maxRatio: compact ? 1.25 : 1.5,
      minRatio: 0.8,
      pointLights: 3,
    };
  }
  if (tier === "mid") {
    return {
      tier,
      bloom: false,
      shadows: false,
      anisotropy: 2,
      maxRatio: compact ? 1.2 : 1.25,
      minRatio: 0.75,
      pointLights: 3,
    };
  }
  return {
    tier,
    bloom: false,
    shadows: false,
    anisotropy: 1,
    maxRatio: compact ? 1.2 : 1.1,
    minRatio: 0.72,
    // Each point light is ~4% of a phone frame (every lit pixel loops over all of them)
    pointLights: 2,
  };
}

function readOverride(): Tier | null {
  let q: string | null = null;
  try {
    q = new URLSearchParams(location.search).get("gfx");
  } catch {
    q = null;
  }
  try {
    if (q === "auto") localStorage.removeItem(STORE_KEY);
    else if (q && (ORDER as string[]).includes(q)) localStorage.setItem(STORE_KEY, q);
  } catch {
    /* storage blocked — the URL still applies to this page */
  }
  if (q && (ORDER as string[]).includes(q)) return q as Tier;
  if (q === "auto") return null;
  try {
    const s = localStorage.getItem(STORE_KEY);
    if (s && (ORDER as string[]).includes(s)) return s as Tier;
  } catch {
    /* ignore */
  }
  return null;
}

/** Initial tier: explicit override, else phones/compact → low, everything else → high. */
export function pickInitialTier(compact: boolean): { tier: Tier; pinned: boolean } {
  const o = readOverride();
  if (o) return { tier: o, pinned: true };
  return { tier: compact ? "low" : "high", pinned: false };
}

export function lowerTier(t: Tier): Tier | null {
  const i = ORDER.indexOf(t);
  return i > 0 ? ORDER[i - 1] : null;
}

/** Target frame interval for the 60fps cap (120Hz+ displays skip every other vsync). */
export const FRAME_MS = 1000 / 60;
/** Run a frame once this much time has accumulated (~15.5ms): a 60Hz vsync always passes. */
const PACE_MS = FRAME_MS - 1.2;

/**
 * 60fps pacer. Accumulates rAF deltas so 90/120/144Hz displays average 60 frames a
 * second instead of dropping to 40–45 on quantised skips.
 */
export class FramePacer {
  private acc = 0;
  private last = -1;

  /** Returns true when a frame should be simulated + drawn for this rAF callback. */
  shouldRun(now: number): boolean {
    if (this.last < 0) {
      this.last = now;
      return true;
    }
    const d = now - this.last;
    this.last = now;
    // Tab switch / long stall: run immediately and forget the backlog
    if (d > 250) {
      this.acc = 0;
      return true;
    }
    this.acc += d;
    if (this.acc < PACE_MS) return false;
    this.acc = Math.max(0, Math.min(FRAME_MS, this.acc - FRAME_MS));
    return true;
  }
}

export type GovernorEvent = { ratio?: number; tier?: Tier };

/**
 * Frame-time driven resolution + tier controller. Feed it the interval between executed
 * frames; it returns a change request at most every ~1.2s.
 *
 * - Slow (EMA > 19ms, i.e. under ~52fps): ratio × 0.9 down to minRatio.
 * - Still slow (EMA > 21ms) for 3s at minRatio: one tier down (not when pinned).
 * - Fast (EMA < 17.4ms) for 5s: ratio × 1.06 up to the ceiling. A raise that is followed
 *   by a drop within 6s lowers the ceiling to the dropped-to ratio, so it settles instead
 *   of oscillating.
 * - If three drops in a row (≈half the pixels), or a run that hit the lowest tier's
 *   floor, have not shortened frames by ≥5%, the limit is not fill rate (a 30Hz
 *   low-power rAF cap, or CPU-bound): the ratio goes back and drops pause (1 min, then
 *   longer), so the game is not blurred for nothing. A run that reaches the floor of a
 *   higher tier still steps the tier down (shadows/bloom also cost CPU). One step alone
 *   can hide behind vsync quantisation, hence judging runs, not single drops.
 */
export class FrameGovernor {
  ema = FRAME_MS;
  ratio: number;
  ceiling: number;
  private fastFor = 0;
  private slowFor = 0;
  private floorSlowFor = 0;
  private cooldown = 2;
  private lastRaiseAt = -1e9;
  private clock = 0;
  /** Current run of drops: frame time and ratio when it started. */
  private descent: { ema: number; startRatio: number; steps: number } | null = null;
  private blockDrops = 0;
  private failedRuns = 0;

  constructor(
    public flags: TierFlags,
    ratio: number,
    public dpr: number,
    public pinned: boolean
  ) {
    this.ceiling = this.maxFor(flags);
    this.ratio = Math.min(ratio, this.ceiling);
  }

  maxFor(flags: TierFlags): number {
    return Math.min(flags.maxRatio, Math.max(flags.minRatio, this.dpr));
  }

  /** Window moved to a screen with another DPR: re-derive the cap. */
  setDpr(dpr: number) {
    if (dpr === this.dpr) return;
    this.dpr = dpr;
    this.ceiling = this.maxFor(this.flags);
    this.ratio = Math.min(this.ratio, this.ceiling);
  }

  setFlags(flags: TierFlags) {
    this.flags = flags;
    this.ceiling = this.maxFor(flags);
    this.ratio = Math.min(Math.max(this.ratio, flags.minRatio), this.ceiling);
    this.ema = FRAME_MS;
    this.fastFor = this.slowFor = this.floorSlowFor = 0;
    this.cooldown = 2.5;
    this.descent = null;
  }

  /** Pause adaptation briefly (canto rebuild / shader warm-up spikes). */
  hold(sec: number) {
    this.cooldown = Math.max(this.cooldown, sec);
    this.slowFor = this.floorSlowFor = 0;
  }

  /** `ms` = time since the previous executed frame. */
  sample(ms: number): GovernorEvent | null {
    const sec = ms / 1000;
    this.clock += sec;
    if (ms > 120) return null; // hitch (GC, compile, tab) — not a steady-state signal
    this.ema += (ms - this.ema) * 0.06;
    if (this.blockDrops > 0) this.blockDrops -= sec;
    if (this.cooldown > 0) {
      this.cooldown -= sec;
      return null;
    }
    const run = this.descent;
    const minR = Math.min(this.flags.minRatio, this.ceiling);
    const atFloor = this.ratio <= minR + 0.005;
    if (run) {
      const canStepTier = atFloor && !this.pinned && lowerTier(this.flags.tier) != null;
      if (this.ema < run.ema * 0.95) this.descent = null; // fill-bound: drops pay off
      else if ((run.steps >= 3 || atFloor) && !canStepTier) {
        this.descent = null;
        this.ratio = run.startRatio;
        this.blockDrops = 60 * 2 ** this.failedRuns++;
        this.slowFor = this.floorSlowFor = 0;
        this.cooldown = 1.2;
        return { ratio: this.ratio };
      }
    }
    const slow = this.ema > 19;
    const fast = this.ema < 17.4;
    this.slowFor = slow && this.blockDrops <= 0 ? this.slowFor + sec : 0;
    this.fastFor = fast ? this.fastFor + sec : 0;
    if (this.slowFor > 1.2) {
      this.slowFor = 0;
      if (this.ratio > minR + 0.005) {
        if (this.clock - this.lastRaiseAt < 6) this.ceiling = Math.max(minR, this.ratio * 0.9);
        if (!this.descent) this.descent = { ema: this.ema, startRatio: this.ratio, steps: 0 };
        this.descent.steps++;
        this.ratio = Math.max(minR, this.ratio * 0.9);
        this.cooldown = 1.2;
        return { ratio: this.ratio };
      }
    }
    if (atFloor && this.ema > 21 && this.blockDrops <= 0) this.floorSlowFor += sec;
    else this.floorSlowFor = Math.max(0, this.floorSlowFor - sec);
    if (!this.pinned && this.floorSlowFor > 3) {
      this.floorSlowFor = 0;
      const next = lowerTier(this.flags.tier);
      if (next) {
        this.cooldown = 3;
        return { tier: next };
      }
    }
    if (this.fastFor > 5 && this.ratio < this.ceiling - 0.005) {
      this.fastFor = 0;
      this.ratio = Math.min(this.ceiling, this.ratio * 1.06);
      this.lastRaiseAt = this.clock;
      this.cooldown = 1.2;
      return { ratio: this.ratio };
    }
    return null;
  }
}
