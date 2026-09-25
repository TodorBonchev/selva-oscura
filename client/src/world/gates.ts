/**
 * Gate (portal / exit) rules shared by the world, the objective model and the
 * radar, so every channel agrees on which gate is which and what colour it is.
 *
 * One colour language:
 *   forward — the next-objective gate (hub → Lust, and in a canto the road its
 *             clear opens: Lust → Gluttony, Gluttony → Avarice, Avarice → home). Gold.
 *   return  — any road back. Cool bone / blue.
 *   locked  — require_clear not met yet. Grey, with a lock glyph on the label.
 */

export type GateState = "forward" | "return" | "locked";

/** Gate labels show name + distance to this range; past it the compass arrow takes over. */
export const GATE_LABEL_RANGE = 30;

export function isGate(e: any): boolean {
  return e?.kind === "exit" || (e?.kind === "poi" && e?.poiKind === "portal");
}

export function cantoName(id: string | undefined): string {
  if (id === "inferno_05") return "Lust";
  if (id === "inferno_06") return "Gluttony";
  if (id === "inferno_07") return "Avarice";
  if (id === "inferno_01") return "Dark Wood";
  return "the road";
}

export function gateLocked(e: any, clears: string[] | undefined): boolean {
  const need = e?.requireClear;
  if (!need) return false;
  return !(Array.isArray(clears) && clears.includes(need));
}

/** The road this canto's clear opens (or, in the hub, the road into the Inferno). */
export function gateIsForward(e: any, cantoId: string | undefined): boolean {
  if (!isGate(e)) return false;
  if (cantoId === "inferno_01" || !cantoId) return e.toCanto === "inferno_05";
  return Boolean(e.requireClear && e.requireClear === cantoId);
}

export function gateState(e: any, cantoId: string | undefined, clears: string[] | undefined): GateState {
  if (gateLocked(e, clears)) return "locked";
  return gateIsForward(e, cantoId) ? "forward" : "return";
}

/** Short player-facing gate name: "Gluttony gate", "Dark Wood gate". */
export function gateTitle(e: any): string {
  return `${cantoName(e?.toCanto)} gate`;
}

/** Who must fall before a sealed gate opens. */
export function lockReason(e: any): string {
  const need = e?.requireClear;
  if (need === "inferno_05") return "Slay the Judge";
  if (need === "inferno_06") return "Slay the Triple Maw";
  if (need === "inferno_07") return "Slay Hoard Crush";
  return "Sealed";
}

/**
 * Content may pair an exit with a portal POI to the same canto a couple of
 * units apart; the world draws only the portal POI (see WorldApp.isTwinExit).
 */
export function isTwinExitOf(e: any, entities: any[]): boolean {
  if (e?.kind !== "exit" || !e.toCanto) return false;
  for (const o of entities) {
    if (o.kind !== "poi" || o.poiKind !== "portal" || o.toCanto !== e.toCanto) continue;
    if (Math.hypot(o.x - e.x, o.y - e.y) < 5) return true;
  }
  return false;
}

/** Gates as drawn: twins collapsed onto the portal POI. Allocates — call at ≤10 Hz. */
export function visibleGates(entities: any[]): any[] {
  const out: any[] = [];
  for (const e of entities) {
    if (!isGate(e)) continue;
    if (isTwinExitOf(e, entities)) continue;
    out.push(e);
  }
  return out;
}

export function forwardGate(entities: any[], cantoId: string | undefined): any | null {
  for (const e of entities) {
    if (!isGate(e) || isTwinExitOf(e, entities)) continue;
    if (gateIsForward(e, cantoId)) return e;
  }
  return null;
}
