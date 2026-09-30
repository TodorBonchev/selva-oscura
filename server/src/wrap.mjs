/**
 * Torus map helpers. Planar coords live in [0, width) × [0, height).
 * A step that crosses an edge continues from the opposite edge.
 */

export function wrapCoord(v, size) {
  if (!(size > 0) || !Number.isFinite(v)) return v;
  return ((v % size) + size) % size;
}

/** Shortest signed delta on a loop of `size` (d − size·round(d/size)). */
export function wrapDelta(d, size) {
  if (!(size > 0) || !Number.isFinite(d)) return d;
  return d - size * Math.round(d / size);
}

export function wrapPos(x, y, b) {
  return { x: wrapCoord(x, b.width), y: wrapCoord(y, b.height) };
}
