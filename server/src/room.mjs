import { BOSS_ABSENT_R, BOSS_MEND_AFTER, BOSS_MEND_RATE, BOSS_LEASH } from "./bossMend.mjs";
import { CANTOS } from "./content.mjs";
import { rollDrops, makeStarterKitItems } from "./loot.mjs";
import {
  getOrCreatePlayer,
  snapshotPlayer,
  tryEmit,
  players,
  grantInventoryItem,
  persistPlayerFlags,
  salvageBag,
  computeGearStats,
  equipItem,
  unequipItem,
  unequipSlot,
  stashItem,
  unstashItem,
} from "./ledger.mjs";
import * as ah from "./ah.mjs";
import { Telegraphs } from "./telegraph.mjs";
import {
  POISE_BREAK,
  POISE_HEAVY,
  bodyRadius,
  brake,
  chase,
  interruptAttack,
  isChampionClass,
  knockbackFor,
  pushMob,
  startAttack,
  tickImpulse,
  unstick,
  walkTo,
} from "./mobAi.mjs";
import { getMech } from "./cantoMech/index.mjs";
import { challengesOnBossKill, challengesOnMobKill, flairOf } from "./challenges.mjs";
import { wrapCoord, wrapDelta } from "./wrap.mjs";
import {
  pvpAimTarget,
  pvpBreakInvuln,
  pvpBurst,
  pvpDashCut,
  pvpIsDown,
  pvpLandBolt,
  pvpMelee,
  pvpOnJoin,
  pvpOnRoomLeave,
  pvpRemote,
  pvpRoomFields,
  pvpTick,
  pvpTouch,
  pvpYou,
} from "./pvp.mjs";
import {
  applyCatchup,
  applyPlayerStats,
  firstClearXp,
  flushXpGains,
  getLevel,
  getProgress,
  grantKillXp,
  grantXp,
  manaRegenPerSec,
  playerCombatStats,
  progSnapshot,
} from "./progression.mjs";
import {
  applyLifesteal,
  bastionActive,
  bastionDr,
  beginCast,
  castActive,
  cleanupPlayerSkills,
  meleeDmgMult,
  skillFxSnapshot,
  spellDmgMult,
  thornsPct,
  tickSkills,
  tryLastStand,
  warCryMult,
  weakenMult,
} from "./skills.mjs";

/** Arena pits clamp to the wall; every other canto keeps the torus wrap. */
function placeBody(room, x, y) {
  const b = room.canto.geo.bounds;
  if (room.canto.geo.wrap === false) {
    const maxX = Math.max(1, b.width - 1);
    const maxY = Math.max(1, b.height - 1);
    return {
      x: Math.max(1, Math.min(maxX, x)),
      y: Math.max(1, Math.min(maxY, y)),
    };
  }
  return { x: wrapCoord(x, b.width), y: wrapCoord(y, b.height) };
}

const ATTACK_RANGE = 3.5;
/** Generous loot / POI reach so mobile players rarely see "Too far". */
const PICKUP_RANGE = 6.5;
const INTERACT_RANGE = 5.2;
const INTERACT_RANGE_PORTAL = 6.2;
/** Slack over portal reach for a direct travel request (client prediction lag). */
const TRAVEL_REACH = INTERACT_RANGE_PORTAL + 2;
const MOVE_SPEED = 8; // units per intent clamp
const PLAYER_MAX_HP = 130;
const RESPAWN_IFRAMES = 2.0; // seconds of invulnerability after waking at the entrance
/** Avarice entrance keep-out so Road Weights never sit on spawn / death wake. */
const AVA_SPAWN_KEEP = 11.5;
/** Lust / Gluttony entrance keep-out (just outside mob aggro). */
const SPAWN_KEEP = 10;
const PLAYER_BASE_DMG = 22;
const PLAYER_ATK_CD = 0.42;
/**
 * The melee cooldown is checked against the wall clock (atkCd alone only ticks at
 * ~15 Hz, so a swing 0.42 s after the last could meet a sliver of cooldown and be
 * dropped silently — a phantom slash on the client). One blow may arrive up to
 * the grace early (network jitter, client frame quantization), but the early
 * part is carried forward as debt: the sustained rate stays one blow per
 * PLAYER_ATK_CD however a client paces its packets. The client swings every
 * 0.44 s and sends at blade contact, so every honest swing lands.
 */
const PLAYER_ATK_GRACE = 0.06;
/** Hits closer together than this chain the melee combo (the hero's 3-swing cadence). */
const COMBO_CHAIN_MS = 900;
/** The 3rd blow of a chain (the client's overhead finisher) hits harder and shoves. */
const FINISHER_MULT = 1.3;
/** Walking speed the client predicts at (units/s) — the move budget's pace. */
const PLAYER_WALK_SPEED = 8;
/**
 * Move budget (room.handleMove): distance a pilgrim may cover refills on the wall
 * clock at PLAYER_WALK_SPEED × MOVE_SLACK (the client's soft-snap pull and step-in
 * ride a little over the walk), and at most MOVE_BANK is banked, so packets bunched
 * by network jitter still land in full — but no packet rate buys speed.
 */
const MOVE_SLACK = 1.3;
const MOVE_BANK = 3.2;
/** Dev probes only (never in production): moves skip the budget (scripted screenshot tours). */
const FREE_MOVE = process.env.SELVA_FREE_MOVE === "1" && process.env.NODE_ENV !== "production";
/** Dash cooldown (s); one may arrive this early (ms: jitter) — carried as debt. */
const DASH_CD = 4;
const DASH_GRACE_MS = 150;

/** Gale Bolt flight speed (units/s); the client bolt flies for the same `duration`. */
const GALE_BOLT_SPEED = 32;

/**
 * Fodder HP sits at two honest blows: a swing lands every ~0.44 s, so a pack gets its
 * telegraphed swipes off while you cut the first one down (one-hit fodder never swung).
 */
const MOB_HP = {
  whirl_shade: 45,
  gale_wisp: 20,
  gale_warden: 120,
  storm_heart: 90,
  gale_champion: 80,
  // Gluttony / mire archetypes (circle 3)
  mire_shade: 50,
  mud_wisp: 22,
  mire_warden: 130,
  mire_heart: 100,
  mire_champion: 88,
  // Avarice / weight archetypes (circle 4)
  weight_shade: 55,
  coin_wisp: 25,
  ledger_warden: 140,
  hoard_heart: 110,
  weight_champion: 96,
  // Wrath / Styx archetypes (circle 5)
  wrath_shade: 60,
  sullen_wisp: 28,
  fury_champion: 104,
  rage_heart: 120,
  boss: 200,
};

/** Per landed blow. Every attack is telegraphed now, so a blow that lands hits harder. */
const MOB_DMG = {
  whirl_shade: 8,
  gale_wisp: 6,
  gale_warden: 11,
  gale_champion: 12,
  mire_shade: 8,
  mud_wisp: 6,
  mire_warden: 12,
  mire_champion: 13,
  weight_shade: 7,
  coin_wisp: 6,
  ledger_warden: 13,
  weight_champion: 13,
  wrath_shade: 8,
  sullen_wisp: 6,
  fury_champion: 14,
  boss: 20,
};

/** Each circle deeper hits a little harder and lasts a little longer. */
const CANTO_TIER = {
  inferno_05: { hp: 1.0, dmg: 1.0 },
  inferno_06: { hp: 1.1, dmg: 1.15 },
  inferno_07: { hp: 1.15, dmg: 1.15 },
  inferno_08: { hp: 1.25, dmg: 1.25 },
};
function tierOf(cantoId) {
  return CANTO_TIER[cantoId] || { hp: 1, dmg: 1 };
}

/**
 * A pack's members wear a creature's name on their plates ("Coin Wisp", not the pack's
 * "Coin Wisps" / "South Spill" on each of four wisps); named characters (single foes,
 * the lovers, Cerbero…) keep their own. Pack names still head the content.
 */
const MEMBER_NAME = {
  coin_wisp: "Coin Wisp",
  weight_shade: "Weight Shade",
  weight_champion: "Weight Champion",
  mire_champion: "Mire Champion",
  mire_shade: "Mire Shade",
  mud_wisp: "Filth Wisp",
  wrath_shade: "Wrath Shade",
  sullen_wisp: "Sullen Wisp",
  fury_champion: "Fury Champion",
};
function memberName(pack) {
  if ((pack.count || 1) > 1 && MEMBER_NAME[pack.archetype]) {
    return /^sepolti$/i.test(String(pack.name || "")) ? "Sepolto" : MEMBER_NAME[pack.archetype];
  }
  return pack.name || (pack.champion ? "Gale Champion" : "Whirl Shade");
}

/** Boss pools sized so a fight spans a few telegraphed slams, not one burst. */
const BOSS_HP = {
  minos_gate: 520,
  triple_maw: 680,
  hoard_crush: 1825,
  argenti_fury: 2099,
};

/**
 * Armor mitigates a share of each hit with diminishing returns
 * (16 armor ≈ 35%, +18 Whirl Ward ≈ 53%), so gear matters without making foes harmless.
 */
function mitigate(dmg, armor) {
  const a = Math.max(0, Number(armor) || 0);
  const taken = Math.max(1, Math.round(dmg * (1 - a / (a + 30))));
  return { taken, soaked: Math.max(0, dmg - taken) };
}

const HEART_ARCHETYPES = new Set(["storm_heart", "mire_heart", "hoard_heart", "rage_heart"]);

/** Avarice measure: gale (wind) soft vs weights; infernal burst (pressure) bites harder. */
function weightMatchupMult(spellId, ent) {
  const arch = String(ent?.archetype || "");
  const isWeight =
    arch === "weight_shade" ||
    arch === "weight_champion" ||
    arch === "hoard_heart" ||
    arch === "ledger_warden" ||
    /^counterweight$/i.test(String(ent?.name || ""));
  if (!isWeight) return 1;
  if (spellId === "gale_bolt") return 0.82;
  if (spellId === "infernal_burst") return 1.22;
  return 1;
}


/** Player-facing rarity word for loot toasts ("Magic Cloak"; normal items stay plain). */
function rarityWord(r) {
  const k = String(r || "normal");
  if (k === "normal") return "";
  if (k === "canto_unique") return "Canto Unique ";
  return `${k.charAt(0).toUpperCase()}${k.slice(1)} `;
}

/** Compact Ash+Stelle tag for emit/daily toasts (1 Stelle = 1000 Ash). */
function ashStelleTag(ash) {
  const n = Math.max(0, Math.floor(Number(ash) || 0));
  const whole = Math.trunc(n / 1000);
  const frac = Math.abs(n % 1000);
  return `${n.toLocaleString()} Ash (${whole}.${String(frac).padStart(3, "0")} Stelle)`;
}


let entitySeq = 0;
function heartWards(room, e) {
  if (!e || HEART_ARCHETYPES.has(e.archetype) || e.kind === "boss") return false;
  for (const h of room.entities.values()) {
    if (!HEART_ARCHETYPES.has(h.archetype) || !(h.hp > 0)) continue;
    if (Math.hypot(h.x - e.x, h.y - e.y) <= 14) return true;
  }
  return false;
}

/** Avarice coin wisps weave while they chase (greed that slips). */
function avaCoinWeave(e, sx, sy, dt) {
  e._weaveT = (e._weaveT || 0) + dt;
  // Milder weave so burst (r≈4.2) still covers the pack cluster
  const weave = Math.sin(e._weaveT * 5.2 + (e.x || 0) * 0.2) * 0.32;
  let wx = sx - sy * weave;
  let wy = sy + sx * weave;
  const l = Math.hypot(wx, wy) || 1;
  return [wx / l, wy / l];
}

/** Avarice weight champions raise their discs a touch longer (0.62 s vs 0.55 s). */
const AVA_CHAMP_WIND = { windup: 0.62 };
const ATTACKS_WARDEN = new Set(["gale_warden", "mire_warden", "ledger_warden"]);

/** Remember every player who hurt a foe so kill XP can be shared. */
function noteHit(e, playerId) {
  if (!e || !playerId) return;
  if (e.kind !== "boss" && e.kind !== "mob") return;
  if (!e.hitBy) e.hitBy = new Set();
  e.hitBy.add(playerId);
}

/** Seconds before a slain boss returns while the canto is still occupied. */
const BOSS_RESPAWN_SEC = 75;

function cantoTitle(id) {
  return CANTOS[id]?.title || id;
}

/** True if player has first-cleared the given canto id. */
function hasCleared(playerId, cantoId) {
  if (!cantoId) return true;
  const ledger = players.get(playerId);
  return Boolean(ledger?.firstClears?.has(cantoId));
}

function eid(prefix) {
  entitySeq += 1;
  return `${prefix}_${entitySeq}`;
}

function dist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

/**
 * Push combatants outside the canto spawn bubble so an arriving (or waking)
 * pilgrim is never inside a pack's aggro radius (8) during the load-in.
 */
function enforceSpawnKeepout(room, minR = room.cantoId === "inferno_07" ? AVA_SPAWN_KEEP : SPAWN_KEEP) {
  if (room.canto?.role !== "combat") return;
  const sp = room.canto?.geo?.spawn;
  if (!sp) return;
  const b = room.canto.geo.bounds;
  for (const e of room.entities.values()) {
    if (e.kind !== "mob" && e.kind !== "boss") continue;
    const d = Math.hypot(e.x - sp.x, e.y - sp.y);
    if (d >= minR || d < 0.05) continue;
    const ux = (e.x - sp.x) / d;
    const uy = (e.y - sp.y) / d;
    e.x = clamp(sp.x + ux * minR, 1.5, b.width - 1.5);
    e.y = clamp(sp.y + uy * minR, 1.5, b.height - 1.5);
    // Re-home so leash does not drag them back onto the entrance
    e.homeX = e.x;
    e.homeY = e.y;
  }
}


/** Public look-only fields for remote player equipped slots (no affixes/stats). */
function slimEquippedLook(equipped) {
  const out = {};
  if (!equipped || typeof equipped !== "object") return out;
  for (const [slot, it] of Object.entries(equipped)) {
    if (!it || typeof it !== "object") continue;
    out[slot] = {
      id: it.id,
      baseId: it.baseId,
      name: it.name,
      slot: it.slot,
      equipSlot: it.equipSlot ?? slot,
      rarity: it.rarity,
    };
  }
  return out;
}

/** Strip private ledger fields from other players in room.players. */
function slimRemotePlayerSnap(full) {
  return {
    id: full.id,
    name: full.name,
    x: full.x,
    y: full.y,
    hp: full.hp,
    maxHp: full.maxHp,
    mana: full.mana,
    maxMana: full.maxMana,
    cantoId: full.cantoId,
    lv: full.lv,
    equipped: slimEquippedLook(full.equipped),
  };
}

function affOf(sess) {
  if (!sess) return undefined;
  const now = Date.now();
  const bits = [];
  const st = sess.status;
  if (st && st.until > now) {
    if (st.root) bits.push("root");
    else if ((st.slow ?? 1) < 0.98) bits.push("slow");
  }
  if (sess.weakenUntil > now) bits.push("weak");
  return bits.length ? bits.join(",") : undefined;
}

/** One authoritative instance per canto (Slice 1 single shard). */
class CantoRoom {
  constructor(cantoId) {
    this.canto = CANTOS[cantoId];
    if (!this.canto) throw new Error(`unknown canto ${cantoId}`);
    this.cantoId = cantoId;
    this.entities = new Map();
    this.sessions = new Map(); // playerId -> { ws, x, y, hp, maxHp, mana, maxMana, atkCd, spellCd }
    this.dirty = false;
    this._snapAcc = 0;
    /** Ground telegraphs (windup attacks, boss slams, mechanic hazards). */
    this.tele = new Telegraphs(this);
    /** Delayed effects (gale bolt arrival…): { left, fn } */
    this.pending = [];
    /** Canto mechanic hooks (cantoMech/*); {} when the canto has none. */
    this.mech = getMech(cantoId);
    this.spawnWorld();
  }

  spawnWorld() {
    this.entities.clear();
    this.bossRespawns = [];
    const g = this.canto.geo;

    for (const poi of g.pois || []) {
      this.entities.set(poi.id, {
        id: poi.id,
        kind: "poi",
        name: poi.label || poi.id,
        x: poi.x,
        y: poi.y,
        poiKind: poi.kind,
        label: poi.label,
        hint: poi.hint || null,
        toCanto: poi.to_canto || null,
        requireClear: poi.require_clear || null,
      });
    }

    for (const ex of g.exits || []) {
      const id = eid("exit");
      this.entities.set(id, {
        id,
        kind: "exit",
        name: ex.label || ex.to_canto,
        x: ex.x,
        y: ex.y,
        label: ex.label,
        hint: ex.hint || null,
        toCanto: ex.to_canto,
        requireClear: ex.require_clear || null,
      });
    }

    for (const pack of this.canto.packs || []) {
      this.spawnPackMembers(pack);
    }

    for (const boss of this.canto.bosses || []) this.spawnBoss(boss);
    enforceSpawnKeepout(this);
    this.tele?.clear();
    if (this.pending) this.pending.length = 0;
    this.mech?.init?.(this);
  }

  spawnBoss(boss) {
    const id = boss.id;
    this.entities.set(id, {
      id,
      kind: "boss",
      name: boss.name,
      x: boss.anchor.x,
      y: boss.anchor.y,
      hp: BOSS_HP[boss.id] || MOB_HP.boss,
      maxHp: BOSS_HP[boss.id] || MOB_HP.boss,
      dropTable: boss.drop_table,
      firstClearEmit: boss.first_clear_emit !== false,
      atkCd: 0,
    });
  }

  /**
   * A slain boss returns after BOSS_RESPAWN_SEC while players remain, so someone
   * who arrives after another pilgrim's kill is never locked out of the gate.
   */
  tickBossRespawns(dt) {
    if (!this.bossRespawns.length) return;
    const keep = [];
    for (const r of this.bossRespawns) {
      r.left -= dt;
      if (r.left > 0 || this.entities.has(r.boss.id)) {
        if (r.left > 0) keep.push(r);
        continue;
      }
      // Never pop the boss on top of someone standing on the dais
      const a = r.boss.anchor;
      let crowded = false;
      for (const s of this.sessions.values()) {
        if (Math.hypot(s.x - a.x, s.y - a.y) < 7) crowded = true;
      }
      if (crowded) {
        r.left = 4;
        keep.push(r);
        continue;
      }
      this.spawnBoss(r.boss);
      this.markDirty();
      for (const s of this.sessions.values()) {
        this.toast(s.ws, "warn", `${r.boss.name} rises again.`);
      }
    }
    this.bossRespawns = keep;
  }

  join(ws, playerId, name) {
    const ledger = getOrCreatePlayer(playerId, name);
    // Empty bag → grant and wear a weapon + cape, so a new pilgrim starts looking
    // (and swinging) like the hero instead of a bare tunic with an invisible blade.
    if (!ledger.inventory || ledger.inventory.length === 0) {
      const kit = makeStarterKitItems();
      void Promise.all(
        kit.map((item) => grantInventoryItem(playerId, item).then(() => equipItem(playerId, item.id)))
      )
        .then(() => {
          const s = this.sessions.get(playerId);
          if (s) applyPlayerStats(s, { refill: true });
          this.pushSnapshot(playerId);
        })
        .catch((err) => console.error("[starter] grant failed", err.message));
      this.toast(ws, "loot", "Starter kit worn: Ashen Club + Torn Cape.");
    }
    const spawn = this.canto.geo.spawn;
    getProgress(playerId);
    const st = playerCombatStats(playerId);
    const sess = {
      ws,
      playerId,
      x: spawn.x,
      y: spawn.y,
      hp: st.maxHp,
      maxHp: st.maxHp,
      mana: st.maxMana,
      maxMana: st.maxMana,
      atkCd: 0,
      sipCd: 0,
      dashCd: 0,
      spellCd: { gale_bolt: 0, whirl_ward: 0, infernal_burst: 0 },
      armorBuff: 0,
      wardUntil: 0,
      iframes: 0,
      cantoId: this.cantoId,
    };
    this.sessions.set(playerId, sess);
    // Veteran catch-up levels inside grantXp → onLevelUp, which refills stats.
    // hello / travel push the snapshot after join returns, so it sees the new level.
    applyCatchup(this, sess);
    try {
      pvpOnJoin(this, sess);
    } catch (err) {
      console.error("[pvp] join", err.message);
    }
    // Everyone already here sees the newcomer on the next tick, not on their first move
    this.markDirty();
    if (this.cantoId !== "inferno_01") {
      ledger.visitedInferno = true;
      void persistPlayerFlags(playerId).catch((err) =>
        console.error("[db] persist visitedInferno failed", err.message)
      );
    }
    return sess;
  }


  /** Spawn all members of one content pack (world seed + fair respawn). */
  spawnPackMembers(pack) {
    const count = pack.count;
    for (let i = 0; i < count; i++) {
      const id = eid("mob");
      // Avarice: wider ring so weight packs don't stack on the scorched road
      const ava = this.cantoId === "inferno_07";
      const ring = (ava ? 2.9 : 2.4) + count * (ava ? 0.58 : 0.45);
      const ang = (i / Math.max(1, count)) * Math.PI * 2 + Math.random() * 0.2;
      const jit = ava ? 0.85 : 0.6;
      const ox = Math.cos(ang) * ring + (Math.random() - 0.5) * jit;
      const oy = Math.sin(ang) * ring + (Math.random() - 0.5) * jit;
      const arch = pack.archetype || "whirl_shade";
      let maxHp = Math.round(
        (MOB_HP[arch] || (pack.champion ? MOB_HP.gale_champion : MOB_HP.whirl_shade)) *
          tierOf(this.cantoId).hp
      );
      // Counterweight mid-boss: tankier than other weight champions
      if (pack.id === "ava_counterweight") maxHp = Math.round(maxHp * 1.35);
      this.entities.set(id, {
        id,
        kind: "mob",
        name: memberName(pack),
        x: pack.anchor.x + ox,
        y: pack.anchor.y + oy,
        hp: maxHp,
        maxHp,
        packId: pack.id,
        champion: Boolean(pack.champion),
        elite: Boolean(pack.elite),
        dropTable: pack.drop_table,
        archetype: arch,
        atkCd: 0,
      });
    }
  }

  leave(playerId) {
    const sess = this.sessions.get(playerId);
    try {
      pvpOnRoomLeave(this, playerId, sess?._pvpLeaveReason || "disconnect");
    } catch (err) {
      console.error("[pvp] leave", err.message);
    }
    try {
      cleanupPlayerSkills(this, playerId);
    } catch (err) {
      console.error("[skills] leave", err.message);
    }
    this.sessions.delete(playerId);
    // Others drop the leaver's pilgrim on the next tick (an idle room pushes nothing otherwise)
    this.markDirty();
    // Respawn combat content when instance empties (Slice 1 single shard)
    if (this.sessions.size === 0 && this.canto.role === "combat") {
      this.spawnWorld();
    }
  }

  send(ws, msg) {
    if (ws.readyState === 1) ws.send(JSON.stringify(msg));
  }

  broadcast(msg, exceptId = null) {
    const data = JSON.stringify(msg);
    for (const [pid, s] of this.sessions) {
      if (pid === exceptId) continue;
      if (s.ws.readyState === 1) s.ws.send(data);
    }
  }

  toast(ws, level, text) {
    this.send(ws, { type: "toast", level, text });
  }

  /** Canto-flavored death wake line (Avarice uses misura copy; no Lust/Glut regression). */
  deathWakeToast(ws) {
    const line =
      this.cantoId === "inferno_07"
        ? "misura spezzata — you fall, and wake at the ledger gate."
        : this.cantoId === "inferno_06"
          ? "You are slain… and wake at the canto entrance."
          : this.cantoId === "inferno_05"
            ? "You are slain… and wake at the canto entrance."
            : "You are slain… and wake at the canto entrance.";
    this.toast(ws, "warn", line);
  }

  buildSnapshot(forPlayerId) {
    const youSess = this.sessions.get(forPlayerId);
    const ledger = players.get(forPlayerId);
    const entities = [];
    for (const e of this.entities.values()) {
      // (positions to the centimetre, whole HP: a phone's snapshot is mostly this list)
      entities.push({
        id: e.id,
        kind: e.kind,
        name: e.name,
        x: Math.round(e.x * 100) / 100,
        y: Math.round(e.y * 100) / 100,
        hp: e.hp > 0 ? Math.ceil(e.hp) : e.hp,
        maxHp: e.maxHp,
        packId: e.packId,
        champion: e.champion,
        elite: e.elite,
        archetype: e.archetype,
        poiKind: e.poiKind,
        label: e.label,
        hint: e.hint || undefined,
        toCanto: e.toCanto,
        requireClear: e.requireClear || undefined,
        item: e.item,
        // Avarice/Lust/Glut bell still — client gold measure tint
        stunLeft: e.stunLeft > 0.05 ? Math.round(e.stunLeft * 5) / 5 : undefined,
        enraged: e.enraged ? 1 : undefined,
        rootLeft: e.rootLeft > 0.05 ? Math.round(e.rootLeft * 5) / 5 : undefined,
        weakenLeft: e.weakenLeft > 0.05 ? Math.round(e.weakenLeft * 5) / 5 : undefined,
        slowLeft: e.slowLeft > 0.05 ? Math.round(e.slowLeft * 5) / 5 : undefined,
        windupLeft:
          (e.kind === "boss" || e.champion || e.archetype === "weight_champion") && e.windupLeft > 0
            ? Math.round(e.windupLeft * 100) / 100
            : undefined,
        phase: e.kind === "boss" && e.phase ? e.phase : undefined,
      });
    }
    const playerSnaps = [];
    for (const [pid, s] of this.sessions) {
      // Arena spectators are unseen by everyone else
      if (s.spectating && pid !== forPlayerId) continue;
      const led = players.get(pid);
      const full = snapshotPlayer(led, {
        x: Math.round(s.x * 100) / 100,
        y: Math.round(s.y * 100) / 100,
        hp: s.hp,
        maxHp: s.maxHp,
        mana: s.mana,
        maxMana: s.maxMana,
        cantoId: this.cantoId,
      });
      full.lv = getLevel(pid);
      const fl = flairOf(pid);
      if (fl) full.flair = fl;
      // Remotes: slim equipped for look only; strip inventory/ash/private fields.
      // Local "you" snapshot below stays full.
      if (pid === forPlayerId) {
        playerSnaps.push(full);
      } else {
        const slim = slimRemotePlayerSnap(full);
        slim.lv = full.lv;
        if (full.flair) slim.flair = full.flair;
        const aff = affOf(s);
        if (aff) slim.aff = aff;
        try {
          const pv = pvpRemote(this, s);
          if (pv) slim.pvp = pv;
        } catch (err) {
          console.error("[pvp] remote snap", err.message);
        }
        playerSnaps.push(slim);
      }
    }
    const mech = this.mech.snapshotExtra ? this.mech.snapshotExtra(this, youSess) : undefined;
    let pvpExtra = {};
    let youPvp;
    try {
      pvpExtra = pvpRoomFields(this);
      youPvp = youSess ? pvpYou(this, youSess) : undefined;
    } catch (err) {
      console.error("[pvp] snap", err.message);
    }
    let skillFx;
    try {
      skillFx = skillFxSnapshot(this);
    } catch (err) {
      console.error("[skills] snap", err.message);
    }
    return {
      cantoId: this.cantoId,
      // Server clock of the tick that moved these positions (event snapshots between
      // ticks repeat it, so the client refreshes that sample instead of adding a stale
      // one); the client interpolates entities on it
      st: this._tickAt && Date.now() - this._tickAt < 250 ? this._tickAt : Date.now(),
      ...(mech !== undefined ? { mech } : {}),
      ...pvpExtra,
      title: this.canto.title,
      subtitleIt: this.canto.subtitle_it || this.canto.subtitleIt || null,
      role: this.canto.role,
      bounds: this.canto.geo.bounds,
      entities,
      players: playerSnaps,
      ...(skillFx && skillFx.length ? { skillFx } : {}),
      you: {
        ...snapshotPlayer(ledger, {
          x: Math.round(youSess.x * 100) / 100,
          y: Math.round(youSess.y * 100) / 100,
          hp: youSess.hp,
          maxHp: youSess.maxHp,
          mana: youSess.mana,
          maxMana: youSess.maxMana,
          cantoId: this.cantoId,
        }),
        armorBuff: youSess.armorBuff || 0,
        wardUntil: youSess.wardUntil || 0,
        lv: getLevel(forPlayerId),
        prog: progSnapshot(forPlayerId, youSess),
        ...(affOf(youSess) ? { aff: affOf(youSess) } : {}),
        // Client: Ledger/Mire/Gale bell quiet → Guide / measure pathing
        bellCd: youSess.bellCd > 0 ? Number(youSess.bellCd) : 0,
        // Client: Ledger Cache empty mesh (session-local claim)
        lootedCache: Boolean(youSess.lootedCache),
        ...(youPvp ? { pvp: youPvp } : {}),
      },
    };
  }

  pushSnapshot(playerId) {
    const s = this.sessions.get(playerId);
    if (!s) return;
    this.send(s.ws, { type: "snapshot", room: this.buildSnapshot(playerId) });
  }

  pushAllSnapshots() {
    for (const pid of this.sessions.keys()) this.pushSnapshot(pid);
  }

  handleMove(playerId, x, y) {
    const s = this.sessions.get(playerId);
    if (!s || pvpIsDown(s)) return;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    pvpTouch(s);
    const b = this.canto.geo.bounds;
    const clampArena = this.canto.geo.wrap === false;
    const now = Date.now();
    // Real wall-clock time since the last move packet (no floor: a flood of packets
    // earns no extra walking — every budget below refills on this clock)
    const dtMove = s._lastMoveAt ? Math.min(0.5, Math.max(0, (now - s._lastMoveAt) / 1000)) : 0.05;
    s._lastMoveAt = now;
    const st = s.status && s.status.until > now ? s.status : null;
    const slow = st ? (st.root ? 0 : st.slow) : 1;
    // Move budget: refills at the walk pace × slack (× a slow, + a canto's drift),
    // banks at most MOVE_BANK (less while slowed) for packets bunched by jitter
    const rate = PLAYER_WALK_SPEED * MOVE_SLACK * slow + (this.mech.moveAllowance?.(this, s) || 0);
    const bank = st ? Math.max(0.5, MOVE_BANK * slow) : MOVE_BANK;
    const budget = Math.min(bank, (s._moveBudget ?? MOVE_BANK) + rate * dtMove);
    const credit = s.shoveAllow > 0 ? s.shoveAllow : 0;
    if (st?.root) {
      // rooted feet stay put (a shove still carries you: its credit)
      x = s.x;
      y = s.y;
    }
    // Shortest step on the torus, so a client that already wrapped (x≈0.3, s.x≈159.8)
    // is a tiny step, not a teleport. The budget spends that delta.
    // A walled pit (geo.wrap === false) uses the plain step and clamps at the wall.
    let dx = clampArena ? x - s.x : wrapDelta(x - s.x, b.width);
    let dy = clampArena ? y - s.y : wrapDelta(y - s.y, b.height);
    const d = Math.hypot(dx, dy);
    const allow = FREE_MOVE ? MOVE_SPEED : Math.min(MOVE_SPEED, budget + credit);
    if (d > allow && d > 0) {
      const k = allow / d;
      dx *= k;
      dy *= k;
    }
    // Unwrapped end: canto adjustMove (rocks, mire) sees a continuous segment.
    x = s.x + dx;
    y = s.y + dy;
    if (this.mech.adjustMove) {
      const to = this.mech.adjustMove(this, s, { x: s.x, y: s.y }, { x, y }, dtMove);
      if (to && Number.isFinite(to.x) && Number.isFinite(to.y)) {
        x = to.x;
        y = to.y;
      }
    }
    // Spend: the shove's credit first, then the budget; the credit also fades with time
    const moved = Math.hypot(x - s.x, y - s.y);
    const useCredit = Math.min(credit, moved);
    s.shoveAllow = Math.max(0, credit - useCredit - PLAYER_WALK_SPEED * dtMove);
    s._moveBudget = Math.max(0, budget - (moved - useCredit));
    let nx = x;
    let ny = y;
    // Bodies: pilgrims slide around foes instead of walking through them (every canto;
    // the client predicts the same push-out). Bell-stilled foes can be walked through.
    // Push stays in unwrapped space (mobs are inside the bounds); the result wraps.
    for (const e of this.entities.values()) {
      if ((e.kind !== "mob" && e.kind !== "boss") || !(e.hp > 0)) continue;
      if ((e.stunLeft || 0) > 0.05) continue;
      const rad = bodyRadius(e, this.cantoId);
      const ex = nx - e.x;
      const ey = ny - e.y;
      if (Math.abs(ex) >= rad || Math.abs(ey) >= rad) continue;
      const dR = Math.hypot(ex, ey);
      if (dR >= rad || dR < 0.001) continue;
      nx = e.x + (ex / dR) * rad;
      ny = e.y + (ey / dR) * rad;
    }
    if (!Number.isFinite(nx) || !Number.isFinite(ny)) return;
    const mdx = nx - s.x;
    const mdy = ny - s.y;
    if (Math.hypot(mdx, mdy) > 0.05) {
      const ml = Math.hypot(mdx, mdy) || 1;
      s._lastFaceX = mdx / ml;
      s._lastFaceY = mdy / ml;
    }
    const placed = placeBody(this, nx, ny);
    s.x = placed.x;
    s.y = placed.y;
    this.markDirty();
  }

  /**
   * A player's blow lands on a mob or boss: canto onDamage hook, HP, boss credit,
   * reactions (knockback impulse, light stagger on atkCd, poise that breaks a champion
   * windup; a heavy blow breaks a fodder windup), the combat broadcast and the kill.
   * extra: { spellId, heavy, from: {x,y} (knockback source), kbMul, source (a hazard's
   * id: the blow is the world's — combat attackerId + from on the wire — while
   * playerId keeps the kill credit) }. Returns the damage.
   */
  damageMob(v, hit, playerId, extra = {}) {
    if (!v || v._dead) return 0;
    if (this.mech.onDamage) {
      hit = this.mech.onDamage(this, v, hit, {
        id: playerId,
        kind: "player",
        playerId,
        spellId: extra.spellId,
      });
    }
    hit = Math.max(0, Math.round(Number(hit) || 0));
    // a boss walking home off its leash is not to be whittled on the way (no heal there)
    const evade = v.kind === "boss" && v.resetting && hit > 0;
    if (evade) hit = 0;
    v.hp = Math.max(0, v.hp - hit);
    noteHit(v, playerId);
    let kb = 0;
    if (v.hp > 0 && !evade && !HEART_ARCHETYPES.has(v.archetype)) {
      kb = knockbackFor(v, extra.heavy) * (extra.kbMul ?? 1);
      if (extra.from && kb > 0) pushMob(v, v.x - extra.from.x, v.y - extra.from.y, kb);
      if (v.kind === "mob") {
        const champ = isChampionClass(v);
        // light stagger: its next blow comes a beat later
        v.atkCd = Math.min(1.4, (v.atkCd || 0) + (champ ? 0.05 : 0.1));
        // poise only counts blows thrown into a windup (reset when one starts)
        if (champ && v.teleId) {
          v.poise = (v.poise || 0) + (extra.heavy || extra.spellId === "dash" ? POISE_HEAVY : 1);
        }
        if (v.teleId && (champ ? v.poise >= POISE_BREAK : extra.heavy)) {
          interruptAttack(this, v, champ ? 0.7 : 0.4);
        }
      }
    }
    const env = extra.source && extra.from;
    this.broadcast({
      type: "combat",
      attackerId: extra.source || playerId,
      targetId: v.id,
      damage: hit,
      targetHp: v.hp,
      spellId: extra.spellId,
      heavy: extra.heavy || undefined,
      evade: evade || undefined,
      kb: kb > 0 ? +kb.toFixed(2) : undefined,
      fx: env ? +extra.from.x.toFixed(1) : undefined,
      fy: env ? +extra.from.y.toFixed(1) : undefined,
    });
    if (v.hp <= 0) this.onEntityKilled(playerId, v);
    return hit;
  }

  handleAttack(playerId, targetId, combo) {
    const s = this.sessions.get(playerId);
    if (!s || pvpIsDown(s)) return;
    pvpTouch(s);
    pvpBreakInvuln(s);
    const now = Date.now();
    if (now < (s.atkReadyAt || 0) - PLAYER_ATK_GRACE * 1000) return;
    const other = this.sessions.get(targetId);
    if (other && other !== s) {
      try {
        pvpMelee(this, s, other, combo);
      } catch (err) {
        console.error("[pvp] melee", err.message);
      }
      return;
    }
    const target = this.entities.get(targetId);
    if (!target) return;
    if (target.kind !== "mob" && target.kind !== "boss") {
      this.toast(s.ws, "warn", "Nothing to strike.");
      return;
    }
    // A canto mechanic may spend this swing on its own action (it has its own reach)
    if (this.mech.onAttack?.(this, s, target, combo)) {
      s.atkCd = PLAYER_ATK_CD;
      s.atkReadyAt = Math.max(now, s.atkReadyAt || 0) + PLAYER_ATK_CD * 1000;
      return;
    }
    if (!(dist(s, target) <= ATTACK_RANGE)) {
      // Quiet OOR: longer gap + info (not warn) so measure spam stays bone-soft
      if (!s._oorToastAt || now - s._oorToastAt > 2400) {
        s._oorToastAt = now;
        this.toast(s.ws, "info", "Too far.");
      }
      return;
    }
    s.atkCd = PLAYER_ATK_CD;
    s.atkReadyAt = Math.max(now, s.atkReadyAt || 0) + PLAYER_ATK_CD * 1000;
    // Combo: the client swings forehand → backhand → overhead (combo 0/1/2). The
    // server counts the chain itself, so a finisher needs two blows landed before it.
    const chain = now - (s.lastBlowAt || 0) < COMBO_CHAIN_MS ? (s.chain || 0) + 1 : 0;
    const finisher = Number(combo) === 2 && chain >= 2;
    s.chain = finisher ? -1 : chain;
    s.lastBlowAt = now;
    const st = playerCombatStats(playerId);
    let dmg = Math.round(st.weaponDmg) + Math.floor(Math.random() * 6);
    if (finisher) dmg = Math.round(dmg * FINISHER_MULT);
    dmg = Math.max(1, Math.round(dmg * meleeDmgMult(playerId, false) * warCryMult(s) * weakenMult(s)));
    const victims = [target];
    for (const e of this.entities.values()) {
      if (e === target || (e.kind !== "mob" && e.kind !== "boss")) continue;
      if (!(dist(s, e) <= ATTACK_RANGE + 0.35)) continue;
      if (dist(target, e) > 2.6) continue;
      victims.push(e);
    }
    let dealt = 0;
    for (const v of victims) {
      if (v._dead) continue;
      let hit = v === target ? dmg : Math.max(8, Math.round(dmg * 0.55));
      if (heartWards(this, v)) hit = Math.max(1, Math.round(hit * 0.7));
      dealt += this.damageMob(v, hit, playerId, {
        heavy: finisher,
        from: s,
        kbMul: v === target ? 1 : 0.6,
      });
    }
    applyLifesteal(s, dealt, false, this);
    // The combat broadcasts carry targetHp; the next tick's snapshot (<=80ms) syncs the
    // rest instead of an extra ~8KB snapshot to every player on every swing
    this.markDirty();
  }

  handleCast(playerId, spellId, aimX, aimY) {
    const s = this.sessions.get(playerId);
    if (!s || pvpIsDown(s)) return;
    pvpTouch(s);
    pvpBreakInvuln(s);
    let plan;
    try {
      plan = beginCast(this, s, spellId, aimX, aimY);
    } catch (err) {
      console.error("[skills] begin", err.message);
      return;
    }
    if (!plan) return;
    if (plan.existing) {
      const spell = plan.spell;
      if (spell.id === "gale_bolt") {
        this._castGaleBolt(playerId, s, spell, aimX, aimY);
        return;
      }
      if (spell.id === "whirl_ward") {
        this._castWhirlWard(playerId, s, spell);
        return;
      }
      if (spell.id === "infernal_burst") {
        this._castInfernalBurst(playerId, s, spell);
        return;
      }
    }
    try {
      castActive(this, s, plan.def, plan.rank, aimX, aimY);
    } catch (err) {
      console.error("[skills] cast", err.message);
    }
  }

  cleanupPlayerSkills(playerId) {
    cleanupPlayerSkills(this, playerId);
  }

  _spendSpell(s, spell) {
    s.mana = Math.max(0, s.mana - spell.manaCost);
    if (!s.spellCd) s.spellCd = {};
    s.spellCd[spell.id] = spell.cooldown;
    if (!s.spellReadyAt) s.spellReadyAt = {};
    const now = Date.now();
    s.spellReadyAt[spell.id] = Math.max(now, s.spellReadyAt[spell.id] || 0) + spell.cooldown * 1000;
  }

  _nearestFoe(from, maxRange) {
    let best = null;
    let bestD = maxRange;
    for (const e of this.entities.values()) {
      if (e.kind !== "mob" && e.kind !== "boss") continue;
      const d = dist(from, e);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }

  _foeInAim(from, aimX, aimY, maxRange, coneCos = 0.35) {
    const hasAim =
      Number.isFinite(aimX) && Number.isFinite(aimY) && (aimX !== 0 || aimY !== 0);
    if (!hasAim) return this._nearestFoe(from, maxRange);
    const len = Math.hypot(aimX, aimY) || 1;
    const ax = aimX / len;
    const ay = aimY / len;
    let best = null;
    let bestScore = Infinity;
    for (const e of this.entities.values()) {
      if (e.kind !== "mob" && e.kind !== "boss") continue;
      const dx = e.x - from.x;
      const dy = e.y - from.y;
      const d = Math.hypot(dx, dy);
      if (d > maxRange || d < 0.01) continue;
      const dot = (dx / d) * ax + (dy / d) * ay;
      if (dot < coneCos) continue;
      // Prefer closer targets still roughly in the aim cone
      const score = d - dot * 2;
      if (score < bestScore) {
        bestScore = score;
        best = e;
      }
    }
    return best || this._nearestFoe(from, maxRange);
  }

  _castGaleBolt(playerId, s, spell, aimX, aimY) {
    const target = this._foeInAim(s, aimX, aimY, spell.range);
    let pvpT = null;
    try {
      pvpT = pvpAimTarget(this, s, aimX, aimY, spell.range);
    } catch (err) {
      console.error("[pvp] aim", err.message);
    }
    const foeD = target ? dist(s, target) : Infinity;
    const pvpD = pvpT ? Math.hypot(pvpT.x - s.x, pvpT.y - s.y) : Infinity;
    if (pvpT && pvpD <= foeD) {
      this._spendSpell(s, spell);
      const gear = computeGearStats(players.get(playerId) || { inventory: [] });
      const raw = Math.max(
        1,
        Math.round(
          (spell.baseDamage +
            Math.floor(gear.dmg * 0.55) +
            Math.floor(Math.random() * (spell.damageVar + 1))) *
            spellDmgMult(playerId, true)
        )
      );
      const travel = Math.min(0.32, Math.max(0.08, pvpD / GALE_BOLT_SPEED));
      const impact = { x: pvpT.x, y: pvpT.y };
      const targetId = pvpT.playerId;
      this.broadcast({
        type: "spell_fx",
        spellId: spell.id,
        casterId: playerId,
        x: s.x,
        y: s.y,
        tx: impact.x,
        ty: impact.y,
        duration: +travel.toFixed(3),
      });
      this.schedule(travel, () => {
        try {
          pvpLandBolt(this, playerId, targetId, raw, impact);
        } catch (err) {
          console.error("[pvp] bolt", err.message);
        }
      });
      this.markDirty();
      return;
    }
    let tx = s.x;
    let ty = s.y;
    if (Number.isFinite(aimX) && Number.isFinite(aimY) && (aimX !== 0 || aimY !== 0)) {
      const len = Math.hypot(aimX, aimY) || 1;
      tx = s.x + (aimX / len) * spell.range;
      ty = s.y + (aimY / len) * spell.range;
    } else if (s._lastFaceX != null) {
      tx = s.x + s._lastFaceX * spell.range;
      ty = s.y + s._lastFaceY * spell.range;
    }

    this._spendSpell(s, spell);

    if (target) {
      tx = target.x;
      ty = target.y;
      const gear = computeGearStats(players.get(playerId) || { inventory: [] });
      let dmg =
        spell.baseDamage +
        Math.floor(gear.dmg * 0.55) +
        Math.floor(Math.random() * (spell.damageVar + 1));
      dmg = Math.max(1, Math.round(dmg * spellDmgMult(playerId, false)));
      if (heartWards(this, target)) dmg = Math.max(1, Math.round(dmg * 0.7));
      dmg = Math.max(1, Math.round(dmg * weightMatchupMult(spell.id, target)));
      // The bolt flies (≈32 u/s): the blow lands when it arrives, not on the cast frame
      const travel = Math.min(0.32, Math.max(0.08, dist(s, target) / GALE_BOLT_SPEED));
      this.broadcast({
        type: "spell_fx",
        spellId: spell.id,
        casterId: playerId,
        x: s.x,
        y: s.y,
        tx: target.x,
        ty: target.y,
        duration: +travel.toFixed(3),
      });
      const from = { x: s.x, y: s.y };
      this.schedule(travel, () => {
        if (target._dead || !this.entities.has(target.id)) return;
        this.damageMob(target, dmg, playerId, { spellId: spell.id, from });
      });
      this.markDirty(); // mana rides the tick snapshot
    } else {
      this.broadcast({
        type: "spell_fx",
        spellId: spell.id,
        casterId: playerId,
        x: s.x,
        y: s.y,
        tx,
        ty,
        duration: 0.28,
      });
      this.toast(s.ws, "info", "Gale Bolt lashes empty air…");
      this.pushSnapshot(playerId);
    }
  }

  _castWhirlWard(playerId, s, spell) {
    this._spendSpell(s, spell);
    s.armorBuff = spell.armorBonus;
    s.wardUntil = spell.duration;
    this.broadcast({
      type: "spell_fx",
      spellId: spell.id,
      casterId: playerId,
      x: s.x,
      y: s.y,
      duration: spell.duration,
      radius: 1.6,
    });
    this.toast(s.ws, "info", `Whirl Ward — +${spell.armorBonus} armor`);
    this.pushAllSnapshots();
  }

  _castInfernalBurst(playerId, s, spell) {
    this._spendSpell(s, spell);
    const gear = computeGearStats(players.get(playerId) || { inventory: [] });
    const rolled =
      spell.baseDamage +
      Math.floor(gear.dmg * 0.7) +
      Math.floor(Math.random() * (spell.damageVar + 1));
    const base = Math.max(1, Math.round(rolled * spellDmgMult(playerId, false)));
    const hit = [];
    for (const e of [...this.entities.values()]) {
      if (e.kind !== "mob" && e.kind !== "boss") continue;
      if (e._dead) continue;
      if (!(dist(s, e) <= spell.radius)) continue;
      let dmg = base + Math.floor(Math.random() * 5);
      if (heartWards(this, e)) dmg = Math.max(1, Math.round(dmg * 0.7));
      dmg = Math.max(1, Math.round(dmg * weightMatchupMult(spell.id, e)));
      hit.push({ ent: e, dmg });
    }
    this.broadcast({
      type: "spell_fx",
      spellId: spell.id,
      casterId: playerId,
      x: s.x,
      y: s.y,
      radius: spell.radius,
    });
    // The burst blows everything outward (heavy shove)
    for (const h of hit) this.damageMob(h.ent, h.dmg, playerId, { spellId: spell.id, from: s, heavy: true });
    try {
      pvpBurst(this, s, Math.round(rolled * spellDmgMult(playerId, true)), spell.radius);
    } catch (err) {
      console.error("[pvp] burst", err.message);
    }
    // Combat msgs carry targetHp (kills already pushed); mana rides the next tick snapshot
    this.markDirty();
  }

  onEntityKilled(killerId, entity) {
    // A Heart's death burst can kill foes that an outer damage loop (cleave,
    // Infernal Burst, Dash) still holds — never pay out the same corpse twice.
    if (!entity || entity._dead || !this.entities.has(entity.id)) return;
    entity._dead = true;
    // A windup dies with its owner — every telegraph it owns (a boss's rings and lines
    // are not all on entity.teleId), so none lands after the killing blow
    this.tele.cancelBy(entity.id, "death");
    challengesOnMobKill(this, killerId, entity);
    const killer = this.sessions.get(killerId);
    const ledger = players.get(killerId);
    const dropTable = entity.dropTable || "inferno_pack_common";
    const isBoss = entity.kind === "boss";
    const isChampion = Boolean(entity.champion);

    const drops = rollDrops(dropTable, {
      champion: isChampion,
      boss: isBoss,
    });

    let dropI = 0;
    for (const item of drops) {
      const lootId = eid("loot");
      let ox;
      let oy;
      if (this.cantoId === "inferno_07" && isBoss) {
        // Hoard Crush pile: ring fan so weighed drops stay readable (no neon stack)
        const n = Math.max(1, drops.length);
        const ang = (dropI / n) * Math.PI * 2 + 0.31 + Math.random() * 0.28;
        const r = 1.75 + (dropI % 3) * 0.55 + Math.random() * 0.4;
        ox = Math.cos(ang) * r;
        oy = Math.sin(ang) * r;
      } else if (this.cantoId === "inferno_07") {
        const ang = Math.random() * Math.PI * 2;
        const r = 0.7 + Math.random() * 1.35;
        ox = Math.cos(ang) * r;
        oy = Math.sin(ang) * r;
      } else {
        ox = (Math.random() - 0.5) * 1.5;
        oy = (Math.random() - 0.5) * 1.5;
      }
      dropI++;
      this.entities.set(lootId, {
        id: lootId,
        kind: "loot",
        name: item.name,
        x: entity.x + ox,
        y: entity.y + oy,
        item,
      });
    }

    if (HEART_ARCHETYPES.has(entity.archetype)) {
      for (const e of [...this.entities.values()]) {
        if (e === entity || e.kind !== "mob" || e._dead) continue;
        if (Math.hypot(e.x - entity.x, e.y - entity.y) > 14) continue;
        this.damageMob(e, 22, killerId, { spellId: "heart", from: entity, heavy: true });
      }
      if (killer) this.toast(
        killer.ws,
        "emit",
        entity.archetype === "hoard_heart"
          ? "The Hoard Heart bursts — the Counterweight stirs; Plutus waits past the east clash."
          : entity.archetype === "mire_heart"
            ? "The Mire Heart bursts — Cerbero stirs."
            : entity.archetype === "rage_heart"
              ? "The Rage Heart bursts — the wrathful falter in the mud."
              : "The Storm Heart shatters."
      );
    }

    // Canto mechanic sees the kill with the loot on the ground (entity still listed)
    this.mech.onKilled?.(this, entity);
    this.entities.delete(entity.id);
    this.broadcast({ type: "entity_removed", id: entity.id });
    try {
      grantKillXp(this, killerId, entity);
    } catch (err) {
      console.error("[prog] kill xp", err.message);
    }
    if (entity.packId && killer && !entity.summoned) {
      let left = 0;
      for (const e of this.entities.values()) {
        if (e.packId === entity.packId && e.kind === "mob") left++;
      }
      if (left === 0) {
        // Hoard Heart already fired its emit death beat — skip redundant pack-clear toast
        if (entity.archetype === "hoard_heart") {
          /* death beat owned by emit toast + client cam */
        } else {
          const line =
            this.cantoId === "inferno_08"
              ? "The mud stills. Press on."
              : this.cantoId === "inferno_07"
                ? entity.archetype === "coin_wisp"
                  ? "contrapeso — the coins still; measure holds."
                  : "contrapeso — the weights settle; rebalance and press on."
                : this.cantoId === "inferno_06"
                  ? "The sludge settles. Press on."
                  : "The gust breaks. Press on.";
          this.toast(killer.ws, "info", line);
        }
      }
    }
    if (killer && entity.kind === "mob" && !entity.summoned) {
      let mobs = 0;
      let bossUp = false;
      for (const e of this.entities.values()) {
        // (a mechanic's summoned adds — entity.summoned — are not "the road")
        if (e.kind === "mob" && e.hp > 0 && !e.summoned) mobs++;
        if (e.kind === "boss" && e.hp > 0) bossUp = true;
      }
      if (mobs === 0 && bossUp) {
        const bossName = this.canto.bosses?.[0]?.name || "the boss";
        this.toast(killer.ws, "emit", `The road is clear. ${bossName} waits.`);
      }
    }

    if (drops.length && killer) {
      const dropPrefix =
        dropTable === "avarice_pack_weights"
          ? "Weighed"
          : this.cantoId === "inferno_07"
            ? "Weighed"
            : "Dropped";
      // Avarice kill feed quiet: skip normal fodder loot spam; rare+ / soulbound still toast
      const showDrops =
        this.cantoId !== "inferno_07"
          ? drops
          : drops.filter(
              (d) =>
                d.soulbound ||
                d.rarity === "rare" ||
                d.rarity === "set" ||
                d.rarity === "unique" ||
                d.rarity === "canto_unique" ||
                entity.kind === "boss" ||
                entity.champion
            );
      if (showDrops.length) {
        this.toast(
          killer.ws,
          "loot",
          `${dropPrefix}: ${showDrops.map((d) => `${rarityWord(d.rarity)}${d.name}`).join(", ")}`
        );
      }
    }

    // Eligible emits only — never trash
    if (isChampion) {
      const r = tryEmit(killerId, "ChampionPack", { packId: entity.packId });
      if (r.ok && killer) {
        this.toast(killer.ws, "emit", `Champion bounty +${ashStelleTag(r.payoutAsh)} (pending)`);
      }
    }
    if (isBoss) {
      // Everyone still in the canto who hurt the boss shares the kill (a
      // last-hit-only first clear would leave helpers stuck at a sealed gate).
      const credited = new Set([killerId, ...(entity.hitBy || [])]);
      console.log(`[boss] ${entity.id} slain in ${this.cantoId} (credited ${credited.size})`);
      challengesOnBossKill(this, entity, [...credited].filter((id) => this.sessions.has(id)));
      for (const pid of credited) {
        const sess = this.sessions.get(pid);
        if (!sess) continue;
        const r = tryEmit(pid, "Boss", { bossId: entity.id, cantoId: this.cantoId });
        if (r.ok) this.toast(sess.ws, "emit", `Boss bounty +${ashStelleTag(r.payoutAsh)} (pending)`);
        const fc = this.canto.first_clear;
        if (!fc?.enabled || !entity.firstClearEmit) continue;
        const r2 = tryEmit(pid, "FirstClear", { cantoId: this.cantoId, requires: entity.id });
        if (r2.ok) {
          this.toast(sess.ws, "emit", `First clear reward +${ashStelleTag(r2.payoutAsh)} (pending)`);
          try {
            grantXp(this, pid, firstClearXp(this.cantoId), "first_clear");
          } catch (err) {
            console.error("[prog] first_clear xp", err.message);
          }
          const gateLine =
            this.cantoId === "inferno_05"
              ? "Lust falls — the Gluttony gate past the dais opens."
              : this.cantoId === "inferno_06"
                ? "Triple Maw broken — the Avarice gate past the Maw opens."
                : this.cantoId === "inferno_07"
                  ? "Plutus is broken — the Dark Wood road opens past the dais."
                  : this.cantoId === "inferno_08"
                    ? "Filippo Argenti sinks — the Dark Wood road opens past the ferry."
                    : null;
          if (gateLine) this.toast(sess.ws, "emit", gateLine);
        } else if (r2.reason === "already_cleared" && pid === killerId) {
          this.toast(sess.ws, "info", "First clear already claimed for this canto.");
        }
      }
      const def = (this.canto.bosses || []).find((b) => b.id === entity.id);
      if (def) this.bossRespawns.push({ boss: def, left: BOSS_RESPAWN_SEC });
    }

    this.pushAllSnapshots();
  }

  handleDash(playerId, aimX, aimY) {
    const s = this.sessions.get(playerId);
    if (!s || s.hp <= 0 || pvpIsDown(s)) return;
    // Cooldown on the wall clock (dashCd only ticks at ~15 Hz: a dash sent the moment
    // the client's 4 s ran out met a sliver of it and was refused — a dodge on screen
    // with no iframes). Early by up to the grace is carried forward as debt.
    const now = Date.now();
    if (now < (s.dashReadyAt || 0) - DASH_GRACE_MS) {
      const left = ((s.dashReadyAt || 0) - now) / 1000;
      this.toast(s.ws, "warn", `Dash cooling (${Math.ceil(left)}s)`);
      this.send(s.ws, { type: "dash_denied", ms: Math.round((s.dashReadyAt || 0) - now) });
      return;
    }
    // A non-finite aim (1e999 parses to Infinity) falls back to the facing
    let dx = Number(aimX);
    let dy = Number(aimY);
    if (!Number.isFinite(dx) || !Number.isFinite(dy) || !(Math.hypot(dx, dy) > 1e-6)) {
      dx = s._lastFaceX || 0;
      dy = s._lastFaceY || -1;
    }
    const len = Math.hypot(dx, dy);
    if (!(len > 1e-6) || !Number.isFinite(len)) return;
    dx /= len;
    dy /= len;
    // (a canto's ground may shorten it — the client asks its mech the same)
    const step = 5.5 * (this.mech.dashScale?.(this, s) ?? 1);
    const fromX = s.x;
    const fromY = s.y;
    // Unwrapped end so the sweep and adjustDash see one straight segment. Wrapped after.
    let ux = fromX + dx * step;
    let uy = fromY + dy * step;
    // Canto mechanic: where the dash really ends (wind, obstacles) — the client's
    // CantoMech.adjustDash predicts the same
    if (this.mech.adjustDash) {
      const to = this.mech.adjustDash(this, s, fromX, fromY, ux, uy, dx, dy);
      if (to && Number.isFinite(to.x) && Number.isFinite(to.y)) {
        ux = to.x;
        uy = to.y;
      }
    }
    s._lastFaceX = dx;
    s._lastFaceY = dy;
    if (!Number.isFinite(ux) || !Number.isFinite(uy)) {
      s.x = fromX;
      s.y = fromY;
      ux = fromX;
      uy = fromY;
    }
    s.iframes = Math.max(s.iframes || 0, 0.35);
    s.dashCd = DASH_CD;
    s.dashReadyAt = Math.max(now, s.dashReadyAt || 0) + DASH_CD * 1000;
    pvpTouch(s);
    pvpBreakInvuln(s);
    const segX = ux - fromX;
    const segY = uy - fromY;
    const segL2 = segX * segX + segY * segY || 1;
    let cut = 0;
    for (const e of [...this.entities.values()]) {
      if (e.kind !== "mob" && e.kind !== "boss") continue;
      if (e._dead) continue;
      // Everything the dash passes through (distance to the path segment), not just
      // what stands near its two ends
      const u = Math.max(0, Math.min(1, ((e.x - fromX) * segX + (e.y - fromY) * segY) / segL2));
      const px = fromX + segX * u;
      const py = fromY + segY * u;
      if (Math.hypot(e.x - px, e.y - py) > 1.6 + bodyRadius(e, this.cantoId) * 0.5) continue;
      let dmg = e.kind === "boss" ? 12 : 18;
      if (heartWards(this, e)) dmg = Math.max(1, Math.round(dmg * 0.7));
      cut++;
      // shoved aside, off the dash line
      const off = Math.hypot(e.x - px, e.y - py);
      const from = off > 0.05 ? { x: px, y: py } : { x: e.x + dy, y: e.y - dx };
      this.damageMob(e, dmg, playerId, { spellId: "dash", from });
    }
    try {
      pvpDashCut(this, s, fromX, fromY, ux, uy);
    } catch (err) {
      console.error("[pvp] dash", err.message);
    }
    // A plain dash needs no words; a dash that cuts foes says how many
    if (cut) this.toast(s.ws, "loot", `Dash cuts ${cut}`);
    const dashed = placeBody(this, ux, uy);
    s.x = dashed.x;
    s.y = dashed.y;
    this.markDirty();
    this.pushSnapshot(playerId);
  }

  handleSip(playerId) {
    const s = this.sessions.get(playerId);
    if (!s || pvpIsDown(s)) return;
    const now = Date.now();
    if (now < (s.sipReadyAt || 0) - DASH_GRACE_MS) {
      this.toast(s.ws, "warn", `Flask cooling (${Math.ceil(((s.sipReadyAt || 0) - now) / 1000)}s)`);
      return;
    }
    if (s.hp >= s.maxHp && s.mana >= s.maxMana) {
      this.toast(s.ws, "info", "You are already whole.");
      return;
    }
    const heal = Math.min(36, s.maxHp - s.hp);
    const mana = Math.min(24, s.maxMana - s.mana);
    s.hp += heal;
    s.mana += mana;
    s.sipCd = 8;
    s.sipReadyAt = Math.max(now, s.sipReadyAt || 0) + 8000;
    this.toast(s.ws, "loot", `Flask +${heal} life, +${mana} breath`);
    this.pushSnapshot(playerId);
  }

  async handleSalvage(playerId) {
    const s = this.sessions.get(playerId);
    if (!s) return;
    let r;
    try {
      r = await salvageBag(playerId);
    } catch (err) {
      console.error("[salvage] failed", err.message);
      this.toast(s.ws, "warn", "Could not melt the bag. Try again.");
      return;
    }
    if (!r.ok && r.reason === "busy") return; // a melt is already in flight
    if (!r.ok) {
      this.toast(s.ws, "warn", "Nothing in the bag to melt. Worn gear stays on you.");
      return;
    }
    const stelle = (r.ash / 1000).toFixed(3);
    this.toast(
      s.ws,
      "loot",
      `Melted ${r.count} item${r.count === 1 ? "" : "s"} for ${r.ash.toLocaleString()} Ash (${stelle} Stelle)`
    );
    this.pushSnapshot(playerId);
  }

  async handlePickup(playerId, lootId) {
    const s = this.sessions.get(playerId);
    const ledger = players.get(playerId);
    if (!s || !ledger) return;
    const loot = this.entities.get(lootId);
    if (!loot || loot.kind !== "loot") return;
    if (!(dist(s, loot) <= (this.cantoId === "inferno_07" ? PICKUP_RANGE + 1.2 : PICKUP_RANGE))) {
      this.toast(s.ws, "warn", "Too far.");
      return;
    }
    const bagCount = ledger.inventory.filter((i) => !i.equipSlot).length;
    if (bagCount >= 40) {
      this.toast(s.ws, "warn", "Inventory full.");
      return;
    }
    this.entities.delete(lootId);
    await grantInventoryItem(playerId, loot.item);
    this.toast(s.ws, "loot", `Picked up ${rarityWord(loot.item.rarity)}${loot.item.name}`);
    this.pushAllSnapshots();
  }

  handleInteract(playerId, targetId) {
    const s = this.sessions.get(playerId);
    const ledger = players.get(playerId);
    if (!s || !ledger) return;
    const e = this.entities.get(targetId);
    if (!e) return;
    const maxDist =
      e.kind === "exit" || e.poiKind === "portal"
        ? INTERACT_RANGE_PORTAL
        : this.cantoId === "inferno_07"
          ? INTERACT_RANGE + 0.8
          : INTERACT_RANGE;
    if (!(dist(s, e) <= maxDist)) {
      this.toast(s.ws, "warn", "Move closer.");
      return;
    }
    // A canto mechanic's own POIs (it answers, toasts and marks dirty itself)
    if (e.kind === "poi" && this.mech.onInteract?.(this, s, e)) {
      this.pushSnapshot(playerId);
      return null;
    }

    if (e.kind === "exit") {
      if (e.requireClear && !hasCleared(playerId, e.requireClear)) {
        const tip =
          e.requireClear === "inferno_05"
            ? "Lust is not yet cleared — slay Minos, then the Gluttony gate opens."
            : e.requireClear === "inferno_06"
              ? "Clear Triple Maw first — then Avarice opens."
              : e.requireClear === "inferno_07"
                ? "Break Plutus first — then the Styx opens."
                : `The way to ${cantoTitle(e.toCanto)} is sealed until you clear ${cantoTitle(e.requireClear)}.`;
        this.toast(s.ws, "warn", tip);
        return;
      }
      // Client/world manager will travel
      return { travel: e.toCanto };
    }

    if (e.kind === "poi") {
      if (e.poiKind === "npc") {
        ledger.spokeToGuide = true;
        void persistPlayerFlags(playerId).catch((err) =>
          console.error("[db] persist spokeToGuide failed", err.message)
        );
        {
          const clears = ledger.firstClears instanceof Set ? [...ledger.firstClears] : [];
          let guideLine =
            "Guide: Take the gold gate into Lust. Break the Storm Heart, then Minos — Gluttony (piova etterna) opens past his dais; after the Maw, Avarice (peso e contrapeso — weight and counterweight). Return for the writ, stash, and Auction House.";
          if (clears.includes("inferno_08")) {
            guideLine =
              "Guide: Filippo Argenti sank in the Styx — the wrathful still brawl in the mud. Claim the writ, bank your drops at the stash, or hunt Lust, Gluttony, Avarice, or Wrath again.";
          } else if (clears.includes("inferno_07") && clears.includes("inferno_05")) {
            // Both Lust + Ava clear: distinguish east Lust rematch vs weighed road again
            guideLine =
              "Guide: Measure holds — east Lust for Minos again, or back through Gluttony into Avarice. Claim the writ, bank weighed drops at the stash, then choose your road.";
          } else if (clears.includes("inferno_07")) {
            guideLine =
              "Guide: Plutus is broken — past his dais the Styx waits (Wrath). Ford it, break the Rage Heart, and face Filippo Argenti. Claim the daily writ and bank weighed drops at the stash.";
          } else if (clears.includes("inferno_06")) {
            guideLine =
              "Guide: Triple Maw is broken — Avarice (peso e contrapeso) waits past the Maw. Cross between the weights' clashes, tip the Counterweight, break Plutus with the Ledger Bell. Return for the writ, stash, and Auction House.";
          } else if (clears.includes("inferno_05")) {
            guideLine =
              "Guide: Lust is clear — Gluttony (piova etterna) opens past Minos's dais. Clear the mire, then the Triple Maw; after the Maw, Avarice. Return for the writ, stash, and Auction House.";
          }
          this.toast(s.ws, "info", guideLine);
        }
      } else if (e.poiKind === "stash") {
        this.toast(
          s.ws,
          "info",
          ledger.stash.length
            ? `Stash holds ${ledger.stash.length} item${ledger.stash.length === 1 ? "" : "s"} — bank your circle drops here.`
            : "Stash is empty — bank champion drops here after any circle of the Inferno."
        );
        this.send(s.ws, { type: "stash_open" });
        // After banking Ava loot (Crush clear + bag/stash weighed): nudge Guide counsel once per session
        const clearsStash = ledger.firstClears instanceof Set ? ledger.firstClears : new Set();
        const weighedBag =
          (ledger.inventory || []).some((i) => i && i.soulbound) ||
          (ledger.stash || []).some((i) => i && i.soulbound);
        if (clearsStash.has("inferno_07") && weighedBag && !s._avaBankGuideToast) {
          s._avaBankGuideToast = true;
          this.toast(
            s.ws,
            "info",
            "Guide: weighed drops are banked — speak with me for the writ, or take the east Lust road / Gluttony→Avarice again."
          );
        }
      } else if (e.poiKind === "ah") {
        this.send(s.ws, { type: "ah_listings", listings: ah.getListings() });
        this.toast(s.ws, "info", "Auction House — list gear for Ash, or bid on pilgrim lots.");
      } else if (e.poiKind === "quest") {
        this.tryDaily(playerId);
      } else if (e.poiKind === "portal") {
        const dest = e.toCanto || "inferno_01";
        if (e.requireClear && !hasCleared(playerId, e.requireClear)) {
          const tip =
            e.requireClear === "inferno_05"
              ? "Lust is not yet cleared — slay Minos, then the Gluttony gate opens."
              : e.requireClear === "inferno_06"
                ? "Clear Triple Maw first — then Avarice opens."
                : e.requireClear === "inferno_07"
                  ? "Break Plutus first — then the Styx opens."
                  : `The way to ${cantoTitle(dest)} is sealed until you clear ${cantoTitle(e.requireClear)}.`;
          this.toast(s.ws, "warn", tip);
          return;
        }
        return { travel: dest };
      } else if (e.poiKind === "marker") {
        this.toast(s.ws, "info", e.hint || e.label || "A marker on the road.");
        return;
      } else if (e.poiKind === "cache") {
        if (s.lootedCache) {
          this.toast(
            s.ws,
            "info",
            this.cantoId === "inferno_08"
              ? "The Sunken Cache is empty."
              : this.cantoId === "inferno_07"
                ? "misura spesa — the Ledger Cache is empty; return next visit."
                : this.cantoId === "inferno_06"
                  ? "The filth cache is empty."
                  : "The wind cache is empty."
          );
          return;
        }
        const bagCount = ledger.inventory.filter((i) => !i.equipSlot).length;
        if (bagCount >= 40) {
          this.toast(s.ws, "warn", "Inventory full.");
          return;
        }
        const cacheTable =
          this.cantoId === "inferno_07" || this.cantoId === "inferno_08"
            ? "avarice_pack_weights"
            : "inferno_pack_common";
        const drops = rollDrops(cacheTable, { champion: true, boss: false });
        const item = drops[0];
        if (!item) {
          this.toast(s.ws, "info", "The cache holds only dust.");
          return;
        }
        s.lootedCache = true;
        void grantInventoryItem(playerId, item).then(() => {
          const prefix =
            this.cantoId === "inferno_08"
              ? "Sunken Cache"
              : this.cantoId === "inferno_07"
                ? "misura — Ledger Cache"
                : this.cantoId === "inferno_06"
                  ? "Filth Cache"
                  : "Cache";
          this.toast(s.ws, "loot", `${prefix}: ${rarityWord(item.rarity)}${item.name}`);
          if (this.cantoId === "inferno_07") {
            this.toast(s.ws, "info", "contrapeso — the cache yields its weight");
          } else if (this.cantoId === "inferno_08") {
            this.toast(s.ws, "info", "The marsh yields what the Styx kept.");
          }
          this.pushSnapshot(playerId);
        });
        return;
      } else if (e.poiKind === "bell") {
        if (s.bellCd > 0) {
          this.toast(s.ws, "warn", `The bell is quiet (${Math.ceil(s.bellCd)}s)`);
          return;
        }
        // A canto mechanic may own its bell (it sets bellCd / toasts itself)
        if (this.mech.onBell?.(this, s, e)) {
          this.pushSnapshot(playerId);
          return null;
        }
        s.bellCd = 18;
        let stilled = 0;
        const stillR = 10;
        const stillDur = 2.4;
        for (const mob of this.entities.values()) {
          if (mob.kind !== "mob") continue;
          // Hearts are ward pillars, not weights — skip still (keep Crush lane readable)
          if (HEART_ARCHETYPES.has(mob.archetype)) continue;
          if (dist(s, mob) > stillR) continue;
          mob.stunLeft = stillDur;
          stilled++;
        }
        const bellLine = stilled
          ? this.cantoId === "inferno_06"
            ? `Mire Bell stills ${stilled}`
            : `The bell stills ${stilled}`
          : this.cantoId === "inferno_06"
            ? "The Mire Bell tolls — nothing answers."
            : "The bell rings, and nothing answers.";
        this.toast(s.ws, "emit", bellLine);
        // Combat canto dailies: first successful still can claim DailyQuest (shared UTC cap; quiet if ineligible)
        // (Avarice's Ledger Bell is its canto mechanic's: cantoMech/avarice.mjs onBell)
        if (this.cantoId === "inferno_06" && stilled > 0) {
          this.tryDaily(playerId, "glut_daily_mire", { quiet: true });
        }
      } else if (e.poiKind === "pyre" || e.poiKind === "shrine") {
        s.hp = s.maxHp;
        s.mana = s.maxMana;
        // (each combat canto keeps two shrines: by the entrance and short of its boss)
        const shrineName =
          e.label || (this.cantoId === "inferno_07" ? "Ledger Shrine" : this.cantoId === "inferno_06" ? "Mire Shrine" : "Wind Shrine");
        const shrineLine =
          e.poiKind === "pyre"
            ? "The camp pyre warms you. Life and breath restored."
            : this.cantoId === "inferno_07"
              ? `rebalance — the ${shrineName} restores life and breath.`
              : `The ${shrineName} knits your wounds and fills your breath.`;
        this.toast(s.ws, "emit", shrineLine);
      }
    }
    this.pushSnapshot(playerId);
    return null;
  }

  tryDaily(playerId, questId = "dw_daily_scout", opts = {}) {
    const quiet = Boolean(opts?.quiet);
    const s = this.sessions.get(playerId);
    const ledger = players.get(playerId);
    if (!s || !ledger) return;
    if (!ledger.spokeToGuide) {
      if (!quiet) this.toast(s.ws, "warn", "Speak with the Guide first.");
      return;
    }
    if (!ledger.visitedInferno) {
      if (!quiet) this.toast(s.ws, "warn", "Walk into Lust once first — then the writ opens.");
      return;
    }
    const qid = questId || "dw_daily_scout";
    const r = tryEmit(playerId, "DailyQuest", { questId: qid });
    if (r.ok) {
      const label =
        qid === "glut_daily_mire"
          ? "Mire writ"
          : qid === "ava_daily_ledger"
            ? "Ledger writ"
            : qid === "wrath_daily_lantern"
              ? "Lantern writ"
              : "Writ";
      this.toast(
        s.ws,
        "emit",
        `${label} accepted. +${ashStelleTag(r.payoutAsh)} set aside (pending).`
      );
    } else {
      if (quiet) return; // bell path: don't drown combat toast
      const why = {
        daily_cap: "You already claimed today's writ.",
        no_player: "The ledger does not know you yet.",
        ineligible_event: "This writ cannot be claimed.",
      };
      this.toast(s.ws, "warn", why[r.reason] || "The writ cannot be claimed right now.");
    }
    this.pushSnapshot(playerId);
  }

  async handleEquip(playerId, itemId) {
    const s = this.sessions.get(playerId);
    if (!s) return;
    const r = await equipItem(playerId, itemId);
    if (!r.ok) {
      this.toast(s.ws, "warn", `Cannot equip: ${r.reason}`);
      return;
    }
    applyPlayerStats(s);
    const eqLine =
      this.cantoId === "inferno_07"
        ? `pesato — equipped ${r.item.name} → ${r.slot}`
        : `Equipped ${r.item.name} → ${r.slot}`;
    this.toast(s.ws, "info", eqLine);
    // Remotes need equipped on room.players to refresh gear look.
    this.pushAllSnapshots();
  }

  /** Deposit / withdraw at the Dark Wood stash — only while standing at it. */
  async handleStash(playerId, itemId, dir) {
    const s = this.sessions.get(playerId);
    if (!s) return;
    const stash = [...this.entities.values()].find((e) => e.kind === "poi" && e.poiKind === "stash");
    if (!stash || !(dist(s, stash) <= INTERACT_RANGE + 1.5)) {
      this.toast(s.ws, "warn", "Walk to the Dark Wood stash to bank items.");
      return;
    }
    let r;
    try {
      r = dir === "take" ? await unstashItem(playerId, itemId) : await stashItem(playerId, itemId);
    } catch (err) {
      console.error("[stash] failed", err.message);
      this.toast(s.ws, "warn", "The stash will not open. Try again.");
      return;
    }
    if (!r.ok) {
      const why = {
        stash_full: "The stash is full (60).",
        bag_full: "Your bag is full (40).",
        worn: "Unequip it first.",
        not_found: "That item is gone.",
      };
      this.toast(s.ws, "warn", why[r.reason] || "Cannot move that item.");
      return;
    }
    this.toast(s.ws, "loot", dir === "take" ? `Withdrew ${r.item.name}` : `Banked ${r.item.name}`);
    this.pushSnapshot(playerId);
  }

  async handleUnequip(playerId, itemId, slot) {
    const s = this.sessions.get(playerId);
    if (!s) return;
    const r = itemId
      ? await unequipItem(playerId, itemId)
      : await unequipSlot(playerId, slot);
    if (!r.ok) {
      this.toast(s.ws, "warn", `Cannot unequip: ${r.reason}`);
      return;
    }
    applyPlayerStats(s);
    this.toast(s.ws, "info", `Unequipped ${r.item.name}`);
    this.pushAllSnapshots();
  }

  markDirty() {
    this.dirty = true;
  }

  /** Run `fn` after `sec` seconds of room time (resolved in tick; dropped on reset). */
  schedule(sec, fn) {
    this.pending.push({ left: Math.max(0, Number(sec) || 0), fn });
  }

  // ——— helpers for mob AI and canto mechanics (cantoMech/index.mjs) ———————————

  /** Start a ground telegraph (see telegraph.mjs for the spec); returns it. */
  telegraph(spec) {
    return this.tele.start(spec);
  }

  /** This canto's damage tier (a mechanic scales its own blows by it). */
  tierDmg() {
    return tierOf(this.cantoId).dmg;
  }

  cancelTelegraph(id, reason = "") {
    return this.tele.cancel(id, reason);
  }

  /**
   * Push a player (dx,dy world units over durMs). The server moves the session now;
   * the client plays the same impulse in its prediction ({type:"shove"}), and the
   * slowed-move budget allows for it.
   */
  shovePlayer(sess, dx, dy, durMs = 220) {
    if (!sess || !(sess.hp > 0)) return;
    if (bastionActive(sess)) return;
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
    const shoved = placeBody(this, sess.x + dx, sess.y + dy);
    sess.x = shoved.x;
    sess.y = shoved.y;
    sess.shoveAllow = (sess.shoveAllow || 0) + Math.hypot(dx, dy);
    this.send(sess.ws, { type: "shove", dx: +dx.toFixed(3), dy: +dy.toFixed(3), dur: Math.round(durMs) });
    this.markDirty();
  }

  /** Slow (speed multiplier) and/or root a player for durMs; {type:"status"} to them. */
  statusPlayer(sess, { slow = 1, root = false, durMs = 1000 } = {}) {
    if (!sess) return;
    const until = Date.now() + Math.max(0, durMs);
    sess.status = { slow: clamp(Number(slow) || 1, 0.05, 1), root: Boolean(root), until };
    this.send(sess.ws, { type: "status", slow: sess.status.slow, root: sess.status.root, dur: Math.round(durMs) });
  }

  /** Knockback-style impulse on a mob (dx,dy = total shove in world units). */
  shoveMob(e, dx, dy) {
    if (!e) return;
    pushMob(e, dx, dy, Math.hypot(dx, dy));
  }

  /** A blow met a dash / respawn iframe: the "safe" beat (no HP) everyone sees. */
  dodgeBeat(target, attacker, extra = {}) {
    this.broadcast({
      type: "combat",
      attackerId: attacker?.id ?? null,
      targetId: target.playerId,
      targetIsPlayer: true,
      damage: 0,
      soaked: 0,
      iframeBlocked: true,
      targetHp: target.hp,
      ...extra,
    });
  }

  /**
   * A blow lands on a player: canto onDamage hook, dash/respawn iframes (a "safe"
   * beat, no HP), armor, the combat broadcast, death → wake at the entrance.
   * attacker: the entity (or { id }); extra is merged into the combat message.
   */
  hitPlayer(target, attacker, dmg, extra = {}) {
    if (!target || !(target.hp > 0)) return 0;
    const attackerId = attacker?.id ?? null;
    if (target.iframes > 0) {
      this.dodgeBeat(target, attacker, extra);
      return 0;
    }
    let raw = dmg;
    if (this.mech.onDamage) {
      raw = this.mech.onDamage(this, target, raw, {
        id: attackerId,
        kind: attacker?.kind || "mech",
        teleKind: extra.teleKind,
      });
    }
    raw = Math.max(0, Math.round(Number(raw) || 0));
    if (raw <= 0) return 0;
    const st = playerCombatStats(target.playerId);
    const armor = st.armor + (target.armorBuff || 0);
    let { taken, soaked } = mitigate(raw, armor);
    const dr = bastionDr(target, false);
    if (dr > 0) taken = Math.max(1, Math.round(taken * (1 - dr)));
    if (target.hp - taken <= 0 && tryLastStand(target, false)) {
      this.broadcast({
        type: "spell_fx",
        spellId: "last_stand",
        casterId: target.playerId,
        x: target.x,
        y: target.y,
        duration: 1,
      });
      this.broadcast({
        type: "combat",
        attackerId,
        targetId: target.playerId,
        targetIsPlayer: true,
        damage: taken,
        soaked,
        wardActive: !!(target.armorBuff > 0),
        targetHp: target.hp,
        ...extra,
      });
      this.markDirty();
      return taken;
    }
    target.hp = Math.max(0, target.hp - taken);
    // The well never uses the PvE death wake — a stray blow leaves the pilgrim at 1.
    if (this.canto?.role === "arena" && target.hp <= 0) target.hp = 1;
    this.broadcast({
      type: "combat",
      attackerId,
      targetId: target.playerId,
      targetIsPlayer: true,
      damage: taken,
      soaked,
      wardActive: !!(target.armorBuff > 0),
      targetHp: target.hp,
      ...extra,
    });
    this.markDirty();
    if (taken > 0 && attacker && (attacker.kind === "mob" || attacker.kind === "boss")) {
      const pct = thornsPct(target.playerId, false);
      if (pct > 0) {
        try {
          this.damageMob(attacker, Math.max(1, Math.round(taken * pct)), target.playerId, {
            spellId: "thorns",
            from: target,
          });
        } catch (err) {
          console.error("[skills] thorns", err.message);
        }
      }
    }
    if (target.hp <= 0) {
      const sp = this.canto.geo.spawn;
      target.x = sp.x;
      target.y = sp.y;
      target.hp = target.maxHp;
      target.iframes = this.cantoId === "inferno_07" ? RESPAWN_IFRAMES + 0.6 : RESPAWN_IFRAMES;
      target.status = null;
      this.deathWakeToast(target.ws);
    }
    return taken;
  }

  /**
   * Boss mend (./bossMend.mjs): call every tick with the nearest living pilgrim's
   * distance. Returns "whole" on the tick it knits whole (reset done), else null.
   */
  tickBossMend(e, nearestD, dt) {
    if (!(nearestD > BOSS_ABSENT_R)) {
      e.idleT = 0;
      return null;
    }
    e.idleT = (e.idleT || 0) + dt;
    if (e.idleT <= BOSS_MEND_AFTER || !(e.hp < e.maxHp)) return null;
    e.hp = Math.min(e.maxHp, e.hp + e.maxHp * BOSS_MEND_RATE * dt);
    this.markDirty();
    if (e.hp < e.maxHp) return null;
    this.resetBoss(e);
    return "whole";
  }

  /**
   * Boss leash: dragged BOSS_LEASH off its dais it walks home ignoring everyone (blows
   * glance off it on the way — see damageMob) and takes up the fight where it stood;
   * it heals only by tickBossMend. Returns true while it is walking home.
   */
  tickBossLeash(e, nearestD, homeD, dt) {
    this.tickBossMend(e, nearestD, dt);
    if (e.leashCd > 0) e.leashCd -= dt;
    if (!e.resetting && homeD > BOSS_LEASH && !(e.leashCd > 0)) {
      e.resetting = true;
      e.resetT = 0;
      if (e.teleId) interruptAttack(this, e, 0, "leash");
    }
    if (!e.resetting) return false;
    walkTo(this, e, e.homeX, e.homeY, 4.2, dt);
    e.resetT = (e.resetT || 0) + dt;
    // home — or as good as, however the walk went (a pilgrim on its seat, the mire): the
    // evade never outlasts the walk it covers, and a walk that got nowhere is not retried
    // (blows landing) for a while
    const home = Math.hypot(e.x - e.homeX, e.y - e.homeY) < 1.5;
    if (home || e.resetT > BOSS_LEASH / 4.2 + 3) {
      e.resetting = false;
      if (!home) e.leashCd = 6;
      this.markDirty();
    }
    return true;
  }

  resetBoss(e) {
    e.hp = e.maxHp;
    e.hitBy = null;
    e.phase = undefined;
    e.phase2Toast = false;
    e.idleT = 0;
    this.mech.onBossReset?.(this, e);
    this.markDirty();
  }

  /** Damage a mob/boss deals with its telegraphed attack (tier-scaled). */
  mobAttackDamage(e) {
    const arch = e.archetype || (e.kind === "boss" ? "boss" : "whirl_shade");
    let dmg =
      e.kind === "boss"
        ? MOB_DMG[arch] || MOB_DMG.boss
        : MOB_DMG[arch] || (isChampionClass(e) ? MOB_DMG.gale_champion : MOB_DMG.whirl_shade);
    dmg = Math.round(dmg * tierOf(this.cantoId).dmg);
    if ((e.weakenLeft || 0) > 0) dmg = Math.max(1, Math.round(dmg * (e.weakenMult || 0.85)));
    return dmg;
  }

  tick(dt) {
    if (this.sessions.size === 0) return;
    this._tickAt = Date.now();
    this.tickBossRespawns(dt);
    let manaDirty = false;
    for (const s of this.sessions.values()) {
      // (no path may leave a pilgrim at NaN — every range check would pass them by)
      if (!Number.isFinite(s.x) || !Number.isFinite(s.y)) {
        const sp = this.canto.geo.spawn;
        s.x = sp.x;
        s.y = sp.y;
        this.markDirty();
      }
      if (s.atkCd > 0) s.atkCd = Math.max(0, s.atkCd - dt);
      if (s.sipCd > 0) s.sipCd = Math.max(0, s.sipCd - dt);
      if (s.dashCd > 0) s.dashCd = Math.max(0, s.dashCd - dt);
      if (s.bellCd > 0) s.bellCd = Math.max(0, s.bellCd - dt);
      if (s.iframes > 0) s.iframes = Math.max(0, s.iframes - dt);
      if (s.status && s.status.until <= Date.now()) s.status = null;
      if (s.spellCd) {
        for (const k of Object.keys(s.spellCd)) {
          if (s.spellCd[k] > 0) s.spellCd[k] = Math.max(0, s.spellCd[k] - dt);
        }
      }
      if (s.wardUntil > 0) {
        s.wardUntil = Math.max(0, s.wardUntil - dt);
        if (s.wardUntil <= 0 && s.armorBuff) {
          s.armorBuff = 0;
          manaDirty = true;
        }
      }
      if (s.hp > 0 && s.mana < s.maxMana) {
        const before = s.mana;
        s.mana = Math.min(s.maxMana, s.mana + manaRegenPerSec(s.playerId) * dt);
        if (Math.floor(s.mana) !== Math.floor(before)) manaDirty = true;
      }
    }
    if (manaDirty) this.markDirty();
    try {
      tickSkills(this, dt);
    } catch (err) {
      console.error("[skills] tick", err.message);
    }
    try {
      flushXpGains(this);
    } catch (err) {
      console.error("[prog] xp flush", err.message);
    }
    this.mech.tick?.(this, dt);
    if (this.pending.length) {
      const due = [];
      let w = 0;
      for (const p of this.pending) {
        p.left -= dt;
        if (p.left <= 0) due.push(p);
        else this.pending[w++] = p;
      }
      this.pending.length = w;
      for (const p of due) {
        try {
          p.fn();
        } catch (err) {
          console.error("[room] pending", err.message);
        }
      }
    }
    try {
      pvpTick(this, dt);
    } catch (err) {
      console.error("[pvp] tick", err.message);
    }
    // Windups that end this tick land before mobs act on the new state
    this.tele.tick(dt);
    const bounds = this.canto.geo.bounds;
    const ava = this.cantoId === "inferno_07";
    let moved = false;
    for (const e of this.entities.values()) {
      if (e.kind !== "mob" && e.kind !== "boss") continue;
      if (e.atkCd > 0) e.atkCd = Math.max(0, e.atkCd - dt);
      if (e.windupLeft > 0) e.windupLeft = Math.max(0, e.windupLeft - dt);
      if (e.staggerLeft > 0) e.staggerLeft = Math.max(0, e.staggerLeft - dt);
      // (a telegraph cancelled from outside — a mechanic — frees its owner too)
      if (e.teleId && !this.tele.get(e.teleId)) {
        e.teleId = null;
        e.windupLeft = 0;
      }
      // Knockback impulses and wisp darts play out even on a stilled foe
      if (tickImpulse(e, dt, bounds)) moved = true;
      if (e.dart) continue;
      if (e.stunLeft > 0) {
        const prev = e.stunLeft;
        e.stunLeft = Math.max(0, e.stunLeft - dt);
        // A bell still breaks any windup in progress
        if (e.teleId) interruptAttack(this, e, 0, "still");
        e.sp = 0;
        // Fairness: waking from Ledger Bell still — brief attack grace so walking
        // the measure does not eat an instant swipe the frame stun ends.
        if (prev > 0 && e.stunLeft <= 0 && ava) {
          e.atkCd = Math.max(e.atkCd || 0, 0.45);
        }
        continue;
      }
      if ((e.rootLeft || 0) > 0) {
        e.rootLeft = Math.max(0, e.rootLeft - dt);
        e.sp = 0;
        continue;
      }
      if ((e.slowLeft || 0) > 0) e.slowLeft = Math.max(0, e.slowLeft - dt);
      if ((e.weakenLeft || 0) > 0) e.weakenLeft = Math.max(0, e.weakenLeft - dt);
      if (HEART_ARCHETYPES.has(e.archetype)) continue;
      let nearest = null;
      let nearestD = 999;
      for (const s of this.sessions.values()) {
        if (!(s.hp > 0)) continue;
        const d = dist(e, s);
        if (d < nearestD) {
          nearestD = d;
          nearest = s;
        }
      }
      if (!nearest) continue;
      if (e.homeX == null) {
        e.homeX = e.x;
        e.homeY = e.y;
      }
      const homeD = Math.hypot(e.x - e.homeX, e.y - e.homeY);
      if (e.kind === "boss") {
        // A canto boss pattern replaces the default slam AI when it says so
        if (this.mech.bossTick?.(this, e, dt)) {
          moved = true;
          continue;
        }
        if (this.tickBossLeash(e, nearestD, homeD, dt)) {
          moved = true;
          continue;
        }
      } else if (this.mech.mobTick?.(this, e, dt)) {
        moved = true;
        continue;
      }
      // Avarice fairness: Counterweight (mid-boss) + champions get longer leash so kiting
      // does not snap-home mid-measure; Crush Approach stays tight so it cannot steal the dais.
      let leash = 11;
      if (ava && e.kind === "mob") {
        if (e.packId === "ava_counterweight") leash = 15.5;
        else if (e.archetype === "weight_champion" || e.champion) leash = 13.5;
        else if (e.packId === "ava_approach_flank") leash = 9.5;
        // Coin wisps weave fast — tight leash keeps pack clears inside burst+melee (no leftover kite)
        else if (e.archetype === "coin_wisp") leash = 7.2;
      }
      if (e.kind !== "boss" && homeD > leash) {
        if (e.teleId) interruptAttack(this, e, 0, "leash");
        // Slightly snappier return for approach packs; gentler for Counterweight
        const homeSpeed =
          ava && e.packId === "ava_counterweight"
            ? 3.4
            : ava && e.packId === "ava_approach_flank"
              ? 5.0
              : 4.2;
        walkTo(this, e, e.homeX, e.homeY, homeSpeed, dt);
        moved = true;
        continue;
      }
      // Avarice: soft keep-out — weights drift off the entrance instead of camping spawn/death wake
      if (ava && e.kind === "mob") {
        const sp = this.canto.geo.spawn;
        const sd = Math.hypot(e.x - sp.x, e.y - sp.y);
        if (sd < AVA_SPAWN_KEEP - 0.4 && sd > 0.05) {
          const ux = (e.x - sp.x) / sd;
          const uy = (e.y - sp.y) / sd;
          e.x += ux * 3.4 * dt;
          e.y += uy * 3.4 * dt;
          moved = true;
        }
      }
      const aggro =
        e.kind === "boss"
          ? 14
          : ava && e.packId === "ava_counterweight"
            ? 10.5
            : ava && e.packId === "ava_approach_flank"
              ? 6.8
              : ava && e.archetype === "ledger_warden"
                ? 9.5
                : ava && e.archetype === "coin_wisp"
                  ? 7.4
                  : ava && (e.archetype === "weight_champion" || e.champion)
                    ? 9.5
                    : 8;
      // Hold still through a windup (the ground shape matches the blow) or a stagger
      if (e.teleId || e.staggerLeft > 0) {
        if (brake(e, dt)) moved = true;
        continue;
      }
      if (nearestD < aggro) {
        let speedMul = 1;
        let weave = null;
        if (ava) {
          // Avarice: champion surge in mid band; coin wisps weave (greed that slips)
          if (e.archetype === "weight_champion" && nearestD > 3.2 && nearestD < 6.5) speedMul = 1.35;
          if (e.archetype === "coin_wisp") weave = avaCoinWeave;
        }
        if ((e.slowLeft || 0) > 0) speedMul *= e.slowMul || 0.55;
        if (chase(this, e, nearest, dt, { speedMul, weave })) moved = true;
        if (unstick(e, nearestD > 3.2, dt)) moved = true;
        if (e.atkCd <= 0 && !(nearest.iframes > 0)) {
          let over = null;
          if (ava && isChampionClass(e) && !ATTACKS_WARDEN.has(e.archetype)) over = AVA_CHAMP_WIND;
          if (startAttack(this, e, nearest, nearestD, this.mobAttackDamage(e), over)) this.markDirty();
        }
      } else if (brake(e, dt)) {
        moved = true;
      }
    }
    // Canto mechanic: settle foes after they all moved (solid props, …); true = moved
    if (this.mech.afterMobs?.(this, dt)) moved = true;
    if (moved) this.markDirty();
    this._snapAcc += dt;
    if (this.dirty && this._snapAcc >= 0.08) {
      this._snapAcc = 0;
      this.dirty = false;
      this.pushAllSnapshots();
    }
  }
}

export class World {
  constructor() {
    this.rooms = new Map();
    for (const id of Object.keys(CANTOS)) {
      const room = new CantoRoom(id);
      room.world = this;
      this.rooms.set(id, room);
    }
    this.playerRoom = new Map(); // playerId -> cantoId
    /** Brief mid-combat reconnect resume: playerId -> { cantoId, x, y, until } */
    this.resumeByPlayer = new Map();
  }

  roomFor(cantoId) {
    return this.rooms.get(cantoId);
  }

  ensureJoin(ws, playerId, name, cantoId = "inferno_01") {
    const prev = this.playerRoom.get(playerId);
    if (prev && prev !== cantoId) {
      this.rooms.get(prev)?.leave(playerId);
    }
    const room = this.rooms.get(cantoId);
    room.join(ws, playerId, name);
    this.playerRoom.set(playerId, cantoId);
    return room;
  }

  leave(playerId) {
    const cid = this.playerRoom.get(playerId);
    const room = cid ? this.rooms.get(cid) : null;
    const sess = room?.sessions.get(playerId);
    // Mid-Ava / combat disconnect: stash pose ~90s so hello can rejoin the measure
    if (cid && sess && room?.canto?.role === "combat") {
      this.resumeByPlayer.set(playerId, {
        cantoId: cid,
        x: sess.x,
        y: sess.y,
        until: Date.now() + 90_000,
      });
    }
    if (cid) this.rooms.get(cid)?.leave(playerId);
    this.playerRoom.delete(playerId);
  }

  /** Hub by default; if a combat resume is still warm, put them back on the road. */
  resumeOrHub(ws, playerId, name) {
    const r = this.resumeByPlayer.get(playerId);
    this.resumeByPlayer.delete(playerId);
    if (r && r.until > Date.now() && this.rooms.has(r.cantoId)) {
      const room = this.ensureJoin(ws, playerId, name, r.cantoId);
      const sess = room.sessions.get(playerId);
      if (sess) {
        sess.x = r.x;
        sess.y = r.y;
      }
      room.pushSnapshot(playerId);
      const where =
        r.cantoId === "inferno_07"
          ? "Avarice"
          : r.cantoId === "inferno_06"
            ? "Gluttony"
            : r.cantoId === "inferno_05"
              ? "Lust"
              : room.canto.title || "the canto";
      room.toast(ws, "info", `Connection restored — back in ${where}.`);
      return room;
    }
    return this.ensureJoin(ws, playerId, name, "inferno_01");
  }

  getRoom(playerId) {
    const cid = this.playerRoom.get(playerId);
    return cid ? this.rooms.get(cid) : null;
  }

  /** Forget mid-combat resumes nobody came back for. */
  pruneResumes(now = Date.now()) {
    for (const [pid, r] of this.resumeByPlayer) {
      if (!(r.until > now)) this.resumeByPlayer.delete(pid);
    }
  }

  travel(playerId, toCanto, ws, name, opts = {}) {
    if (!this.rooms.has(toCanto)) return { ok: false, reason: "unknown_canto" };
    const from = this.getRoom(playerId);
    if (!from) return { ok: false, reason: "no_room" }; // hello joins the hub first
    const sess = from.sessions.get(playerId);
    // Already there (the client's follow-up travel after a portal interact): no
    // re-join — that would reset the session to spawn with full HP.
    if (from.cantoId === toCanto) return { ok: false, reason: "already_here" };
    // Server-authoritative roads: you must be standing at a gate that leads there.
    if (sess && !opts.bypassGates) {
      let near = false;
      for (const e of from.entities.values()) {
        if (e.kind !== "exit" && e.poiKind !== "portal") continue;
        if (e.toCanto !== toCanto) continue;
        if (Math.hypot(e.x - sess.x, e.y - sess.y) <= TRAVEL_REACH) near = true;
      }
      if (!near) {
        from.toast(ws, "warn", `Walk to the road toward ${cantoTitle(toCanto)} first.`);
        return { ok: false, reason: "too_far" };
      }
    }
    // Enforce require_clear on exits/portals defined in the current canto toward toCanto.
    // DEV __selvaTravel may pass bypassGates to skip for playtest (portal path never does).
    if (!opts.bypassGates) {
      const gated = [];
      for (const ex of from.canto.geo.exits || []) {
        if (ex.to_canto === toCanto && ex.require_clear) gated.push(ex.require_clear);
      }
      for (const poi of from.canto.geo.pois || []) {
        if (poi.kind === "portal" && poi.to_canto === toCanto && poi.require_clear) {
          gated.push(poi.require_clear);
        }
      }
      for (const need of gated) {
        if (!hasCleared(playerId, need)) {
          const tip =
            need === "inferno_05"
              ? "Lust is not yet cleared — slay Minos, then the Gluttony gate opens."
              : need === "inferno_06"
                ? "Clear Triple Maw first — then Avarice opens."
                : need === "inferno_07"
                  ? "Break Plutus first — then the Styx opens."
                  : `The way to ${cantoTitle(toCanto)} is sealed until you clear ${cantoTitle(need)}.`;
          from.toast(ws, "warn", tip);
          return { ok: false, reason: "require_clear", need };
        }
      }
    }
    // Allow travel if near exit OR explicit travel after interact.
    // Flag the leave before ensureJoin: that calls CantoRoom.leave directly.
    if (sess) sess._pvpLeaveReason = "forfeit";
    const room = this.ensureJoin(ws, playerId, name, toCanto);
    room.pushSnapshot(playerId);
    // (no "Entered X." toast: the client shows a canto title card on arrival)
    if (room.canto.role === "hub" || room.cantoId === "inferno_01") {
      const hubLine = hasCleared(playerId, "inferno_08")
        ? "Dark Wood rest — writ, stash, or hunt the circles again."
        : hasCleared(playerId, "inferno_07")
        ? "Dark Wood rest — bank loot, then the Styx past Plutus's dais (Wrath)."
        : hasCleared(playerId, "inferno_06")
          ? "Dark Wood rest — bank loot, then Avarice past the Maw (or Lust again)."
          : hasCleared(playerId, "inferno_05")
            ? "Dark Wood rest — bank loot, then Gluttony past Minos."
            : "No foes in the Dark Wood — the gold gate leads to Lust.";
      room.toast(ws, "info", hubLine);
    } else if (room.cantoId === "inferno_06") {
      if (hasCleared(playerId, "inferno_06")) {
        room.toast(ws, "info", "The Avarice gate past the Maw stands open.");
      }
    } else if (room.cantoId === "inferno_05" && hasCleared(playerId, "inferno_05")) {
      room.toast(ws, "info", "The Gluttony gate past Minos's dais stands open.");
    } else if (room.canto?.role === "arena") {
      room.toast(ws, "info", "The well of the giants — blades between the willing.");
    }
    return { ok: true, room };
  }

  tick(dt) {
    for (const room of this.rooms.values()) {
      try {
        room.tick(dt);
      } catch (err) {
        console.error("[room] tick", room.cantoId, err.message);
      }
    }
  }
}
