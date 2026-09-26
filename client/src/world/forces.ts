/**
 * External forces on the local pilgrim's predicted movement: shoves (impulses a canto
 * mechanic or a heavy blow applies — server {type:"shove"}), and slow / root statuses
 * ({type:"status"}). WorldApp folds these into its movement integration next to the
 * canto mechanic's moveFeel drift, so prediction moves the way the server budgets it
 * (room.handleMove allows the shove distance and caps a slowed step).
 * A shove is played as a displacement on wall-clock time (not a velocity × the frame's
 * dt): hit-stop, which always comes with the blow that shoves, and low frame rates
 * can't shorten it — it lands exactly where the server put you.
 * Fixed slots, no allocation per frame.
 */
import type { Vec2 } from "../render/smoothing";

const SHOVES = 4;

/** e(u): share of the shove done at progress u (ease-out, most of it up front). */
const ease = (u: number) => (u <= 0 ? 0 : u >= 1 ? 1 : 1 - (1 - u) * (1 - u));

type Shove = { dx: number; dy: number; start: number; dur: number; active: boolean; done: number };

export class PlayerForces {
  private shoves: Shove[] = [];
  private slow = 1;
  private root = false;
  private statusUntil = 0;

  constructor() {
    for (let i = 0; i < SHOVES; i++) this.shoves.push({ dx: 0, dy: 0, start: 0, dur: 1, active: false, done: 0 });
  }

  /** Push (dx, dy) world units over durMs (ease-out: most of it up front). */
  shove(dx: number, dy: number, durMs: number, nowMs: number) {
    let s = this.shoves.find((x) => !x.active);
    if (!s) s = this.shoves.reduce((a, b) => (a.start < b.start ? a : b));
    s.dx = dx;
    s.dy = dy;
    s.dur = Math.max(30, durMs);
    s.start = nowMs;
    s.active = true;
    s.done = 0;
  }

  /** Slow (speed multiplier) and/or root for durMs. */
  status(slow: number, root: boolean, durMs: number, nowMs: number) {
    this.slow = Math.max(0.05, Math.min(1, Number(slow) || 1));
    this.root = Boolean(root);
    this.statusUntil = nowMs + Math.max(0, durMs);
  }

  /** Walking speed multiplier now (0 while rooted). */
  speedMul(nowMs: number): number {
    if (nowMs >= this.statusUntil) return 1;
    return this.root ? 0 : this.slow;
  }

  rooted(nowMs: number): boolean {
    return this.root && nowMs < this.statusUntil;
  }

  /**
   * Planar displacement the live shoves add since the last call (call once per frame;
   * the frame's first movement substep applies it). Sums to exactly (dx, dy) per shove.
   */
  displacement(out: Vec2, nowMs: number): Vec2 {
    out.x = 0;
    out.y = 0;
    for (const s of this.shoves) {
      if (!s.active) continue;
      const e = ease((nowMs - s.start) / s.dur);
      const k = e - s.done;
      s.done = e;
      out.x += s.dx * k;
      out.y += s.dy * k;
      if (e >= 1) s.active = false;
    }
    return out;
  }

  clear() {
    for (const s of this.shoves) s.active = false;
    this.statusUntil = 0;
    this.root = false;
    this.slow = 1;
  }
}
