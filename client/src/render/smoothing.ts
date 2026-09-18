/** Client-side prediction / interpolation helpers (server remains authoritative). */

export type Vec2 = { x: number; y: number };

/** Throttle for move packets — slightly slower than before to cut rubber-band chatter. */
export const MOVE_SEND_MS = 50;
/** World units — hard snap only on large desync (was 3.2; caused teleports). */
export const SNAP_ERROR = 5.5;
/** Soft correction toward server while predicting (per second) — keep gentle. */
export const RECONCILE_PREDICT = 2.2;
/** Stronger correction when idle (per second). */
export const RECONCILE_IDLE = 9;
/** Remote / mob exponential smooth rate (per second). */
export const REMOTE_SMOOTH = 12;
/** Soft camera follow (mobile). Desktop snaps harder. */
export const CAM_LERP_MOBILE = 0.09;
export const CAM_LERP_DESKTOP = 0.18;

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
 * While predicting, correction is soft so local motion stays smooth.
 */
export function reconcileLocal(
  render: Vec2,
  server: Vec2,
  dtSec: number,
  predicting: boolean
): Vec2 {
  const err = dist(render, server);
  if (err > SNAP_ERROR) return { x: server.x, y: server.y };
  if (err < 0.02) return { x: server.x, y: server.y };
  const rate = predicting ? RECONCILE_PREDICT : RECONCILE_IDLE;
  const a = expAlpha(rate, dtSec);
  return lerpVec(render, server, a);
}

/** Smooth remote entity toward last known server pos. */
export function smoothToward(current: Vec2 | null, target: Vec2, dtSec: number): Vec2 {
  if (!current) return { x: target.x, y: target.y };
  const err = dist(current, target);
  if (err > SNAP_ERROR * 1.5) return { x: target.x, y: target.y };
  const a = expAlpha(REMOTE_SMOOTH, dtSec);
  return lerpVec(current, target, a);
}

export class SmoothStore {
  private map = new Map<string, Vec2>();

  get(id: string): Vec2 | null {
    return this.map.get(id) ?? null;
  }

  set(id: string, v: Vec2) {
    this.map.set(id, v);
  }

  /** Advance all ids present in targets; drop stale. */
  tick(targets: Map<string, Vec2> | Iterable<[string, Vec2]>, dtSec: number) {
    const seen = new Set<string>();
    for (const [id, target] of targets as Iterable<[string, Vec2]>) {
      seen.add(id);
      this.map.set(id, smoothToward(this.map.get(id) ?? null, target, dtSec));
    }
    for (const id of [...this.map.keys()]) {
      if (!seen.has(id)) this.map.delete(id);
    }
  }

  clear() {
    this.map.clear();
  }

  pos(id: string, fallback: Vec2): Vec2 {
    return this.map.get(id) ?? fallback;
  }
}
