/** Client-side prediction / interpolation helpers (server remains authoritative). */

export type Vec2 = { x: number; y: number };

/** Throttle for move packets — slightly slower than before to cut rubber-band chatter. */
export const MOVE_SEND_MS = 50;
/** World units — hard snap only on large desync (was 3.2; caused teleports). */
export const SNAP_ERROR = 5.5;
/** Soft correction toward server while predicting (per second) — keep gentle. */
export const RECONCILE_PREDICT = 1.2;
/** While predicting, correction that opposes local velocity is scaled by this. */
export const RECONCILE_OPPOSE_MUL = 0.35;
/** Stronger correction when idle (per second). */
export const RECONCILE_IDLE = 9;
/** Camera follow rate (per second, dt-based exponential approach). Desktop is a bit tighter. */
export const CAM_LERP_MOBILE = 6.5;
export const CAM_LERP_DESKTOP = 8;

export function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function lerpVec(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
}

/** Exponential approach: 1 - e^(-k*dt). */
export function expAlpha(rate: number, dtSec: number): number {
  return 1 - Math.exp(-rate * Math.max(0, dtSec));
}

/**
 * Nudge render toward server. Hard-snaps only on large error.
 * While predicting, correction is soft so local motion stays smooth, and the
 * part of the pull that opposes local velocity is damped so prediction and
 * reconcile never visibly fight (no backwards stutter mid-stride).
 */
export function reconcileLocal(
  render: Vec2,
  server: Vec2,
  dtSec: number,
  predicting: boolean,
  vel?: Vec2
): Vec2 {
  const err = dist(render, server);
  if (err > SNAP_ERROR) return { x: server.x, y: server.y };
  if (!predicting && err < 0.02) return { x: server.x, y: server.y };
  const rate = predicting ? RECONCILE_PREDICT : RECONCILE_IDLE;
  const a = expAlpha(rate, dtSec);
  let cx = (server.x - render.x) * a;
  let cy = (server.y - render.y) * a;
  if (predicting && vel) {
    const sp = Math.hypot(vel.x, vel.y);
    if (sp > 0.01) {
      const ux = vel.x / sp;
      const uy = vel.y / sp;
      const along = cx * ux + cy * uy;
      if (along < 0) {
        // Keep the perpendicular part; soften the backwards part.
        cx += ux * along * (RECONCILE_OPPOSE_MUL - 1);
        cy += uy * along * (RECONCILE_OPPOSE_MUL - 1);
      }
    }
  }
  return { x: render.x + cx, y: render.y + cy };
}

/** Samples kept per entity (≈1 s of snapshots at the server's ~7.5 Hz cadence). */
const INTERP_N = 8;
/** Render this long behind the newest snapshot (adapted to the measured cadence). */
const INTERP_DELAY_MIN = 100;
const INTERP_DELAY_MAX = 180;
/** Past the newest sample, keep moving on its velocity this long, then hold. */
const EXTRAPOLATE_MS = 140;
/** A jump this far between two samples is a teleport (respawn, leash snap): no glide. */
const TELEPORT = 6;

type Track = {
  ts: Float64Array;
  xs: Float32Array;
  ys: Float32Array;
  /** samples held (≤ INTERP_N); newest at head */
  n: number;
  head: number;
  /** render position (a stable object: callers may hold it for the frame) */
  pos: Vec2;
  vx: number;
  vy: number;
  stamp: number;
};

/**
 * Snapshot interpolation for mobs and remote pilgrims: every entity is drawn ~one
 * snapshot interval in the past, between the two server samples around that time, so
 * motion is continuous instead of pulsing at the snapshot rate. Samples are placed on
 * the server clock (`room.st`, the tick that produced the positions) mapped to local
 * time with a jitter-proof minimum offset, so a late packet doesn't bend the path.
 * Past the newest sample it extrapolates briefly, then holds.
 * Allocation-free per frame; the local player keeps its own prediction.
 */
export class InterpStore {
  private tracks = new Map<string, Track>();
  private pool: Track[] = [];
  private offset = NaN;
  private lastServer = NaN;
  private intervalEma = 130;
  private sampleT = 0;
  private stamp = 0;
  /** Current render delay (ms). */
  delay = 140;

  /** Start a snapshot's samples. serverMs = room.st (undefined on old servers). */
  beginSnapshot(serverMs: number | undefined, nowMs: number) {
    this.stamp++;
    if (typeof serverMs === "number" && Number.isFinite(serverMs)) {
      const off = nowMs - serverMs;
      // min filter, creeping up slowly so clock drift can't strand us in the past
      if (!Number.isFinite(this.offset) || off < this.offset) this.offset = off;
      else this.offset += Math.min(off - this.offset, 0.4);
      if (Number.isFinite(this.lastServer) && serverMs > this.lastServer) {
        const iv = Math.min(400, serverMs - this.lastServer);
        this.intervalEma += (iv - this.intervalEma) * 0.1;
        this.delay = Math.max(INTERP_DELAY_MIN, Math.min(INTERP_DELAY_MAX, this.intervalEma + 12));
      }
      if (!(serverMs < this.lastServer)) this.lastServer = serverMs;
      this.sampleT = serverMs + this.offset;
    } else {
      this.sampleT = nowMs;
    }
  }

  /** Add one entity's position to the snapshot begun above. */
  push(id: string, x: number, y: number) {
    let t = this.tracks.get(id);
    if (!t) {
      t = this.pool.pop() ?? {
        ts: new Float64Array(INTERP_N),
        xs: new Float32Array(INTERP_N),
        ys: new Float32Array(INTERP_N),
        n: 0,
        head: 0,
        pos: { x: 0, y: 0 },
        vx: 0,
        vy: 0,
        stamp: 0,
      };
      t.n = 0;
      t.head = 0;
      t.vx = 0;
      t.vy = 0;
      t.pos.x = x;
      t.pos.y = y;
      this.tracks.set(id, t);
    }
    t.stamp = this.stamp;
    const ts = this.sampleT;
    if (t.n > 0) {
      const h = t.head;
      if (Math.hypot(x - t.xs[h]!, y - t.ys[h]!) > TELEPORT) {
        t.n = 0;
        t.pos.x = x;
        t.pos.y = y;
        t.vx = 0;
        t.vy = 0;
      } else if (ts <= t.ts[h]!) {
        // same server tick sent twice (event snapshot): refresh, don't add a sample
        t.xs[h] = x;
        t.ys[h] = y;
        return;
      }
    }
    t.head = t.n === 0 ? 0 : (t.head + 1) % INTERP_N;
    t.ts[t.head] = ts;
    t.xs[t.head] = x;
    t.ys[t.head] = y;
    if (t.n < INTERP_N) t.n++;
  }

  /** Forget entities the snapshot no longer lists. */
  endSnapshot() {
    for (const [id, t] of this.tracks) {
      if (t.stamp === this.stamp) continue;
      this.tracks.delete(id);
      if (this.pool.length < 64) this.pool.push(t);
    }
  }

  /** Advance every render position to now − delay. */
  update(nowMs: number) {
    const rt = nowMs - this.delay;
    for (const t of this.tracks.values()) {
      if (t.n === 0) continue;
      const h = t.head;
      if (t.n === 1 || rt <= t.ts[(h - t.n + 1 + INTERP_N) % INTERP_N]!) {
        const o = t.n === 1 ? h : (h - t.n + 1 + INTERP_N) % INTERP_N;
        t.pos.x = t.xs[o]!;
        t.pos.y = t.ys[o]!;
        t.vx = 0;
        t.vy = 0;
        continue;
      }
      if (rt >= t.ts[h]!) {
        // past the newest sample: glide on its velocity for a moment, then hold
        const p = (h - 1 + INTERP_N) % INTERP_N;
        const dt = t.ts[h]! - t.ts[p]!;
        const vx = dt > 1 ? (t.xs[h]! - t.xs[p]!) / dt : 0;
        const vy = dt > 1 ? (t.ys[h]! - t.ys[p]!) / dt : 0;
        const ex = Math.min(EXTRAPOLATE_MS, rt - t.ts[h]!);
        t.pos.x = t.xs[h]! + vx * ex;
        t.pos.y = t.ys[h]! + vy * ex;
        const moving = rt - t.ts[h]! < EXTRAPOLATE_MS;
        t.vx = moving ? vx * 1000 : 0;
        t.vy = moving ? vy * 1000 : 0;
        continue;
      }
      // newest-first search for the pair around rt
      let i = h;
      for (let k = 1; k < t.n; k++) {
        const j = (i - 1 + INTERP_N) % INTERP_N;
        if (t.ts[j]! <= rt) {
          const t0 = t.ts[j]!;
          const t1 = t.ts[i]!;
          const u = t1 > t0 ? (rt - t0) / (t1 - t0) : 1;
          t.pos.x = t.xs[j]! + (t.xs[i]! - t.xs[j]!) * u;
          t.pos.y = t.ys[j]! + (t.ys[i]! - t.ys[j]!) * u;
          const span = Math.max(1, t1 - t0);
          t.vx = ((t.xs[i]! - t.xs[j]!) / span) * 1000;
          t.vy = ((t.ys[i]! - t.ys[j]!) / span) * 1000;
          break;
        }
        i = j;
      }
    }
  }

  /** Render position (a stable per-entity object), or undefined before its first sample. */
  get(id: string): Vec2 | undefined {
    return this.tracks.get(id)?.pos;
  }

  /** Render position, or `fallback` itself when unknown (no allocation either way). */
  pos(id: string, fallback: Vec2): Vec2 {
    return this.tracks.get(id)?.pos ?? fallback;
  }

  /**
   * Replace an entity's render position/velocity for this frame (call after update();
   * the next update() recomputes it from the samples). False when it has no track.
   */
  override(id: string, x: number, y: number, vx: number, vy: number): boolean {
    const t = this.tracks.get(id);
    if (!t || t.n === 0) return false;
    t.pos.x = x;
    t.pos.y = y;
    t.vx = vx;
    t.vy = vy;
    return true;
  }

  /** Render velocity (units/s) into `out` (0,0 when unknown). */
  vel(id: string, out: Vec2): Vec2 {
    const t = this.tracks.get(id);
    out.x = t ? t.vx : 0;
    out.y = t ? t.vy : 0;
    return out;
  }

  clear() {
    for (const t of this.tracks.values()) if (this.pool.length < 64) this.pool.push(t);
    this.tracks.clear();
  }
}
