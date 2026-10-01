/**
 * Who a swing may name. Mirrors server pvpGate: an active duel (countdown or
 * fight) blocks the free-for-all, and only its two fighters connect during fight.
 * Downed and invulnerable pilgrims are never a legal target.
 */

export type DuelLite = { a: string; b: string; phase: string };

export function activeDuel(duels: readonly DuelLite[] | undefined, id: string): DuelLite | null {
  if (!duels || !id) return null;
  const want = String(id);
  for (let i = 0; i < duels.length; i++) {
    const d = duels[i]!;
    if (d.phase !== "countdown" && d.phase !== "fight") continue;
    if (String(d.a) === want || String(d.b) === want) return d;
  }
  return null;
}

export type TargetPlayer = {
  id: string;
  hp?: number;
  pvp?: { downed?: boolean; invuln?: boolean } | null;
};

export function canTargetPlayer(
  role: string | undefined,
  cantoId: string | undefined,
  duels: readonly DuelLite[] | undefined,
  youId: string,
  pl: TargetPlayer | null | undefined
): boolean {
  if (!pl || !youId) return false;
  const pid = String(pl.id);
  if (pid === String(youId)) return false;
  if (pl.pvp?.downed) return false;
  if (pl.hp != null && pl.hp <= 0) return false;
  if (pl.pvp?.invuln) return false;
  const mine = activeDuel(duels, youId);
  if (mine) {
    if (mine.phase !== "fight") return false;
    const opp = mine.a === youId || String(mine.a) === String(youId) ? mine.b : mine.a;
    return pid === String(opp);
  }
  const arena = role === "arena" || cantoId === "inferno_31";
  if (!arena) return false;
  if (activeDuel(duels, pl.id)) return false;
  return true;
}
