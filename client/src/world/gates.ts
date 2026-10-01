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
  if (id === "inferno_31") return "Pozzo dei Giganti";
  return "the road";
}

/** The hub never shows an Avarice road, even if one arrives in the entity list. */
export function isHiddenHubGate(cantoId: string | undefined, e: any): boolean {
  return cantoId === "inferno_01" && isGate(e) && e?.toCanto === "inferno_07";
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

/**
 * Short player-facing gate name: "Gluttony gate", "Dark Wood gate". Avarice has
 * two roads to the Dark Wood — the stash road back at its entrance and the gate
 * its clear opens — so the stash road keeps its own name.
 */
export function gateTitle(e: any): string {
  if (e?.toCanto === "inferno_31") return "Pozzo dei Giganti";
  if (e?.kind === "exit" && !e.requireClear && /stash road/i.test(String(e.label || ""))) return "Stash road";
  return `${cantoName(e?.toCanto)} gate`;
}

/** Who must fall before a sealed gate opens. */
export function lockReason(e: any): string {
  const need = e?.requireClear;
  if (need === "inferno_05") return "Slay Minos";
  if (need === "inferno_06") return "Slay the Triple Maw";
  if (need === "inferno_07") return "Break Plutus";
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
