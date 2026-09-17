/** Lean isometric helpers. World units match content JSON geo. */
export const TILE_W = 36;
export const TILE_H = 18;

export function worldToScreen(x: number, y: number): { sx: number; sy: number } {
  return {
    sx: (x - y) * (TILE_W / 2),
    sy: (x + y) * (TILE_H / 2),
  };
}

export function screenToWorld(sx: number, sy: number): { x: number; y: number } {
  const x = sy / TILE_H + sx / TILE_W;
  const y = sy / TILE_H - sx / TILE_W;
  return { x, y };
}
