/**
 * Avarice processions — client mirror of server/src/cantoMech/avariceProcession.mjs.
 * Keep the numbers and formulas identical (the server crushes on these positions; the
 * client draws the weights, the ruts and the rhythm hint from them).
 */

export const PROC = {
  W: { x: 40, y: 57 },
  E: { x: 130, y: 50 },
  SAG: 13,
  N: 5,
  T: 8,
  PAUSE: 0.14,
  RECOIL: 0.05,
  R: 1.45,
  STOP: 1.5,
  CLASH_R: 4.5,
  WARN: 1.2,
} as const;

type Arc = { ox: number; oy: number; a0: number; sign: number };

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
  const arcs: Arc[] = [];
  for (let k = 0; k < 2; k++) {
    const bx = k === 0 ? uy : -uy;
    const by = k === 0 ? -ux : ux;
    const ox = mx - bx * (R - SAG);
    const oy = my - by * (R - SAG);
    const aW = Math.atan2(W.y - oy, W.x - ox);
    const aA = Math.atan2(my + by * SAG - oy, mx + bx * SAG - ox);
    let d = aA - aW;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    arcs.push({ ox, oy, a0: aW, sign: d >= 0 ? 1 : -1 });
  }
  const L = R * sweep;
  return { R, sweep, L, gap: (L - 2 * PROC.STOP) / PROC.N, arcs };
}

export const GEO = build();

export function progressAt(t: number): number {
  const T = PROC.T;
  const half = T / 2;
  let tau = t % T;
  if (tau < 0) tau += T;
  const east = tau < half;
  const v = (east ? tau : tau - half) / half;
  const P = PROC.PAUSE;
  const r = PROC.RECOIL;
  let q: number;
  if (v < P) {
    const a = v / P;
    q = r * (1 - (1 - a) * (1 - a));
  } else {
    const w = (v - P) / (1 - P);
    q = r + (1 - r) * w * w;
  }
  return east ? q : 1 - q;
}

export function progressRate(t: number): number {
  const T = PROC.T;
  const half = T / 2;
  let tau = t % T;
  if (tau < 0) tau += T;
  const east = tau < half;
  const v = (east ? tau : tau - half) / half;
  const P = PROC.PAUSE;
  const r = PROC.RECOIL;
  let dq: number;
  if (v < P) {
    const a = v / P;
    dq = (r * 2 * (1 - a)) / (P * half);
  } else {
    const w = (v - P) / (1 - P);
    dq = ((1 - r) * 2 * w) / ((1 - P) * half);
  }
  return east ? dq : -dq;
}

export function rollingAt(t: number): boolean {
  const half = PROC.T / 2;
  let tau = t % PROC.T;
  if (tau < 0) tau += PROC.T;
  const v = (tau < half ? tau : tau - half) / half;
  return v >= PROC.PAUSE;
}

export function weightS(j: number, p: number): number {
  return PROC.STOP + (j + p) * GEO.gap;
}

export type ArcPt = { x: number; y: number; tx: number; ty: number };

export function arcPoint(k: number, s: number, out: ArcPt): ArcPt {
  const a = GEO.arcs[k]!;
  const ang = a.a0 + (a.sign * s) / GEO.R;
  const c = Math.cos(ang);
  const sn = Math.sin(ang);
  out.x = a.ox + GEO.R * c;
  out.y = a.oy + GEO.R * sn;
  out.tx = -sn * a.sign;
  out.ty = c * a.sign;
  return out;
}

export type Weight = ArcPt & { vx: number; vy: number; speed: number; spin: number; k: number; j: number };

/** Every weight at time t into `out` (2·N records, reused). */
export function weightsAt(t: number, out: Weight[]): Weight[] {
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

export function distToArcs(x: number, y: number): number {
  let best = Infinity;
  for (let k = 0; k < 2; k++) {
    const a = GEO.arcs[k]!;
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

export function untilClash(t: number, side: 0 | 1): number {
  const T = PROC.T;
  const at = side === 0 ? 0 : T / 2;
  let d = (at - t) % T;
  if (d < 0) d += T;
  return d;
}
