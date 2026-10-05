#!/usr/bin/env node
/**
 * Headless self-play: a bot walks the whole Slice 1 road through the real
 * WebSocket protocol and reports whether every canto is reachable and
 * completable, plus a few balance numbers per canto.
 *
 *   Dark Wood (Guide, pyre, stash, AH, writ) → Lust → Gluttony → Avarice → Wrath → Dark Wood
 *
 * Usage (server must be running):
 *   node scripts/selfplay.mjs [--url ws://127.0.0.1:8080/ws] [--name Bot] [--runs 1] [--quiet] [--skills]
 *
 * Exits non-zero if any canto cannot be cleared or a gate misbehaves.
 */
import WebSocket from "ws";
import { pointInShape, shapeExit } from "../src/telegraph.mjs";
import { botMech } from "./selfplayMech/index.mjs";

const args = process.argv.slice(2);
const arg = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const URL = arg("url", "ws://127.0.0.1:8080/ws");
const RUNS = Number(arg("runs", "1"));
const QUIET = args.includes("--quiet");
/** Spend skill points into a PvE build and put new actives on the loadout. */
const LEARN_SKILLS = args.includes("--skills");
const BASE_NAME = arg("name", `Bot${Math.random().toString(36).slice(2, 6)}`);
const LEARN_ORDER = [
  "ferocia",
  "furious_cleave",
  "silenzio",
  "stone_skin",
  "fervore",
  "vigor",
  "wrath_charge",
  "lance_of_light",
  "bloodthirst",
  "grace",
  "war_cry",
  "shadow_step",
  "snare_glyph",
];
/** skilled: dodges telegraphs, casts, rings bells. naive: melee + flask only (a new phone player). */
const STYLE = arg("style", "skilled");
/** Skilled reaction time (ms): a telegraph is only "seen" this long after it appears — a human, not an oracle. */
const REACT_MS = Number(arg("react", "220"));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

const MOVE_SPEED = 8; // client PREDICT_SPEED, units/sec
const STEP_MS = 50;
const ATTACK_RANGE = 3.2;
/** Server drift from our predicted position that means "believe the server" (push-out, respawn). */
const RESYNC = 1.0;
const COMBO_CHAIN_MS = 800;

/** Legacy slam messages (older servers) as circle telegraphs. */
function legacyTele(m) {
  return {
    id: m.id,
    attackerId: m.attackerId,
    shape: "circle",
    x: m.x,
    y: m.y,
    radius: m.radius,
    durMs: (Number(m.duration) || 1) * 1000,
    kind: m.type === "boss_telegraph" ? "boss_slam" : "champ_slam",
  };
}

class Bot {
  constructor(name) {
    this.name = name;
    this.snap = null;
    this.toasts = [];
    this.errors = [];
    this.telegraphs = [];
    this.style = STYLE;
    this.stats = {};
    this.cur = null;
  }

  log(...a) {
    if (!QUIET) console.log(`[${this.name}]`, ...a);
  }

  async connect() {
    this.ws = new WebSocket(URL);
    await new Promise((res, rej) => {
      this.ws.once("open", res);
      this.ws.once("error", rej);
    });
    this.ws.on("message", (d) => this.onMsg(JSON.parse(String(d))));
    this.send({ type: "hello", name: this.name });
    await this.waitFor((s) => s.cantoId === "inferno_01", 6000, "hub join");
  }

  onMsg(m) {
    botMech(this.snap?.cantoId).onMsg?.(this, m);
    if (m.type === "snapshot") {
      this.snap = m.room;
      const st = this.cur && this.stats[this.cur];
      if (st && m.room.you) st.minHp = Math.min(st.minHp, m.room.you.hp);
      this.spendSkills();
      // Our own predicted position (like the client): moves step from it at walking
      // speed instead of from the ~130 ms-old snapshot; big server corrections win.
      const y = m.room.you;
      if (y && (!this.me || this.me.canto !== m.room.cantoId || Math.hypot(y.x - this.me.x, y.y - this.me.y) > RESYNC)) {
        this.me = { x: y.x, y: y.y, canto: m.room.cantoId };
      }
    } else if (m.type === "toast") {
      this.toasts.push({ t: Date.now(), level: m.level, text: m.text });
      // (every canto's wake line — Avarice's is "misura spezzata — you fall, and wake…";
      // the killing blow's combat message usually counted it already)
      if (/slain|fall under the weight|you fall, and wake/i.test(m.text) && this.cur) this.noteDeath();
      if (!QUIET && m.level !== "info") this.log(`  toast[${m.level}] ${m.text}`);
    } else if (m.type === "error") {
      this.errors.push(m);
      this.log(`  ERROR ${m.code}: ${m.message}`);
    } else if (m.type === "telegraph") {
      this.telegraphs.push({ ...m, durMs: Number(m.duration) || 500, at: Date.now() });
      if (this.cur && this.stats[this.cur] && m.dmg > 0) this.stats[this.cur].teles++;
    } else if (m.type === "shove") {
      // a slam threw us: our predicted position moves with it (like the client's forces)
      if (this.me) {
        this.me.x += Number(m.dx) || 0;
        this.me.y += Number(m.dy) || 0;
      }
    } else if (m.type === "telegraph_cancel") {
      this.telegraphs = this.telegraphs.filter((t) => t.id !== m.id);
    } else if (m.type === "boss_telegraph" || m.type === "champ_telegraph") {
      this.telegraphs.push({ ...legacyTele(m), at: Date.now() });
    } else if (m.type === "combat" && m.targetIsPlayer && this.snap && m.targetId === this.snap.you?.id) {
      if (this.cur) {
        this.stats[this.cur].dmgTaken += m.damage || 0;
        if (m.damage > 0) this.stats[this.cur].hits++;
        // the killing blow (the server wakes you at the entrance on the same tick)
        if (m.targetHp != null) this.stats[this.cur].minHp = Math.min(this.stats[this.cur].minHp, Number(m.targetHp));
        if (m.targetHp != null && Number(m.targetHp) <= 0) this.noteDeath();
      }
    }
  }

  /** One death per fall: the killing blow and the wake line both report it. */
  noteDeath() {
    const now = Date.now();
    if (this._deathAt && now - this._deathAt < 1500) return;
    this._deathAt = now;
    if (this.cur && this.stats[this.cur]) this.stats[this.cur].deaths++;
  }

  send(m) {
    if (this.ws.readyState === 1) this.ws.send(JSON.stringify(m));
  }

  spendSkills() {
    if (!LEARN_SKILLS) return;
    const prog = this.snap?.you?.prog;
    if (!prog) return;
    const ranks = prog.ranks || {};
    if (!this._loadoutSet && (ranks.furious_cleave || 0) >= 1) {
      this.send({
        type: "skill_loadout",
        slots: ["gale_bolt", "whirl_ward", "infernal_burst", "furious_cleave"],
      });
      this._loadoutSet = true;
    }
    if (!(prog.points > 0)) return;
    if (this._learnAt && Date.now() - this._learnAt < 160) return;
    for (const id of LEARN_ORDER) {
      const cur = Math.floor(Number(ranks[id]) || 0);
      if (cur >= 5) continue;
      this.send({ type: "skill_learn", skillId: id });
      this._learnAt = Date.now();
      return;
    }
  }

  async waitFor(pred, ms = 8000, label = "cond") {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (this.snap && pred(this.snap)) return this.snap;
      await sleep(30);
    }
    throw new Error(`timeout: ${label}`);
  }

  /** Server snapshot of us, with our predicted planar position. */
  get you() {
    const y = this.snap.you;
    if (this.me && this.me.canto === this.snap.cantoId) return { ...y, x: this.me.x, y: this.me.y };
    return y;
  }

  /** Step toward (x,y) (walking speed per STEP_MS at most) and tell the server. */
  moveTo(x, y) {
    if (this.me) {
      this.me.x = x;
      this.me.y = y;
    }
    this.send({ type: "move", x, y });
  }

  ents(kind) {
    return this.snap.entities.filter((e) => e.kind === kind);
  }

  foes() {
    return this.snap.entities.filter((e) => (e.kind === "mob" || e.kind === "boss") && e.hp > 0);
  }

  /** Step toward a point at player speed until within `stopAt`. */
  async walkTo(x, y, stopAt = 1.2, maxMs = 30000, { fight = false } = {}) {
    const t0 = Date.now();
    while (Date.now() - t0 < maxMs) {
      const you = this.you;
      const d = Math.hypot(x - you.x, y - you.y);
      if (d <= stopAt) return true;
      if (fight) {
        const near = this.foes().filter((f) => dist(f, you) < 4.5);
        if (near.length) await this.fightStep(near[0]);
      }
      const wp = botMech(this.snap?.cantoId).steer?.(this, you, { x, y }) || { x, y };
      const wd = Math.hypot(wp.x - you.x, wp.y - you.y) || 1e-6;
      const step = Math.min(wd, (MOVE_SPEED * STEP_MS) / 1000);
      this.moveTo(you.x + ((wp.x - you.x) / wd) * step, you.y + ((wp.y - you.y) / wd) * step);
      await sleep(STEP_MS);
    }
    return false;
  }

  async interact(id, label = id) {
    const e = this.snap.entities.find((x) => x.id === id);
    if (!e) throw new Error(`no entity ${label}`);
    await this.walkTo(e.x, e.y, 2.5);
    const before = this.toasts.length;
    this.send({ type: "interact", targetId: e.id });
    await sleep(350);
    return this.toasts.slice(before).map((t) => t.text);
  }

  poi(kind, extra = () => true) {
    return this.snap.entities.find((e) => e.kind === "poi" && e.poiKind === kind && extra(e));
  }

  /**
   * Skilled dodge: if we stand in a live damaging telegraph, step out along the
   * shortest exit that doesn't land in another one (dash when walking can't make it
   * in time or it's a slam). Returns true when it spent the step dodging.
   */
  async dodge(you, now) {
    const live = [];
    for (const t of this.telegraphs) {
      if (now - t.at < t.durMs + 120) live.push(t);
    }
    this.telegraphs = live;
    if (STYLE !== "skilled") return false;
    const me = this.snap.you?.id;
    let best = null;
    let soonest = Infinity;
    for (const t of live) {
      if (t.attackerId === me || !(t.dmg > 0 || t.kind === "boss_slam" || t.kind === "champ_slam")) continue;
      if (now - t.at < REACT_MS) continue;
      const ex = shapeExit(t, you.x, you.y, 0.45);
      if (!ex) continue;
      soonest = Math.min(soonest, t.durMs - (now - t.at));
      // prefer an exit that lands clear of every other live shape
      const ex2x = you.x + ex.x * ex.d;
      const ex2y = you.y + ex.y * ex.d;
      let blocked = 0;
      for (const o of live) if (o !== t && o.attackerId !== me && pointInShape(o, ex2x, ex2y, 0.3)) blocked++;
      const score = blocked * 10 + ex.d;
      if (!best || score < best.score) best = { t, ex, score };
    }
    if (!best) return false;
    const { ex, t } = best;
    const walkable = (Math.max(0, soonest - 60) / 1000) * MOVE_SPEED * 0.85 >= ex.d;
    const slam = t.kind === "boss_slam" || t.kind === "champ_slam" || t.kind === "champ_cleave";
    if ((!walkable || (slam && ex.d > 1.2)) && (!this._dashAt || now - this._dashAt > 4200)) {
      this._dashAt = now;
      this.stats[this.cur].dashes++;
      this.send({ type: "dash", x: ex.x, y: ex.y });
      if (this.me) {
        this.me.x += ex.x * 5.5;
        this.me.y += ex.y * 5.5;
      }
    } else {
      const step = Math.min(ex.d + 0.05, (MOVE_SPEED * STEP_MS) / 1000);
      this.moveTo(you.x + ex.x * step, you.y + ex.y * step);
    }
    this.stats[this.cur].dodges++;
    await sleep(STEP_MS);
    return true;
  }

  /** One tick of combat decisions against a target. */
  async fightStep(target) {
    const you = this.you;
    const now = Date.now();
    if (await this.dodge(you, now)) return;
    if (await botMech(this.cur).step?.(this, you, now, target)) return;
    if (you.hp < you.maxHp * 0.45 && (!this._sipAt || now - this._sipAt > 8200)) {
      this._sipAt = now;
      this.stats[this.cur].sips++;
      this.send({ type: "sip" });
    }
    const d = dist(target, you);
    const close = this.foes().filter((f) => dist(f, you) < 4.0).length;
    if (STYLE !== "skilled") {
      /* naive: no spells */
    } else if (close >= 3 && you.mana >= 48 && (!this._burstAt || now - this._burstAt > 11200)) {
      this._burstAt = now;
      this.send({ type: "cast", spellId: "infernal_burst" });
    } else if (you.hp < you.maxHp * 0.6 && you.mana >= 28 && (!this._wardAt || now - this._wardAt > 8200)) {
      this._wardAt = now;
      this.send({ type: "cast", spellId: "whirl_ward" });
    } else if (
      LEARN_SKILLS &&
      close >= 2 &&
      you.mana >= 10 &&
      (you.prog?.ranks?.furious_cleave || 0) >= 1 &&
      (!this._cleaveAt || now - this._cleaveAt > 4200)
    ) {
      this._cleaveAt = now;
      this.send({
        type: "cast",
        spellId: "furious_cleave",
        aimX: target.x - you.x,
        aimY: target.y - you.y,
      });
    } else if (d < 9 && you.mana >= 40 && (!this._boltAt || now - this._boltAt > 1500)) {
      this._boltAt = now;
      this.send({ type: "cast", spellId: "gale_bolt", aimX: target.x - you.x, aimY: target.y - you.y });
    }
    if (d > ATTACK_RANGE - 0.4) {
      const step = Math.min(d - (ATTACK_RANGE - 0.8), (MOVE_SPEED * STEP_MS) / 1000);
      this.moveTo(you.x + ((target.x - you.x) / d) * step, you.y + ((target.y - you.y) / d) * step);
    } else if (!this._atkAt || now - this._atkAt > 450) {
      // the client chains forehand → backhand → overhead finisher while you keep swinging
      this._combo = this._atkAt && now - this._atkAt < COMBO_CHAIN_MS ? ((this._combo || 0) + 1) % 3 : 0;
      this._atkAt = now;
      this.send({ type: "attack", targetId: target.id, combo: this._combo });
    }
    await sleep(STEP_MS);
  }

  /** Melt the bag when it is nearly full (the INV "Melt" button a player would press). */
  async meltIfFull(threshold = 34) {
    const bag = (this.you.inventory || []).filter((i) => !i.equipSlot).length;
    if (bag < threshold) return;
    await this.autoEquip();
    this.send({ type: "salvage_bag" });
    await sleep(200);
    this.melts = (this.melts || 0) + 1;
  }

  async pickupNearby(radius = 14) {
    await this.meltIfFull();
    for (const L of this.ents("loot")) {
      if (dist(L, this.you) > radius) continue;
      await this.walkTo(L.x, L.y, 2.0, 6000);
      const before = this.you.inventory.length;
      this.send({ type: "pickup", lootId: L.id });
      await sleep(120);
      if (this.you.inventory.length > before) this.stats[this.cur].loot++;
    }
  }

  /** Equip anything with a better rolled stat for its slot. */
  async autoEquip() {
    const inv = this.you.inventory || [];
    const bag = inv.filter((i) => !i.equipSlot);
    const EQUIPPABLE = new Set(["weapon", "armor", "chest", "helm", "head", "boots", "feet", "gloves", "hands", "offhand", "shield"]);
    for (const it of bag) {
      if (!EQUIPPABLE.has(String(it.slot || "").toLowerCase())) continue;
      const rank = { normal: 0, magic: 1, rare: 2, set: 3, unique: 4, canto_unique: 5 };
      const worn = inv.find((w) => w.equipSlot && w.slot === it.slot);
      if (!worn || (rank[it.rarity] ?? 0) > (rank[worn.rarity] ?? 0)) {
        this.send({ type: "equip", itemId: it.id });
        await sleep(80);
      }
    }
  }

  /** Walk to the forward road while it should still be sealed and try it. */
  async checkSealedRoad(to) {
    const road = this.snap.entities.find((e) => (e.kind === "exit" || e.poiKind === "portal") && e.toCanto === to);
    if (!road) throw new Error(`${this.snap.cantoId}: no road to ${to}`);
    await this.walkTo(road.x, road.y, 2.5, 20000);
    const before = this.toasts.length;
    this.send({ type: "interact", targetId: road.id });
    await sleep(400);
    const said = this.toasts.slice(before).map((t) => t.text).join(" | ");
    if (this.snap.cantoId !== this.cur) throw new Error(`road ${this.cur}→${to} opened before the boss fell`);
    if (!/Clear|sealed/i.test(said)) throw new Error(`road ${this.cur}→${to}: no seal message (${said})`);
    this.log(`  road ${this.cur}→${to} sealed ✓ (${said})`);
  }

  async clearCanto(cantoId, bossId, maxMs = 240000, sealedRoad = null) {
    const st = (this.stats[cantoId] = { t0: Date.now(), deaths: 0, dmgTaken: 0, minHp: 9999, loot: 0, sips: 0, dashes: 0, kills: 0, dodges: 0, teles: 0, hits: 0 });
    this.cur = cantoId;
    const shrine = this.poi("shrine");
    const cache = this.poi("cache");
    const bell = this.poi("bell");
    await this.meltIfFull(30);
    if (cache) {
      const lines = await this.interact(cache.id, "cache");
      this.log(`  cache → ${lines.join(" | ")}`);
      if (!lines.some((l) => /Cache|cache/.test(l))) throw new Error(`${cantoId}: cache gave no loot line`);
    }
    let bellRung = false;
    const t0 = Date.now();
    const startFoes = this.foes().length;
    while (Date.now() - t0 < maxMs) {
      const you = this.you;
      const boss = this.snap.entities.find((e) => e.id === bossId);
      if (!boss) break;
      // Low HP and nothing adjacent → go kneel at the shrine
      const adj = this.foes().filter((f) => dist(f, you) < 5);
      if (shrine && you.hp < you.maxHp * 0.3 && adj.length === 0) {
        await this.interact(shrine.id, "shrine");
        continue;
      }
      // Ring the bell once when a crowd is near it
      if (STYLE === "skilled" && bell && !bellRung && dist(bell, you) < 9) {
        const lines = await this.interact(bell.id, "bell");
        this.log(`  bell → ${lines.join(" | ")}`);
        bellRung = true;
        continue;
      }
      // Target: nearest foe, but leave the boss for last unless it's the only thing near
      const foes = this.foes().sort((a, b) => dist(a, you) - dist(b, you));
      const nonBoss = foes.filter((f) => f.kind !== "boss");
      // Like a player: sweep packs first, then push for the boss (Avarice refills
      // fodder packs, so "clear everything" never ends there).
      const pushBoss = Date.now() - t0 > 100000 || foes.length <= startFoes * 0.3;
      if (sealedRoad && (nonBoss.length === 0 || pushBoss)) {
        await this.checkSealedRoad(sealedRoad);
        sealedRoad = null;
        continue;
      }
      const adjacent = nonBoss.length && dist(nonBoss[0], you) < 3.2;
      const target = pushBoss
        ? adjacent
          ? nonBoss[0]
          : boss
        : nonBoss.length && (dist(nonBoss[0], you) < 30 || dist(boss, you) > 12)
          ? nonBoss[0]
          : boss;
      await this.fightStep(target);
      if (this.ents("loot").some((l) => dist(l, you) < 6)) await this.pickupNearby(6);
    }
    const bossGone = !this.snap.entities.some((e) => e.id === bossId);
    st.kills = startFoes - this.foes().length;
    await sleep(300);
    await this.pickupNearby(16);
    st.seconds = Math.round((Date.now() - st.t0) / 1000);
    st.cleared = bossGone && this.you.firstClears.includes(cantoId);
    await this.autoEquip();
    this.log(`  ${cantoId} cleared=${st.cleared} in ${st.seconds}s deaths=${st.deaths} minHp=${st.minHp} dmgTaken=${st.dmgTaken} loot=${st.loot}`);
    if (!st.cleared) throw new Error(`${cantoId}: boss ${bossId} not cleared (${bossGone ? "no first clear" : "timeout"})`);
  }

  /** Walk to an exit/portal that leads to `to` and use it. */
  async takeRoad(to) {
    const road =
      this.snap.entities.find((e) => e.kind === "poi" && e.poiKind === "portal" && e.toCanto === to) ||
      this.snap.entities.find((e) => e.kind === "exit" && e.toCanto === to);
    if (!road) throw new Error(`${this.snap.cantoId}: no road to ${to}`);
    await this.walkTo(road.x, road.y, 3, 120000, { fight: true });
    this.send({ type: "interact", targetId: road.id });
    await this.waitFor((s) => s.cantoId === to, 5000, `travel ${this.snap.cantoId}→${to}`);
    await sleep(250);
    this.log(`→ entered ${this.snap.title} (${to}) at ${this.you.x.toFixed(1)},${this.you.y.toFixed(1)}`);
  }

  /** A travel request far from any road must be refused (server-authoritative roads). */
  async expectRemoteTravelRefused(to) {
    const from = this.snap.cantoId;
    await this.walkTo(this.you.x + 12, this.you.y, 1, 3000);
    const before = this.toasts.length;
    this.send({ type: "travel", toCanto: to });
    await sleep(350);
    if (this.snap.cantoId !== from) throw new Error(`remote travel ${from}→${to} was allowed`);
    const said = this.toasts.slice(before).map((t) => t.text).join(" | ");
    this.log(`  remote travel ${from}→${to} refused ✓ (${said})`);
  }

  async run() {
    await this.connect();
    this.cur = "inferno_01";
    this.stats.inferno_01 = { t0: Date.now(), deaths: 0, dmgTaken: 0, minHp: 9999, loot: 0, sips: 0, dashes: 0, dodges: 0, teles: 0, hits: 0 };
    this.log(`hub spawn ${this.you.x},${this.you.y} inv=${this.you.inventory.length}`);
    await this.autoEquip();
    const board = this.poi("quest");
    let lines = await this.interact(board.id, "daily board (early)");
    this.log(`  writ before guide → ${lines.join(" | ")}`);
    lines = await this.interact(this.poi("npc").id, "guide");
    this.log(`  guide → ${lines.join(" | ").slice(0, 120)}…`);
    lines = await this.interact(this.poi("pyre").id, "pyre");
    this.log(`  pyre → ${lines.join(" | ")}`);
    lines = await this.interact(this.poi("stash").id, "stash");
    this.log(`  stash → ${lines.join(" | ")}`);
    lines = await this.interact(this.poi("ah").id, "ah");
    this.log(`  ah → ${lines.join(" | ")}`);

    await this.takeRoad("inferno_05");
    await this.expectRemoteTravelRefused("inferno_01");
    await this.clearCanto("inferno_05", "minos_gate", 240000, "inferno_06");
    await this.takeRoad("inferno_06");
    await this.clearCanto("inferno_06", "triple_maw", 240000, "inferno_07");
    await this.takeRoad("inferno_07");
    await this.clearCanto("inferno_07", "hoard_crush");
    await this.takeRoad("inferno_08");
    await this.clearCanto("inferno_08", "argenti_fury");
    await this.takeRoad("inferno_01");

    this.cur = "inferno_01";
    lines = await this.interact(this.poi("quest").id, "daily board");
    this.log(`  writ after road → ${lines.join(" | ")}`);
    const sellable = this.you.inventory.find((i) => !i.equipSlot && !i.soulbound);
    if (sellable) {
      this.send({ type: "ah_list", itemId: sellable.id, priceAsh: 500 });
      await sleep(300);
      this.log(`  listed ${sellable.name} on AH`);
    }
    this.send({ type: "salvage_bag" });
    await sleep(300);
    this.log(
      `final ash=${this.you.ash} pending=${this.you.pendingAsh} clears=${this.you.firstClears.join(",")} level=${this.you.prog?.level} xp=${this.you.prog?.xp}`
    );
    this.ws.close();
    return { stats: this.stats, errors: this.errors, you: this.you };
  }
}

/** --coop: every run is a party of two sharing the same canto rooms. */
const PARTY = args.includes("--coop") ? 2 : 1;

let failed = 0;
const all = [];
async function playOne(name, label) {
  const bot = new Bot(name);
  try {
    const res = await bot.run();
    all.push(res);
    if (res.errors.length) {
      failed++;
      console.error(`${label}: server errors`, res.errors);
    }
  } catch (err) {
    failed++;
    console.error(`${label} FAILED:`, err.message);
    try {
      bot.ws.close();
    } catch {}
  }
}
for (let r = 0; r < RUNS; r++) {
  const party = [];
  for (let m = 0; m < PARTY; m++) {
    const name = `${BASE_NAME}${RUNS > 1 ? r : ""}${PARTY > 1 ? String.fromCharCode(97 + m) : ""}`;
    party.push(playOne(name, `run ${r}${PARTY > 1 ? ` member ${m}` : ""}`));
    if (PARTY > 1) await sleep(700);
  }
  await Promise.all(party);
}

console.log("\n=== self-play summary ===");
for (const c of ["inferno_05", "inferno_06", "inferno_07", "inferno_08"]) {
  const rows = all.map((a) => a.stats[c]).filter(Boolean);
  if (!rows.length) continue;
  const avg = (k) => (rows.reduce((s, r) => s + (r[k] || 0), 0) / rows.length).toFixed(1);
  console.log(
    `${c}: cleared ${rows.filter((r) => r.cleared).length}/${rows.length}  avg ${avg("seconds")}s  deaths ${avg("deaths")}  minHp ${avg("minHp")}  dmgTaken ${avg("dmgTaken")}  hits ${avg("hits")}  loot ${avg("loot")}  sips ${avg("sips")}  dashes ${avg("dashes")}  dodges ${avg("dodges")}  teles ${avg("teles")}`
  );
}
const total = RUNS * PARTY;
const lv = all.map((a) => a.you?.prog?.level).filter((n) => n != null);
if (lv.length) console.log(`levels: ${lv.join(", ")}  xp: ${all.map((a) => a.you?.prog?.xp).join(", ")}`);
console.log(failed ? `\n${failed}/${total} player run(s) failed` : `\nall ${total} player run(s) passed`);
process.exit(failed ? 1 : 0);
