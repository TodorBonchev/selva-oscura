/**
 * Avarice (Canto VII) — the processions of the weights, as pure geometry.
 *
 *   «Qui vid' i' gente più ch'altrove troppa, / e d'una parte e d'altra, con grand' urli,
 *    voltando pesi per forza di poppa. / Percotëansi 'ncontro; e poscia pur lì
 *    si rivolgea ciascun, voltando a retro, / gridando: "Perché tieni?" e "Perché burli?"»
 *
 * Two arcs meet at two clash points that sit ON the road: the hoarders' arc bulges north,
 * the wasters' arc south (a lens around the middle of the canto). Each arc carries N huge
 * weights spaced along it; the whole procession rolls in unison: east (accelerating) until
 * the east-end pair clashes at E, recoils, turns back ("voltando a retro") and rolls west
 * until the west-end pair clashes at W — every T seconds, W at 0 and E at T/2.
 *
 * Everything is a pure function of the procession clock `t` (seconds), so the server,
 * the self-play bot (scripts/selfplayMech/avarice.mjs) and the client compute the same
 * positions. The client mirror is client/src/world/avariceProcession.ts — keep the two
 * in step (numbers and formulas); scratchpad parity check compares them.
 */

export const PROC = {
  /** West clash — the road where it enters the ring. */
  W: { x: 40, y: 57 },
  /** East clash — the road just before Plutus's dais. */
  E: { x: 133, y: 49.5 },
  /** How far each arc bulges off the W–E chord (lens half-thickness). */
  SAG: 13,
  /** Weights per arc. */
  N: 5,
  /** Seconds per full cycle (W clash at 0, E clash at T/2). */
  T: 8,
  /** Share of a half cycle spent recoiling / resting after a clash. */
  PAUSE: 0.14,
  /** Recoil after the clash, as a share of a weight's run. */
  RECOIL: 0.05,
  /** Rolling radius of a weight (world units). */
  R: 1.45,
  /** How far short of the clash point an end weight stops (the rims meet). */
  STOP: 1.5,
  /** Clash shockwave radius. */
  CLASH_R: 4.5,
  /** Clash warning lead (s): the telegraph fills this long before the weights meet. */
  WARN: 1.2,
};

function build() {
  const { W, E, SAG } = PROC;
  const dx = E.x - W.x;
  const dy = E.y - W.y;
  const c = Math.hypot(dx, dy);
  const ux = dx / c;
  const uy = dy / c;
  const mx = (W.x + E.x) / 2;
  const my = (W.y + E.y) / 2;
  const R = (c * c) / 4 / (2 * SAG) + SAG / 2;
  const sweep = 2 * Math.asin(c / (2 * R));
  const arcs = [];
  // k = 0: hoarders (north, −y side); k = 1: wasters (south, +y side)
  for (let k = 0; k < 2; k++) {
    const bx = k === 0 ? uy : -uy;
    const by = k === 0 ? -ux : ux;
    const ox = mx - bx * (R - SAG);
    const oy = my - by * (R - SAG);
    const aW = Math.atan2(W.y - oy, W.x - ox);
    const aA = Math.atan2(my + by * SAG - oy, mx + bx * SAG - ox);
    // direction of travel from W that passes over the apex
    let d = aA - aW;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    arcs.push({ ox, oy, a0: aW, sign: d >= 0 ? 1 : -1 });
  }
  const L = R * sweep;
  return { R, sweep, L, gap: (L - 2 * PROC.STOP) / PROC.N, arcs };
}

/** Derived geometry: circle radius R, arc length L, per-arc centre/start angle/sign. */
export const GEO = build();

/** Procession progress p ∈ [0,1] (0 = the whole procession at its west stops). */
export function progressAt(t) {
  const T = PROC.T;
  const half = T / 2;
  let tau = t % T;
  if (tau < 0) tau += T;
  const east = tau < half;
  const v = (east ? tau : tau - half) / half;
  const P = PROC.PAUSE;
  const r = PROC.RECOIL;
  let q;
  if (v < P) {
    const a = v / P;
    q = r * (1 - (1 - a) * (1 - a));
  } else {
    const w = (v - P) / (1 - P);
    q = r + (1 - r) * w * w;
  }
  return east ? q : 1 - q;
}

/** d(progress)/dt (per second), signed (+ = rolling east). */
export function progressRate(t) {
  const T = PROC.T;
  const half = T / 2;
  let tau = t % T;
  if (tau < 0) tau += T;
  const east = tau < half;
  const v = (east ? tau : tau - half) / half;
  const P = PROC.PAUSE;
  const r = PROC.RECOIL;
  let dq;
  if (v < P) {
    const a = v / P;
    dq = (r * 2 * (1 - a)) / (P * half);
  } else {
    const w = (v - P) / (1 - P);
    dq = ((1 - r) * 2 * w) / ((1 - P) * half);
  }
  return east ? dq : -dq;
}

/** True while the procession is rolling toward a clash (not recoiling / resting). */
export function rollingAt(t) {
  const half = PROC.T / 2;
  let tau = t % PROC.T;
  if (tau < 0) tau += PROC.T;
  const v = (tau < half ? tau : tau - half) / half;
  return v >= PROC.PAUSE;
}

/** Arc-length position of weight j at progress p. */
export function weightS(j, p) {
  return PROC.STOP + (j + p) * GEO.gap;
}

/**
 * Point on arc k at arc length s: writes { x, y, tx, ty } (unit tangent toward E) into out.
 */
export function arcPoint(k, s, out) {
  const a = GEO.arcs[k];
  const ang = a.a0 + (a.sign * s) / GEO.R;
  const c = Math.cos(ang);
  const sn = Math.sin(ang);
  out.x = a.ox + GEO.R * c;
  out.y = a.oy + GEO.R * sn;
  out.tx = -sn * a.sign;
  out.ty = c * a.sign;
  return out;
}

/**
 * Every weight at time t: out is an array of 2·N records { x, y, tx, ty, vx, vy, speed,
 * spin, k, j } (reused; created on first call). spin = rolled angle (s / R).
 */
export function weightsAt(t, out) {
  const n = PROC.N;
  const p = progressAt(t);
  const rate = progressRate(t) * GEO.gap;
  for (let k = 0; k < 2; k++) {
    for (let j = 0; j < n; j++) {
      const i = k * n + j;
      let w = out[i];
      if (!w) w = out[i] = { x: 0, y: 0, tx: 1, ty: 0, vx: 0, vy: 0, speed: 0, spin: 0, k, j };
      const s = weightS(j, p);
      arcPoint(k, s, w);
      w.vx = w.tx * rate;
      w.vy = w.ty * rate;
      w.speed = Math.abs(rate);
      w.spin = s / PROC.R;
      w.k = k;
      w.j = j;
    }
  }
  out.length = 2 * n;
  return out;
}

/** Distance from (x,y) to the nearer arc's centreline (Infinity off both arcs' spans). */
export function distToArcs(x, y) {
  let best = Infinity;
  for (let k = 0; k < 2; k++) {
    const a = GEO.arcs[k];
    const dx = x - a.ox;
    const dy = y - a.oy;
    const ang = Math.atan2(dy, dx);
    let rel = (ang - a.a0) * a.sign;
    while (rel < -Math.PI) rel += Math.PI * 2;
    while (rel > Math.PI) rel -= Math.PI * 2;
    if (rel < 0 || rel > GEO.sweep) continue;
    const d = Math.abs(Math.hypot(dx, dy) - GEO.R);
    if (d < best) best = d;
  }
  return best;
}

/**
 * Nearest lane to (x,y) within the arcs' spans: writes { k, s, d } (arc, arc length of
 * the closest centreline point, distance off it) into out; d = Infinity off both spans.
 */
export function nearestLane(x, y, out) {
  out.k = -1;
  out.s = 0;
  out.d = Infinity;
  for (let k = 0; k < 2; k++) {
    const a = GEO.arcs[k];
    const dx = x - a.ox;
    const dy = y - a.oy;
    let rel = (Math.atan2(dy, dx) - a.a0) * a.sign;
    while (rel < -Math.PI) rel += Math.PI * 2;
    while (rel > Math.PI) rel -= Math.PI * 2;
    if (rel < 0 || rel > GEO.sweep) continue;
    const d = Math.abs(Math.hypot(dx, dy) - GEO.R);
    if (d < out.d) {
      out.k = k;
      out.s = rel * GEO.R;
      out.d = d;
    }
  }
  return out;
}

/**
 * Seconds (from t, sampled every `step` up to `horizon`) until a rolling weight — moving
 * at ≥ minSpeed — covers arc length s (within `reach` along the lane; both arcs roll in
 * unison, so the lane does not matter). Infinity when none does in the horizon.
 */
export function lanePassIn(t, s, horizon, step, reach, minSpeed) {
  const n = PROC.N;
  for (let dt = 0; dt <= horizon + 1e-6; dt += step) {
    const tt = t + dt;
    if (!rollingAt(tt)) continue;
    if (Math.abs(progressRate(tt) * GEO.gap) < minSpeed) continue;
    const p = progressAt(tt);
    const u = (s - PROC.STOP) / GEO.gap - p;
    const j0 = Math.floor(u);
    for (let j = j0; j <= j0 + 1; j++) {
      if (j < 0 || j >= n) continue;
      if (Math.abs(weightS(j, p) - s) <= reach) return dt;
    }
  }
  return Infinity;
}

/** Seconds until the next clash at W (side 0) or E (side 1). */
export function untilClash(t, side) {
  const T = PROC.T;
  const at = side === 0 ? 0 : T / 2;
  let d = (at - t) % T;
  if (d < 0) d += T;
  return d;
}
