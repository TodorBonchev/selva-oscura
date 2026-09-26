/**
 * Lust storm geometry — the client twin of server/src/cantoMech/lustGeo.mjs (keep the
 * constants and formulas identical: prediction, the server and the self-play bot must
 * agree on where the lee is and where a rock stops you).
 */

export type Windbreak = { x: number; y: number; r: number };
export type P2 = { x: number; y: number };

export function leeLen(r: number): number {
  return 2.2 + r * 1.8;
}

export function leeHalf(r: number, along: number): number {
  const total = r + leeLen(r);
  return r * 0.92 * (1 - 0.45 * Math.max(0, Math.min(1, along / total)));
}

export function inLee(wbs: Windbreak[] | null, wx: number, wy: number, x: number, y: number): boolean {
  if (!wbs) return false;
  for (let i = 0; i < wbs.length; i++) {
    const w = wbs[i]!;
    const vx = x - w.x;
    const vy = y - w.y;
    const along = vx * wx + vy * wy;
    if (along < 0) continue;
    const r = w.r;
    if (along > r + leeLen(r)) continue;
    const perp = Math.abs(vx * wy - vy * wx);
    if (perp <= leeHalf(r, along)) return true;
  }
  return false;
}

/** Push p (mutated) out of every windbreak (radius + pad); true if it moved. */
export function pushOutOfRocks(wbs: Windbreak[] | null, p: P2, pad: number): boolean {
  let hit = false;
  if (!wbs) return hit;
  for (let i = 0; i < wbs.length; i++) {
    const w = wbs[i]!;
    const min = w.r + pad;
    const dx = p.x - w.x;
    const dy = p.y - w.y;
    if (Math.abs(dx) >= min || Math.abs(dy) >= min) continue;
    const d = Math.hypot(dx, dy);
    if (d >= min) continue;
    if (d < 1e-4) {
      p.x = w.x + min;
      hit = true;
      continue;
    }
    p.x = w.x + (dx / d) * min;
    p.y = w.y + (dy / d) * min;
    hit = true;
  }
  return hit;
}

/** First t in [0,1] along a→b where a body of radius pad touches a windbreak (1 = clear). */
export function sweepRocks(wbs: Windbreak[] | null, ax: number, ay: number, bx: number, by: number, pad: number): number {
  let best = 1;
  if (!wbs) return best;
  const dx = bx - ax;
  const dy = by - ay;
  const a = dx * dx + dy * dy;
  if (a < 1e-8) return best;
  for (let i = 0; i < wbs.length; i++) {
    const w = wbs[i]!;
    const R = w.r + pad;
    const fx = ax - w.x;
    const fy = ay - w.y;
    const c = fx * fx + fy * fy - R * R;
    if (c <= 0) continue;
    const b = 2 * (fx * dx + fy * dy);
    const disc = b * b - 4 * a * c;
    if (disc < 0) continue;
    const t = (-b - Math.sqrt(disc)) / (2 * a);
    if (t >= 0 && t < best) best = t;
  }
  return best;
}

export const STORM = {
  warn: 1.2,
  rampIn: 0.35,
  rampOut: 0.45,
};

export const PLAYER_DRIFT = 3.0;
export const UPWIND_MUL = 0.6;
export const DOWNWIND_MUL = 1.25;
export const DASH_DOWNWIND = 0.5;
export const PLAYER_PAD = 0.45;

export function gustEnvelope(elapsed: number, left: number, power = 1): number {
  const a = Math.min(1, Math.max(0, elapsed / STORM.rampIn));
  const b = Math.min(1, Math.max(0, left / STORM.rampOut));
  return a * b * power;
}

/** Walk speed multiplier so walk × mul + drift nets 0.6× upwind, 1.25× downwind. */
export function walkMul(mx: number, my: number, wx: number, wy: number, s: number): number {
  const a = mx * wx + my * wy;
  const drift = (PLAYER_DRIFT * s * a) / 8;
  const net = a >= 0 ? 1 + (DOWNWIND_MUL - 1) * a * s : 1 - (1 - UPWIND_MUL) * -a * s;
  return Math.max(0.2, net - drift);
}
