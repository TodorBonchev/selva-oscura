/** Torus map helpers. Planar x ∈ [0, width), y ∈ [0, height) (y is three.js z). */

export type Bounds = { width: number; height: number };

export function wrapCoord(v: number, size: number): number {
  if (!(size > 0) || !Number.isFinite(v)) return v;
  return ((v % size) + size) % size;
}

/** Shortest signed delta on a loop of `size` (d − size·round(d/size)). */
export function wrapDelta(d: number, size: number): number {
  if (!(size > 0) || !Number.isFinite(d)) return d;
  return d - size * Math.round(d / size);
}

export function wrapPos(x: number, y: number, b: Bounds): { x: number; y: number } {
  return { x: wrapCoord(x, b.width), y: wrapCoord(y, b.height) };
}
