/** Rooms that torus-wrap. The giants' well is a closed pit: clamp, never fold. */

export function roomWraps(room: { role?: string; cantoId?: string } | null | undefined): boolean {
  if (!room) return true;
  if (room.role === "arena" || room.cantoId === "inferno_31") return false;
  return true;
}
