/**
 * Lust storm geometry, shared by the server mechanic (lust.mjs) and the self-play bot
 * (scripts/selfplayMech/lust.mjs). The client mirrors it in client/src/world/lustGeo.ts
 * — keep the constants and formulas identical so prediction, bot and server agree.
 *
 * Windbreaks are storm-worn rock islands: solid circles {x, y, r} (canto JSON
 * geo.windbreaks). Downwind of each one lies its lee — a tapering cone where the gust
 * cannot reach:
 *
 *        wind →      ( rock )=======>   lee: 0 ≤ along ≤ r + leeLen(r),
 *                                            |perp| ≤ leeHalf(r, along)
 */

/** Lee length past the rock's rim (world units). */
export function leeLen(r) {
  return 2.2 + r * 1.8;
}

/** Half width of the lee at `along` units downwind of the rock's centre. */
export function leeHalf(r, along) {
  const total = r + leeLen(r);
  return r * 0.92 * (1 - 0.45 * Math.max(0, Math.min(1, along / total)));
}

/** Is (x, y) sheltered from wind (wx, wy) (unit) by any windbreak? */
export function inLee(wbs, wx, wy, x, y) {
  if (!wbs) return false;
  for (let i = 0; i < wbs.length; i++) {
    const w = wbs[i];
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

/**
 * Push point p ({x, y}, mutated) out of every windbreak (radius + pad). Returns the
 * windbreak it was pushed out of last (or null).
 */
export function pushOutOfRocks(wbs, p, pad) {
  let hit = null;
  if (!wbs) return hit;
  for (let i = 0; i < wbs.length; i++) {
    const w = wbs[i];
    const min = w.r + pad;
    const dx = p.x - w.x;
    const dy = p.y - w.y;
    if (Math.abs(dx) >= min || Math.abs(dy) >= min) continue;
    const d = Math.hypot(dx, dy);
    if (d >= min) continue;
    if (d < 1e-4) {
      p.x = w.x + min;
      hit = w;
      continue;
    }
    p.x = w.x + (dx / d) * min;
    p.y = w.y + (dy / d) * min;
    hit = w;
  }
  return hit;
}

/**
 * First point along the segment a→b (dash) where a body of radius `pad` would touch a
 * windbreak: returns t in [0, 1] (1 = the whole segment is clear).
 */
export function sweepRocks(wbs, ax, ay, bx, by, pad) {
  let best = 1;
  if (!wbs) return best;
  const dx = bx - ax;
  const dy = by - ay;
  const a = dx * dx + dy * dy;
  if (a < 1e-8) return best;
  for (let i = 0; i < wbs.length; i++) {
    const w = wbs[i];
    const R = w.r + pad;
    const fx = ax - w.x;
    const fy = ay - w.y;
    const c = fx * fx + fy * fy - R * R;
    if (c <= 0) continue; // starting inside: let push-out handle it
    const b = 2 * (fx * dx + fy * dy);
    const disc = b * b - 4 * a * c;
    if (disc < 0) continue;
    const t = (-b - Math.sqrt(disc)) / (2 * a);
    if (t >= 0 && t < best) best = t;
  }
  return best;
}

/** Does segment a→b pass within `pad` of a windbreak? Returns the first one hit, or null. */
export function segBlocked(wbs, ax, ay, bx, by, pad) {
  if (!wbs) return null;
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy || 1e-9;
  let best = null;
  let bestT = Infinity;
  for (let i = 0; i < wbs.length; i++) {
    const w = wbs[i];
    const t = Math.max(0, Math.min(1, ((w.x - ax) * dx + (w.y - ay) * dy) / l2));
    const px = ax + dx * t;
    const py = ay + dy * t;
    if (Math.hypot(w.x - px, w.y - py) < w.r + pad && t < bestT) {
      bestT = t;
      best = w;
    }
  }
  return best;
}

/** Do segments p1→p2 and q1→q2 cross? */
export function segsCross(p1x, p1y, p2x, p2y, q1x, q1y, q2x, q2y) {
  const d1x = p2x - p1x;
  const d1y = p2y - p1y;
  const d2x = q2x - q1x;
  const d2y = q2y - q1y;
  const den = d1x * d2y - d1y * d2x;
  if (Math.abs(den) < 1e-9) return false;
  const ex = q1x - p1x;
  const ey = q1y - p1y;
  const t = (ex * d2y - ey * d2x) / den;
  const u = (ex * d1y - ey * d1x) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

/** Storm timing (seconds) — the client reads phase + time left from the server. */
export const STORM = {
  /** first calm after the room wakes: time to find your feet */
  firstCalm: 5.5,
  calmMin: 6.2,
  calmMax: 7.8,
  /** Minos wounded and engaged: the storm quickens */
  furyCalmMin: 3.4,
  furyCalmMax: 4.4,
  warn: 1.2,
  gustMin: 2.5,
  gustMax: 3.0,
  rampIn: 0.35,
  rampOut: 0.45,
};

/** Walking pilgrims are pushed this fast downwind at full gust (u/s). */
export const PLAYER_DRIFT = 3.0;
/** Shades and wisps are carried this fast (u/s). */
export const MOB_DRIFT = 4.0;
/** Paolo and Francesca — "paion sì al vento esser leggeri" (u/s). */
export const LOVER_DRIFT = 3.4;
/** Net ground speed walking straight into a full gust, as a share of the walk (8 u/s). */
export const UPWIND_MUL = 0.6;
/** Net ground speed walking straight with a full gust. */
export const DOWNWIND_MUL = 1.25;
/** A dash straight downwind in a full gust goes this much farther. */
export const DASH_DOWNWIND = 0.5;
/** Pilgrim body radius against windbreaks. */
export const PLAYER_PAD = 0.45;

/** Gust strength 0..1(+) from the phase clock: ramps in, holds, ramps out. */
export function gustEnvelope(elapsed, left, power = 1) {
  const a = Math.min(1, Math.max(0, elapsed / STORM.rampIn));
  const b = Math.min(1, Math.max(0, left / STORM.rampOut));
  return a * b * power;
}

/**
 * Walking speed multiplier for a unit walk direction (mx, my) in wind (wx, wy) at
 * strength s, chosen so walk × mul + drift lands on the net speeds above:
 * straight upwind 0.6× the walk, straight downwind 1.25×.
 */
export function walkMul(mx, my, wx, wy, s) {
  const a = mx * wx + my * wy;
  const drift = (PLAYER_DRIFT * s * a) / 8;
  const net = a >= 0 ? 1 + (DOWNWIND_MUL - 1) * a * s : 1 - (1 - UPWIND_MUL) * -a * s;
  return Math.max(0.2, net - drift);
}
