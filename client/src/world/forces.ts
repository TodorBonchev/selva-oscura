/**
 * External forces on the local pilgrim's predicted movement: shoves (impulses a canto
 * mechanic or a heavy blow applies — server {type:"shove"}), and slow / root statuses
 * ({type:"status"}). WorldApp folds these into its velocity integration next to the
 * canto mechanic's moveFeel drift, so prediction moves the way the server budgets it
 * (room.handleMove allows the shove distance and caps a slowed step).
 * Fixed slots, no allocation per frame.
 */
import type { Vec2 } from "../render/smoothing";

const SHOVES = 4;

type Shove = { dx: number; dy: number; start: number; dur: number; active: boolean };

export class PlayerForces {
  private shoves: Shove[] = [];
  private slow = 1;
  private root = false;
  private statusUntil = 0;

  constructor() {
    for (let i = 0; i < SHOVES; i++) this.shoves.push({ dx: 0, dy: 0, start: 0, dur: 1, active: false });
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

  /** Planar velocity (u/s) the live shoves add this frame. */
  velocity(out: Vec2, nowMs: number): Vec2 {
    out.x = 0;
    out.y = 0;
    for (const s of this.shoves) {
      if (!s.active) continue;
      const u = (nowMs - s.start) / s.dur;
      if (u >= 1 || u < 0) {
        s.active = false;
        continue;
      }
      // v(t) = 2·d/dur·(1 − t/dur): integrates to exactly d over the shove
      const k = (2 * (1 - u) * 1000) / s.dur;
      out.x += s.dx * k;
      out.y += s.dy * k;
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
