#!/usr/bin/env node
/**
 * Headless self-play: a bot walks the whole Slice 1 road through the real
 * WebSocket protocol and reports whether every canto is reachable and
 * completable, plus a few balance numbers per canto.
 *
 *   Dark Wood (Guide, pyre, stash, AH, writ) → Lust → Gluttony → Avarice → Dark Wood
 *
 * Usage (server must be running):
 *   node scripts/selfplay.mjs [--url ws://127.0.0.1:8080/ws] [--name Bot] [--runs 1] [--quiet]
 *
 * Exits non-zero if any canto cannot be cleared or a gate misbehaves.
 */
import WebSocket from "ws";

const args = process.argv.slice(2);
const arg = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const URL = arg("url", "ws://127.0.0.1:8080/ws");
const RUNS = Number(arg("runs", "1"));
const QUIET = args.includes("--quiet");
const BASE_NAME = arg("name", `Bot${Math.random().toString(36).slice(2, 6)}`);
/** skilled: dodges telegraphs, casts, rings bells. naive: melee + flask only (a new phone player). */
const STYLE = arg("style", "skilled");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

const MOVE_SPEED = 8; // client PREDICT_SPEED, units/sec
const STEP_MS = 50;
const ATTACK_RANGE = 3.2;

class Bot {
  constructor(name) {
    this.name = name;
    this.snap = null;
    this.toasts = [];
    this.errors = [];
    this.telegraphs = [];
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
    if (m.type === "snapshot") {
      this.snap = m.room;
      const st = this.cur && this.stats[this.cur];
      if (st && m.room.you) st.minHp = Math.min(st.minHp, m.room.you.hp);
    } else if (m.type === "toast") {
      this.toasts.push({ t: Date.now(), level: m.level, text: m.text });
      if (/slain|fall under the weight/i.test(m.text) && this.cur) this.stats[this.cur].deaths++;
      if (!QUIET && m.level !== "info") this.log(`  toast[${m.level}] ${m.text}`);
    } else if (m.type === "error") {
      this.errors.push(m);
      this.log(`  ERROR ${m.code}: ${m.message}`);
    } else if (m.type === "boss_telegraph" || m.type === "champ_telegraph") {
      this.telegraphs.push({ ...m, at: Date.now() });
    } else if (m.type === "combat" && m.targetIsPlayer && this.snap && m.targetId === this.snap.you?.id) {
      if (this.cur) this.stats[this.cur].dmgTaken += m.damage || 0;
    }
  }

  send(m) {
    if (this.ws.readyState === 1) this.ws.send(JSON.stringify(m));
  }

  async waitFor(pred, ms = 8000, label = "cond") {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (this.snap && pred(this.snap)) return this.snap;
      await sleep(30);
    }
    throw new Error(`timeout: ${label}`);
  }

  get you() {
    return this.snap.you;
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
      const step = Math.min(d, (MOVE_SPEED * STEP_MS) / 1000);
      this.send({ type: "move", x: you.x + ((x - you.x) / d) * step, y: you.y + ((y - you.y) / d) * step });
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

  /** One tick of combat decisions against a target. */
  async fightStep(target) {
    const you = this.you;
    const now = Date.now();
    // Dodge a live slam telegraph aimed near us
    const tele = STYLE === "skilled" && this.telegraphs.find((t) => now - t.at < t.duration * 1000 && Math.hypot(t.x - you.x, t.y - you.y) < t.radius + 0.6);
    if (tele) {
      const dx = you.x - tele.x;
      const dy = you.y - tele.y;
      const l = Math.hypot(dx, dy) || 1;
      if (!this._dashAt || now - this._dashAt > 4200) {
        this._dashAt = now;
        this.stats[this.cur].dashes++;
        this.send({ type: "dash", x: dx / l, y: dy / l });
      } else {
        this.send({ type: "move", x: you.x + (dx / l) * 0.45, y: you.y + (dy / l) * 0.45 });
      }
      await sleep(STEP_MS);
      return;
    }
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
    } else if (d < 9 && you.mana >= 40 && (!this._boltAt || now - this._boltAt > 1500)) {
      this._boltAt = now;
      this.send({ type: "cast", spellId: "gale_bolt", aimX: target.x - you.x, aimY: target.y - you.y });
    }
    if (d > ATTACK_RANGE - 0.4) {
      const step = Math.min(d - (ATTACK_RANGE - 0.8), (MOVE_SPEED * STEP_MS) / 1000);
      this.send({ type: "move", x: you.x + ((target.x - you.x) / d) * step, y: you.y + ((target.y - you.y) / d) * step });
    } else if (!this._atkAt || now - this._atkAt > 450) {
      this._atkAt = now;
      this.send({ type: "attack", targetId: target.id });
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
    const st = (this.stats[cantoId] = { t0: Date.now(), deaths: 0, dmgTaken: 0, minHp: 9999, loot: 0, sips: 0, dashes: 0, kills: 0 });
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
      if (sealedRoad && nonBoss.length === 0) {
        await this.checkSealedRoad(sealedRoad);
        sealedRoad = null;
        continue;
      }
      const target = nonBoss.length && (dist(nonBoss[0], you) < 30 || dist(boss, you) > 12) ? nonBoss[0] : boss;
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
    this.stats.inferno_01 = { t0: Date.now(), deaths: 0, dmgTaken: 0, minHp: 9999, loot: 0, sips: 0, dashes: 0 };
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
    this.log(`final ash=${this.you.ash} pending=${this.you.pendingAsh} clears=${this.you.firstClears.join(",")}`);
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
for (const c of ["inferno_05", "inferno_06", "inferno_07"]) {
  const rows = all.map((a) => a.stats[c]).filter(Boolean);
  if (!rows.length) continue;
  const avg = (k) => (rows.reduce((s, r) => s + (r[k] || 0), 0) / rows.length).toFixed(1);
  console.log(
    `${c}: cleared ${rows.filter((r) => r.cleared).length}/${rows.length}  avg ${avg("seconds")}s  deaths ${avg("deaths")}  minHp ${avg("minHp")}  dmgTaken ${avg("dmgTaken")}  loot ${avg("loot")}  sips ${avg("sips")}  dashes ${avg("dashes")}`
  );
}
const total = RUNS * PARTY;
console.log(failed ? `\n${failed}/${total} player run(s) failed` : `\nall ${total} player run(s) passed`);
process.exit(failed ? 1 : 0);
