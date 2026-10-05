/**
 * Wrath (inferno_08) — the Styx marsh geometry, shared by the ground builder and the
 * canto mechanic. Mirrors content/cantos/inferno_08.json geo.styx (the server judges
 * eruptions against the same band in server/src/cantoMech/wrath.mjs). Visual only on
 * the client: wading the Styx never slows you (no prediction to keep in step).
 *
 * «Fitti nel limo dicon: "Tristi fummo / ne l'aere dolce che dal sol s'allegra"»
 */
function distToPoly(x: number, z: number, pts: [number, number][]): number {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = pts[i][0];
    const az = pts[i][1];
    const dx = pts[i + 1][0] - ax;
    const dz = pts[i + 1][1] - az;
    const l2 = dx * dx + dz * dz || 1;
    let t = ((x - ax) * dx + (z - az) * dz) / l2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const d = Math.hypot(x - (ax + t * dx), z - (az + t * dz));
    if (d < best) best = d;
  }
  return best;
}

/** River centreline (world x, y). Crosses the road at two fords. */
export const STYX_PTS: [number, number][] = [
  [0, 44],
  [26, 46],
  [46, 54],
  [58, 70],
  [76, 84],
  [96, 76],
  [108, 60],
  [118, 44],
  [136, 34],
  [160, 36],
];
export const STYX_HALF = 4.5;

/** The road: spawn → first ford → Rage Heart → second ford → Argenti's landing. */
export const WRATH_HUNT: [number, number][] = [
  [18, 60],
  [34, 62],
  [52, 64],
  [72, 62],
  [90, 56],
  [106, 56],
  [122, 58],
  [138, 58],
];

export const WRATH_DAIS = { x: 138, z: 58 };

/** Distance past the river's bank (≤ 0 = in the water). */
export function styxDepth(x: number, z: number): number {
  return distToPoly(x, z, STYX_PTS) - STYX_HALF;
}
