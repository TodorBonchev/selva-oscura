/**
 * Gluttony mire geometry — the old stone causeway (content geo.causeway) and the
 * sucking mud around it. Pure functions, shared by the mechanic (player move budget,
 * dash, non-native foes) and the self-play bot.
 *
 * The client mirrors this file line for line in client/src/world/gluttonyMire.ts (the
 * server can't import client code and vice versa); the server also sends its polyline
 * to each client on arrival, so both sides always judge "firm or mire" from one copy.
 *
 * mulAt(x, y) is the speed multiplier: 1 on the stones (within half-width of the
 * polyline, or on a pad), easing to `mire_mul` over EDGE world units of mud.
 */

/** Width of the soft band where firm stone turns to mire (both sides use it). */
export const EDGE = 0.8;

/** Distance from (x, y) to the polyline `pts` ([[x, y], …]). */
export function distToPoly(x, y, pts) {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = pts[i][0];
    const ay = pts[i][1];
    const dx = pts[i + 1][0] - ax;
    const dy = pts[i + 1][1] - ay;
    const l2 = dx * dx + dy * dy || 1;
    let t = ((x - ax) * dx + (y - ay) * dy) / l2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ex = x - (ax + t * dx);
    const ey = y - (ay + t * dy);
    const d = Math.sqrt(ex * ex + ey * ey);
    if (d < best) best = d;
  }
  return best;
}

/**
 * How far (x, y) lies past firm ground (≤ 0 = on the stones or a pad).
 * pads: [[x, y, r], …] firm landings.
 */
export function mireDepth(x, y, pts, half, pads) {
  let d = distToPoly(x, y, pts) - half;
  for (let i = 0; i < pads.length; i++) {
    const p = pads[i];
    const e = Math.hypot(x - p[0], y - p[1]) - p[2];
    if (e < d) d = e;
  }
  return d;
}

/** Speed multiplier at depth `d` past the firm edge. */
export function mulForDepth(d, mireMul) {
  if (d <= 0) return 1;
  if (d >= EDGE) return mireMul;
  return 1 - (1 - mireMul) * (d / EDGE);
}

/** Build the mire from a canto's geo (null when it has no causeway). */
export function makeMire(geo) {
  const cw = geo?.causeway;
  if (!cw || !Array.isArray(cw.points) || cw.points.length < 2) return null;
  const pts = cw.points.map((p) => [Number(p[0]), Number(p[1])]);
  const half = (Number(cw.width) || 5) / 2;
  const pads = (cw.pads || []).map((p) => [Number(p[0]), Number(p[1]), Number(p[2])]);
  const mireMul = Number(cw.mire_mul) || 0.6;
  const dashMul = Number(cw.dash_mul) || 0.6;
  return {
    pts,
    half,
    pads,
    mireMul,
    dashMul,
    depth: (x, y) => mireDepth(x, y, pts, half, pads),
    mulAt: (x, y) => mulForDepth(mireDepth(x, y, pts, half, pads), mireMul),
    /** Dash distance multiplier (same easing, dash_mul in the mire). */
    dashAt: (x, y) => mulForDepth(mireDepth(x, y, pts, half, pads), dashMul),
    /** Compact wire form for the client (sent once per session). */
    wire: () => ({ p: pts, h: half, pads, m: mireMul, d: dashMul }),
  };
}
