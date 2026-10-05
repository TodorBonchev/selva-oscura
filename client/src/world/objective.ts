/**
 * One objective model for every guidance channel.
 *
 * computeObjective() runs ~10 Hz and its result drives, together:
 *   - the objective line (#quest-track) and its secondary hint,
 *   - the primary (gold) compass arrow,
 *   - the highlighted minimap blip + minimap caption,
 *   - the world beacon over the target.
 * So the player never reads "Break the Storm Heart" while the map says
 * "Hunt Shade" and the arrow points at a portal.
 */
import { cantoName, forwardGate, gateLocked, gateTitle, isGate, lockReason } from "./gates";

type Vec2 = { x: number; y: number };

export type ObjectiveTarget = {
  id: string;
  x: number;
  y: number;
  /** Short name for the arrow / map caption ("Gluttony gate", "Storm Heart"). */
  label: string;
  kind: "gate" | "foe" | "poi";
  entity: any;
  /** Gate just opened: its world label shows "Open" at any range (guidance.ts). */
  open?: boolean;
};

export type Objective = {
  /** Objective line. */
  text: string;
  /** Secondary hint (low-HP shrine, bell); "" when none. Never replaces `text`. */
  sub: string;
  target: ObjectiveTarget | null;
};

const HEART_ARCH = new Set(["storm_heart", "mire_heart", "hoard_heart", "rage_heart"]);
/** Named mid-lane elites that stand before each boss. */
const MID_ELITE = /^(bufera|cerbero|counterweight)$/i;

function alive(e: any): boolean {
  return e && (e.hp == null || e.hp > 0);
}

/** A waypoint the pilgrim already walked past (east of it and not close) retires. */
function passed(t: any, you: Vec2): boolean {
  return you.x > t.x + 8 && Math.hypot(t.x - you.x, t.y - you.y) > 10;
}

function bossShort(canto: string, boss: any): string {
  if (canto === "inferno_05") return "Judge";
  if (canto === "inferno_06") return "Triple Maw";
  if (canto === "inferno_07") return "Hoard Crush";
  if (canto === "inferno_08") return "Filippo Argenti";
  return String(boss?.name || "Boss");
}

function bossLine(canto: string): string {
  if (canto === "inferno_05") return "Slay the Judge of the Gate";
  if (canto === "inferno_06") return "Slay the Triple Maw";
  if (canto === "inferno_07") return "Break Hoard Crush";
  if (canto === "inferno_08") return "Defeat Filippo Argenti";
  return "Slay the boss";
}

function heartLine(canto: string): string {
  if (canto === "inferno_06") return "Break the Mire Heart — it wards nearby shades";
  if (canto === "inferno_07") return "Break the Hoard Heart — it wards nearby weights";
  if (canto === "inferno_08") return "Break the Rage Heart — it wards nearby wrathful";
  return "Break the Storm Heart — it wards nearby shades";
}

function shrineName(canto: string): string {
  if (canto === "inferno_06") return "Mire Shrine";
  if (canto === "inferno_07") return "Ledger Shrine";
  if (canto === "inferno_08") return "Styx Shrine";
  return "Wind Shrine";
}

function bellName(canto: string): string {
  if (canto === "inferno_06") return "Mire Bell";
  if (canto === "inferno_07") return "Ledger Bell";
  if (canto === "inferno_08") return "Phlegyas' Lantern";
  return "Gale Bell";
}

function gateTarget(g: any): ObjectiveTarget {
  return { id: String(g.id), x: g.x, y: g.y, label: gateTitle(g), kind: "gate", entity: g };
}

function entTarget(e: any, label: string, kind: ObjectiveTarget["kind"]): ObjectiveTarget {
  return { id: String(e.id), x: e.x, y: e.y, label, kind, entity: e };
}

export function computeObjective(room: any, you: Vec2, todayUtc: string): Objective {
  const canto: string = room?.cantoId || "";
  const me = room?.you || {};
  const clears: string[] = Array.isArray(me.firstClears) ? me.firstClears : [];
  const entities: any[] = room?.entities || [];
  const hpFrac = (Number(me.hp) || 0) / Math.max(1, Number(me.maxHp) || 1);

  if (canto === "inferno_31" || room?.role === "arena") {
    return { text: "The pit is open — strike, or queue a ranked duel", sub: "Scoreboard and Spectate live in the menu", target: null };
  }

  if (canto === "inferno_05" || canto === "inferno_06" || canto === "inferno_07" || canto === "inferno_08") {
    let boss: any = null;
    let heart: any = null;
    let elite: any = null;
    let shrine: any = null;
    let bell: any = null;
    for (const e of entities) {
      if (e.kind === "boss" && alive(e)) boss = e;
      else if (e.kind === "mob" && alive(e)) {
        if (HEART_ARCH.has(String(e.archetype || ""))) heart = e;
        else if (MID_ELITE.test(String(e.name || ""))) elite = e;
      } else if (e.kind === "poi" && e.poiKind === "shrine") {
        // (two shrines a canto — by the entrance and short of the boss: the nearer mends)
        if (!shrine || Math.hypot(e.x - you.x, e.y - you.y) < Math.hypot(shrine.x - you.x, shrine.y - you.y)) shrine = e;
      } else if (e.kind === "poi" && e.poiKind === "bell") bell = e;
    }
    const fwd = forwardGate(entities, canto);
    const cleared = clears.includes(canto);
    let text: string;
    let target: ObjectiveTarget | null = null;
    if (cleared && fwd && !gateLocked(fwd, clears)) {
      // Boss down: the forward gold gate is the objective, whatever else is alive
      text =
        fwd.toCanto === "inferno_01"
          ? "The road home is open — take the Dark Wood gate"
          : `The ${cantoName(fwd.toCanto)} gate is open — enter it`;
      target = gateTarget(fwd);
    } else if (boss) {
      if (heart && !passed(heart, you)) {
        text = heartLine(canto);
        target = entTarget(heart, String(heart.name || "Heart"), "foe");
      } else if (elite && !passed(elite, you) && Math.hypot(elite.x - you.x, elite.y - you.y) < Math.hypot(boss.x - you.x, boss.y - you.y)) {
        text = `Defeat ${elite.name} — then ${canto === "inferno_07" || canto === "inferno_08" ? "" : "the "}${bossShort(canto, boss)}`;
        target = entTarget(elite, String(elite.name), "foe");
      } else {
        text = bossLine(canto);
        target = entTarget(boss, bossShort(canto, boss), "foe");
      }
      if (fwd && gateLocked(fwd, clears) && target.kind === "foe" && target.entity === boss) {
        // Say what the kill is for: the sealed gate is the way on
        text = `${lockReason(fwd)} to open the ${cantoName(fwd.toCanto)} gate`;
      }
    } else if (fwd) {
      // Boss down but no clear credit yet (or it is resting before it rises again)
      text = gateLocked(fwd, clears)
        ? `${lockReason(fwd)} to open the ${cantoName(fwd.toCanto)} gate`
        : `Enter the ${cantoName(fwd.toCanto)} gate`;
      target = gateTarget(fwd);
    } else {
      text = "Explore the circle";
    }
    // Secondary line: never replaces the objective
    let sub = "";
    if (shrine && hpFrac < 0.5) {
      const d = Math.round(Math.hypot(shrine.x - you.x, shrine.y - you.y));
      sub = `${shrine.label || shrineName(canto)} mends you · ${d}m`;
    } else if (bell && (Number(me.bellCd) || 0) <= 0.4 && Math.hypot(bell.x - you.x, bell.y - you.y) < 12) {
      let near = 0;
      for (const e of entities) {
        if (e.kind === "mob" && alive(e) && Math.hypot(e.x - bell.x, e.y - bell.y) < 10) near++;
      }
      if (near >= 3) sub = `Ring the ${bellName(canto)} to still the pack`;
    }
    return { text, sub, target };
  }

  // ——— Dark Wood (hub) ———
  let guide: any = null;
  let board: any = null;
  let stash: any = null;
  let lustGate: any = null;
  for (const e of entities) {
    if (e.kind === "poi" && e.poiKind === "npc") guide = e;
    else if (e.kind === "poi" && e.poiKind === "quest") board = e;
    else if (e.kind === "poi" && e.poiKind === "stash") stash = e;
    if (isGate(e) && e.toCanto === "inferno_05") lustGate = lustGate || e;
  }
  const fwdHub = forwardGate(entities, canto) || lustGate;
  const writOpen = Boolean(me.spokeToGuide) && Boolean(me.visitedInferno) && me.dailyQuestDoneUtc !== todayUtc;
  let text = "Explore the wood";
  let target: ObjectiveTarget | null = null;
  if (!me.spokeToGuide && guide) {
    text = "Speak with the Guide";
    target = entTarget(guide, "Guide", "poi");
  } else if (!me.visitedInferno && fwdHub) {
    text = "Take the gold gate into Lust";
    target = gateTarget(fwdHub);
  } else if (writOpen && board) {
    text = "Claim today's writ at the board";
    target = entTarget(board, "Writ board", "poi");
  } else if (fwdHub) {
    text = clears.includes("inferno_08")
      ? "Hunt again — the Lust gate leads down"
      : clears.includes("inferno_07")
      ? "Onward to Wrath — the Styx lies past Avarice"
      : clears.includes("inferno_06")
        ? "Onward to Avarice — through Lust and Gluttony"
        : clears.includes("inferno_05")
          ? "Onward to Gluttony — through the Lust gate"
          : "Enter the Lust gate";
    target = gateTarget(fwdHub);
  }
  let sub = "";
  if (hpFrac < 0.85) sub = "The camp pyre mends you";
  else if (stash && clears.length && (me.inventory || []).some((i: any) => i && !i.equipSlot && i.soulbound)) {
    sub = "Bank weighed drops at the stash";
  }
  return { text, sub, target };
}
