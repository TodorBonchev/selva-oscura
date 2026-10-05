/**
 * Foe body radii for the local pilgrim's collision prediction. Mirrors bodyRadius() in
 * server/src/mobAi.mjs (room.handleMove pushes the pilgrim out of the same circles),
 * so prediction slides around foes instead of walking through and being pulled back.
 */
type Foe = { kind?: string; archetype?: string; champion?: boolean };

const WISPS = new Set(["gale_wisp", "mud_wisp", "coin_wisp", "sullen_wisp"]);
const WARDENS = new Set(["gale_warden", "mire_warden", "ledger_warden"]);

export function bodyRadius(e: Foe, cantoId: string | undefined): number {
  const a = String(e.archetype || "");
  if (e.kind === "boss") return 1.8;
  if (cantoId === "inferno_07") {
    if (a === "coin_wisp") return 0.85;
    if (a === "weight_champion") return 1.35;
    if (a === "weight_shade") return 1.1;
  }
  if (a.endsWith("_heart")) return 0.9;
  if (WISPS.has(a)) return 0.55;
  if (WARDENS.has(a)) return 1.1;
  if (e.champion || a === "weight_champion") return 1.0;
  return 0.7;
}
