/**
 * Gluttony mire geometry, client half — a line-for-line mirror of
 * server/src/cantoMech/gluttonyMire.mjs (the server can't import client code). The
 * defaults below are content/cantos/inferno_06.json geo.causeway, used to build the
 * ground before the first snapshot; the server then sends its own copy (snapshot
 * mech.cw) and adoptMire() makes it the one move feel and dash read, so prediction
 * and the server's move budget always judge "firm or mire" from the same polyline.
 */

export type MirePts = [number, number][];
export type MirePad = [number, number, number];

/** Width of the soft band where firm stone turns to mire (server EDGE). */
export const EDGE = 0.8;

/** content geo.causeway (keep in step with the JSON; the wire copy wins at runtime). */
export const CAUSEWAY_PTS: MirePts = [
  [12, 52],
  [26, 52],
  [36, 44],
  [50, 40],
  [60, 47],
  [66, 58],
  [80, 62],
  [92, 56],
  [98, 46],
  [110, 42],
  [120, 48],
  [130, 48],
  [138, 48],
  [150, 52],
];
export const CAUSEWAY_HALF = 2.5;
export const CAUSEWAY_PADS: MirePad[] = [
  [15, 53, 8],
  [125, 48, 4],
  [138, 48, 9.2],
];
export const MIRE_MUL = 0.6;
export const DASH_MUL = 0.6;

/** Distance from (x, y) to the polyline `pts`. */
export function distToPoly(x: number, y: number, pts: MirePts): number {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = pts[i]![0];
    const ay = pts[i]![1];
    const dx = pts[i + 1]![0] - ax;
    const dy = pts[i + 1]![1] - ay;
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

/** How far (x, y) lies past firm ground (≤ 0 = on the stones or a pad). */
export function mireDepth(x: number, y: number, pts: MirePts, half: number, pads: MirePad[]): number {
  let d = distToPoly(x, y, pts) - half;
  for (let i = 0; i < pads.length; i++) {
    const p = pads[i]!;
    const e = Math.hypot(x - p[0], y - p[1]) - p[2];
    if (e < d) d = e;
  }
  return d;
}

/** Speed multiplier at depth `d` past the firm edge. */
export function mulForDepth(d: number, mireMul: number): number {
  if (d <= 0) return 1;
  if (d >= EDGE) return mireMul;
  return 1 - (1 - mireMul) * (d / EDGE);
}

/** The mire the mechanic judges by (defaults until the server's copy arrives). */
export const mire = {
  pts: CAUSEWAY_PTS as MirePts,
  half: CAUSEWAY_HALF,
  pads: CAUSEWAY_PADS as MirePad[],
  mireMul: MIRE_MUL,
  dashMul: DASH_MUL,
};

export function mireDepthAt(x: number, y: number): number {
  return mireDepth(x, y, mire.pts, mire.half, mire.pads);
}

export function mireMulAt(x: number, y: number): number {
  return mulForDepth(mireDepthAt(x, y), mire.mireMul);
}

export function mireDashAt(x: number, y: number): number {
  return mulForDepth(mireDepthAt(x, y), mire.dashMul);
}

/** The server's causeway (snapshot mech.cw: { p, h, pads, m, d }). */
export function adoptMire(cw: { p?: unknown; h?: unknown; pads?: unknown; m?: unknown; d?: unknown } | null | undefined) {
  if (!cw || !Array.isArray(cw.p) || cw.p.length < 2) return;
  mire.pts = (cw.p as number[][]).map((q) => [Number(q[0]), Number(q[1])] as [number, number]);
  mire.half = Number(cw.h) || CAUSEWAY_HALF;
  mire.pads = Array.isArray(cw.pads)
    ? (cw.pads as number[][]).map((q) => [Number(q[0]), Number(q[1]), Number(q[2])] as MirePad)
    : CAUSEWAY_PADS;
  mire.mireMul = Number(cw.m) || MIRE_MUL;
  mire.dashMul = Number(cw.d) || DASH_MUL;
}
