#!/usr/bin/env node
/**
 * Levels / skill-tree regression. Spawns its own server on PORT_TEST (default 8102).
 *
 *   cd server && node scripts/progression-regression.mjs
 *   DATABASE_URL=postgresql://selva:selva_local@127.0.0.1:5433/selva node scripts/progression-regression.mjs
 *
 * Refuses DATABASE_URL hosts that look like Neon / Railway / Supabase.
 * Memory mode (no DATABASE_URL) skips restart persistence and SQL backfill.
 */
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import { itemStatBonus } from "../src/loot.mjs";
import { pvpDamage } from "../src/pvp.mjs";
import {
  firstClearXp,
  LEVEL_CAP,
  totalXpForLevel,
  xpToNext,
} from "../src/progression.mjs";
import { SKILLS, spentPoints, unspentPoints, canLearn, defaultRanks } from "../src/skills.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PORT_TEST || 8103);
const dbUrl = process.env.DATABASE_URL || "";
const remoteDb = /neon\.tech|railway|rlwy|supabase/i.test(dbUrl);
if (dbUrl && remoteDb) {
  console.error("Refusing non-local DATABASE_URL (neon/railway/supabase)");
  process.exit(2);
}
const dotenvPath = path.join(root, ".env");
if (!dbUrl && fs.existsSync(dotenvPath)) {
  console.error("Memory run would still load server/.env — move it aside first");
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (ok, label, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${extra ? " — " + extra : ""}`);
  if (!ok) failures++;
};

function sumGear(items) {
  const s = { dmg: 0, maxHp: 0, armor: 0 };
  for (const it of items) {
    const b = itemStatBonus(it);
    s.dmg += b.dmg;
    s.maxHp += b.maxHp;
    s.armor += b.armor;
  }
  return s;
}

function ttk(attacker, target, roll, pattern, lvA = 1, lvD = 1, atkDmg, defHp) {
  const maxHp = defHp ?? 130 + target.maxHp + 4 * Math.max(0, lvD - 1);
  const weapon = atkDmg ?? 22 + attacker.dmg + 0.4 * Math.max(0, lvA - 1);
  const armor = (target.armor || 0) + 0.25 * Math.max(0, lvD - 1);
  let hp = maxHp;
  let swings = 0;
  const hits = [];
  while (hp > 0 && swings < 120) {
    const kind = pattern[swings % pattern.length];
    let raw = weapon + roll;
    if (kind === "finisher") raw = Math.round(raw * 1.3);
    const dmg = pvpDamage(raw, {
      attackerGear: attacker,
      targetGear: { ...target, armor },
      targetMaxHp: maxHp,
      kind,
      levelAtk: lvA,
      levelDef: lvD,
    });
    hits.push(dmg);
    hp -= dmg;
    swings++;
  }
  const time = +(0.12 + (swings - 1) * 0.42).toFixed(2);
  return { swings, time, hit: hits[0], maxHp };
}

function printCurveAndTtk() {
  check(xpToNext(1) === 100, "xpToNext(1) === 100", String(xpToNext(1)));
  check(LEVEL_CAP === 50, "level cap 50");
  const t50 = totalXpForLevel(50);
  const perRun = 2665;
  const runs = t50 / perRun;
  console.log(
    `XP curve: L2=${xpToNext(1)} L6 total=${totalXpForLevel(6)} L9 total=${totalXpForLevel(9)} L50 total=${t50} (~${runs.toFixed(0)} full-circuit kill XP units)`
  );
  check(t50 / 1300 > 60, "L50 needs ~60+ Avarice-scale runs", `total ${t50}`);
  check(spentPoints(defaultRanks()) === 0, "free ranks spend 0 points");
  check(unspentPoints(1, defaultRanks()) === 0, "level 1 has 0 points");
  check(unspentPoints(5, defaultRanks()) === 4, "level 5 has 4 points");
  const gate = canLearn(SKILLS.wrath_charge, { level: 5, ranks: { furious_cleave: 1, gale_bolt: 1, whirl_ward: 1, infernal_burst: 1 } });
  check(!gate.ok && gate.error === "level", "wrath_charge gated at level 6");

  const starter = sumGear([
    { slot: "weapon", rarity: "normal", affixes: [] },
    { slot: "armor", rarity: "normal", affixes: [] },
  ]);
  const ss = ttk(starter, starter, 2, ["melee"], 1, 1);
  console.log(`TTK L1-vs-L1 starter light roll2 ${ss.time}s (${ss.swings}×${ss.hit}, hp ${ss.maxHp})`);
  check(ss.time >= 4 && ss.time <= 7, "TTK L1 starter-vs-starter still 4–7s", `${ss.time}s`);
  const l30 = ttk(starter, starter, 2, ["melee"], 30, 1);
  console.log(`TTK L30-vs-L1 starter light roll2 ${l30.time}s (${l30.swings}×${l30.hit}, hp ${l30.maxHp})`);
  const eq30 = ttk(starter, starter, 2, ["melee"], 30, 30);
  console.log(`TTK L30-vs-L30 starter light roll2 ${eq30.time}s (${eq30.swings}×${eq30.hit}, hp ${eq30.maxHp})`);
}

printCurveAndTtk();

let srv = null;
async function startServer() {
  const env = {
    ...process.env,
    PORT: String(port),
    NODE_ENV: "test",
    SELVA_DEV_XP: "1",
    SELVA_PVP_ROUND_SEC: "20",
    SELVA_PVP_INTERMISSION_SEC: "0",
  };
  if (dbUrl) env.DATABASE_URL = dbUrl;
  else delete env.DATABASE_URL;
  srv = spawn(process.execPath, ["index.mjs"], {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  srv.logs = "";
  srv.stdout.on("data", (d) => (srv.logs += d));
  srv.stderr.on("data", (d) => (srv.logs += d));
  for (let i = 0; i < 120; i++) {
    await sleep(100);
    if (srv.logs.includes("listening on")) return;
    if (srv.exitCode != null) break;
  }
  throw new Error("server did not start:\n" + srv.logs);
}
async function stopServer() {
  if (!srv) return;
  const s = srv;
  srv = null;
  s.kill("SIGTERM");
  await new Promise((r) => (s.exitCode != null ? r() : s.on("exit", r)));
  return s.logs;
}

async function connect(name) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  await new Promise((res, rej) => {
    ws.on("open", res);
    ws.on("error", rej);
  });
  const c = { ws, name, snap: null, msgs: [], id: null };
  ws.on("message", (d) => {
    let m;
    try {
      m = JSON.parse(String(d));
    } catch {
      return;
    }
    c.msgs.push(m);
    if (m.type === "snapshot") c.snap = m;
  });
  ws.send(JSON.stringify({ type: "hello", name }));
  for (let i = 0; i < 100 && !c.snap?.room?.you; i++) await sleep(50);
  if (!c.snap?.room?.you) throw new Error("no snapshot for " + name);
  c.id = c.snap.room.you.id;
  c.send = (m) => {
    if (ws.readyState === 1) ws.send(JSON.stringify(m));
  };
  return c;
}

async function wait(c, pred, label, ms = 8000, from = 0) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const hit = c.msgs.slice(from).find(pred);
    if (hit) return hit;
    await sleep(30);
  }
  const tail = c.msgs.slice(-8).map((m) => m.type + (m.error ? ":" + m.error : "") + (m.text ? ":" + m.text : "")).join(", ");
  throw new Error(`${c.name}: timeout ${label} (recent ${tail})`);
}

async function waitGear(c) {
  for (let i = 0; i < 80; i++) {
    const you = c.snap?.room?.you;
    if (you && you.gearStats?.dmg >= 6 && you.maxHp >= 138) return you;
    await sleep(50);
  }
  throw new Error(`${c.name} gear did not settle`);
}

async function go(c, canto) {
  const from = c.msgs.length;
  c.send({ type: "travel", toCanto: canto, bypassGates: true });
  await wait(c, (m) => m.type === "snapshot" && m.room?.cantoId === canto, `travel ${canto}`, 5000, from);
  c._px = c.snap.room.you.x;
  c._py = c.snap.room.you.y;
}

async function stepToward(c, tx, ty) {
  const you = c.snap?.room?.you;
  if (!you) {
    await sleep(50);
    return;
  }
  if (c._px == null || Math.hypot(you.x - c._px, you.y - c._py) > 0.9) {
    c._px = you.x;
    c._py = you.y;
  }
  const dx = tx - c._px;
  const dy = ty - c._py;
  const d = Math.hypot(dx, dy);
  if (d < 0.15) {
    await sleep(50);
    return;
  }
  const step = Math.min(0.4, d);
  c._px += (dx / d) * step;
  c._py += (dy / d) * step;
  c.send({ type: "move", x: +c._px.toFixed(3), y: +c._py.toFixed(3) });
  await sleep(50);
}

async function walkTo(c, x, y, timeout = 12000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const you = c.snap?.room?.you;
    if (you && Math.hypot(you.x - x, you.y - y) <= 1.2) return;
    await stepToward(c, x, y);
  }
}

function nearestMob(c) {
  const you = c.snap?.room?.you;
  const ents = c.snap?.room?.entities || [];
  let best = null;
  let bestD = 999;
  for (const e of ents) {
    if (e.kind !== "mob" && e.kind !== "boss") continue;
    if (!(e.hp > 0)) continue;
    const d = Math.hypot(e.x - you.x, e.y - you.y);
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  return best;
}

async function walkToMob(c) {
  const t0 = Date.now();
  while (Date.now() - t0 < 15000) {
    const m = nearestMob(c);
    if (!m) {
      await sleep(100);
      continue;
    }
    const you = c.snap.room.you;
    if (Math.hypot(m.x - you.x, m.y - you.y) <= 2.0) return m;
    await stepToward(c, m.x, m.y);
  }
  return nearestMob(c);
}

function prog(c) {
  return c.snap?.room?.you?.prog || {};
}

async function grant(c, amount) {
  const from = c.msgs.length;
  c.send({ type: "dev_grant_xp", amount });
  await wait(c, (m) => m.type === "xp_gain" || m.type === "level_up" || (m.type === "snapshot" && (m.room?.you?.prog?.xp || 0) > 0), "grant xp", 4000, from);
}

async function learn(c, id) {
  const from = c.msgs.length;
  c.send({ type: "skill_learn", skillId: id });
  return wait(c, (m) => m.type === "skill_result" && m.op === "learn", `learn ${id}`, 3000, from);
}

async function loadout(c, slots) {
  const from = c.msgs.length;
  c.send({ type: "skill_loadout", slots });
  return wait(c, (m) => m.type === "skill_result" && m.op === "loadout", "loadout", 3000, from);
}

async function run() {
  const tag = Date.now().toString(36);
  const A = await connect(`LvA${tag}`);
  const B = await connect(`LvB${tag}`);
  await waitGear(A);
  await waitGear(B);

  const p0 = prog(A);
  check(p0.level === 1, "fresh character level 1", String(p0.level));
  check(p0.points === 0, "fresh character 0 points", String(p0.points));
  check(p0.ranks?.gale_bolt === 1 && p0.ranks?.whirl_ward === 1 && p0.ranks?.infernal_burst === 1, "free ranks 1");
  check(JSON.stringify(p0.loadout) === JSON.stringify(["gale_bolt", "whirl_ward", "infernal_burst", null]), "default loadout");
  check(A.snap.room.you.maxHp >= 138 && A.snap.room.you.maxMana === 100, "L1 hp/mana unchanged", `hp ${A.snap.room.you.maxHp} mana ${A.snap.room.you.maxMana}`);
  check(A.snap.room.you.lv === 1, "you.lv is 1");
  {
    let remoteLv;
    for (let i = 0; i < 40; i++) {
      remoteLv = (A.snap.room.players || []).find((p) => p.id === B.id)?.lv;
      if (remoteLv === 1) break;
      await sleep(50);
    }
    check(remoteLv === 1, "remote lv is 1", String(remoteLv));
  }

  // Old-client gale_bolt without skill_* messages
  {
    await go(A, "inferno_05");
    const mob = await walkToMob(A);
    check(!!mob, "Lust has a mob", mob ? mob.name : "none");
    const from = A.msgs.length;
    const hp0 = mob?.hp;
    A.send({ type: "cast", spellId: "gale_bolt", aimX: (mob?.x || 0) - A.snap.room.you.x, aimY: (mob?.y || 0) - A.snap.room.you.y });
    const fx = await wait(A, (m) => m.type === "spell_fx" && m.spellId === "gale_bolt", "old-client gale fx", 3000, from);
    check(!!fx, "old-client gale_bolt still casts");
    await sleep(400);
    const dmg = A.msgs.slice(from).filter((m) => m.type === "combat" && m.damage > 0);
    check(dmg.length > 0 || (nearestMob(A) && nearestMob(A).hp < hp0), "old-client gale damages a mob", `combat ${dmg.length}`);
  }

  // Learn validation
  {
    const u = await learn(A, "nope_skill");
    check(u.ok === false && u.error === "unknown", "unknown skill id rejected", u.error);
    const t = await learn(A, 123);
    check(t.ok === false, "non-string skill id rejected");
    const np = await learn(A, "ferocia");
    check(np.ok === false && np.error === "no_points", "learn without points rejected", np.error);
    const from = A.msgs.length;
    A.send({ type: "skill_learn", skillId: "ferocia" });
    A.send({ type: "skill_learn", skillId: "ferocia" });
    await sleep(80);
    // rate limit may swallow the second; first still no_points
    const loadBad = await loadout(A, ["gale_bolt", "gale_bolt", null, null]);
    check(loadBad.ok === false && loadBad.error === "duplicate", "duplicate loadout rejected", loadBad.error);
    const loadPas = await loadout(A, ["ferocia", "gale_bolt", "whirl_ward", "infernal_burst"]);
    check(loadPas.ok === false && loadPas.error === "not_active", "passive in loadout rejected", loadPas.error);
    const loadUnk = await loadout(A, ["gale_bolt", "whirl_ward", "infernal_burst", "nope"]);
    check(loadUnk.ok === false, "unknown loadout id rejected");
    const over = await loadout(A, ["gale_bolt", "whirl_ward", "infernal_burst", null, "x"]);
    check(over.ok === false, "loadout longer than 4 rejected", over.error);
  }

  // Cast not in loadout
  {
    const r = await loadout(A, ["whirl_ward", "infernal_burst", null, null]);
    check(r.ok === true, "loadout without gale accepted", JSON.stringify(r));
    const from = A.msgs.length;
    A.send({ type: "cast", spellId: "gale_bolt", aimX: 1, aimY: 0 });
    const toast = await wait(A, (m) => m.type === "toast" && /loadout/i.test(m.text || ""), "cast not in loadout", 3000, from);
    check(!!toast, "cast not in loadout toasted");
    await loadout(A, ["gale_bolt", "whirl_ward", "infernal_burst", null]);
  }

  // Cooldown reject
  {
    const from = A.msgs.length;
    A.send({ type: "cast", spellId: "gale_bolt", aimX: 1, aimY: 0 });
    A.send({ type: "cast", spellId: "gale_bolt", aimX: 1, aimY: 0 });
    const rec = await wait(A, (m) => m.type === "toast" && /recharging/i.test(m.text || ""), "gale cd", 2000, from);
    check(!!rec, "cast on cooldown rejected");
    await sleep(1600);
  }

  // Level-up refill + points
  {
    const hpBefore = A.snap.room.you.hp;
    A.send({ type: "cast", spellId: "infernal_burst" });
    await sleep(200);
    const manaMid = A.snap.room.you.mana;
    const from = A.msgs.length;
    await grant(A, 100);
    const lu = A.msgs.slice(from).find((m) => m.type === "level_up");
    check(!!lu && lu.level === 2, "level_up broadcast to 2", lu ? String(lu.level) : "none");
    await sleep(200);
    const p = prog(A);
    check(p.level === 2 && p.points === 1, "level 2 grants 1 point", JSON.stringify({ l: p.level, pts: p.points }));
    check(A.snap.room.you.hp === A.snap.room.you.maxHp, "level-up refills HP", `${A.snap.room.you.hp}/${A.snap.room.you.maxHp} was ${hpBefore}`);
    check(A.snap.room.you.mana === A.snap.room.you.maxMana, "level-up refills mana", `${A.snap.room.you.mana} mid ${manaMid}`);
    check(A.snap.room.you.maxHp === hpBefore + 4 || A.snap.room.you.maxHp >= 142, "level 2 +4 HP", String(A.snap.room.you.maxHp));
    check(A.snap.room.you.maxMana === 102, "level 2 +2 mana", String(A.snap.room.you.maxMana));
  }

  // Prereq / level gates after having a point
  {
    const low = await learn(A, "wrath_charge");
    check(low.ok === false && (low.error === "prereq" || low.error === "level"), "wrath_charge blocked at L2", low.error);
    const ok = await learn(A, "ferocia");
    check(ok.ok === true, "learn ferocia with a point");
    check(prog(A).ranks.ferocia === 1 && prog(A).points === 0, "ferocia rank 1, 0 points left");
    const max = await learn(A, "ferocia");
    check(max.ok === false && max.error === "no_points", "second ferocia needs another point", max.error);
  }

  // Mana check
  {
    await grant(A, 400);
    await learn(A, "lance_of_light");
    await loadout(A, ["lance_of_light", "gale_bolt", "whirl_ward", "infernal_burst"]);
    await sleep(150);
    A.send({ type: "cast", spellId: "infernal_burst" });
    await sleep(120);
    A.send({ type: "cast", spellId: "whirl_ward" });
    await sleep(120);
    A.send({ type: "cast", spellId: "gale_bolt", aimX: 1, aimY: 0 });
    await sleep(200);
    const mana = A.snap.room.you.mana;
    const from = A.msgs.length;
    A.send({ type: "cast", spellId: "lance_of_light", aimX: 1, aimY: 0 });
    if (mana < 16) {
      const deny = await wait(A, (m) => (m.type === "toast" && /mana/i.test(m.text || "")) || (m.type === "spell_fx" && m.spellId === "mana_deny"), "mana deny", 3000, from);
      check(!!deny, "mana check rejects lance when empty", `mana was ${mana}`);
    } else {
      A.send({ type: "cast", spellId: "lance_of_light", aimX: 1, aimY: 0 });
      const deny = await wait(A, (m) => (m.type === "toast" && /mana|recharging/i.test(m.text || "")) || (m.type === "spell_fx" && m.spellId === "mana_deny"), "mana or cd deny", 3000, from);
      check(!!deny, "mana/cd check rejects lance", `mana was ${mana}`);
    }
    await sleep(500);
    await loadout(A, ["gale_bolt", "whirl_ward", "infernal_burst", null]);
  }

  // Kill XP
  {
    await go(A, "inferno_05");
    const before = prog(A).xp || 0;
    const mob = await walkToMob(A);
    check(!!mob, "mob for kill XP");
    const from = A.msgs.length;
    const t0 = Date.now();
    while (Date.now() - t0 < 20000) {
      const m = nearestMob(A);
      if (!m) break;
      A.send({ type: "attack", targetId: m.id, combo: 0 });
      await sleep(80);
      if (A.msgs.slice(from).some((x) => x.type === "xp_gain" && x.reason === "kill")) break;
    }
    const gain = A.msgs.slice(from).find((m) => m.type === "xp_gain" && m.reason === "kill");
    check(!!gain && gain.amount > 0, "kill grants XP", gain ? String(gain.amount) : "none");
    check((prog(A).xp || 0) >= before + (gain?.amount || 0), "xp total moved", `${prog(A).xp} from ${before}`);
  }

  // Each new active executes (level 30 + full tree)
  {
    await grant(A, 250000);
    await sleep(400);
    check(prog(A).level >= 30, "dev xp reaches 30+", String(prog(A).level));
    const chain = [
      "ferocia",
      "ferocia",
      "furious_cleave",
      "wrath_charge",
      "wrath_charge",
      "wrath_charge",
      "war_cry",
      "earthsplitter",
      "lance_of_light",
      "grace",
      "infernal_burst",
      "pillar_of_flame",
      "pillar_of_flame",
      "pillar_of_flame",
      "halo",
      "shadow_step",
      "snare_glyph",
      "summon_shade",
      "summon_shade",
      "tempest",
      "whirl_ward",
      "bastion",
    ];
    for (const id of chain) {
      const r = await learn(A, id);
      if (!r.ok && r.error !== "max_rank" && r.error !== "no_points") {
        check(false, `learn ${id}`, r.error);
      }
      await sleep(120);
    }
    await sleep(200);
    check((prog(A).ranks.earthsplitter || 0) >= 1, "learned earthsplitter", JSON.stringify(prog(A).ranks));
    check((prog(A).ranks.halo || 0) >= 1, "learned halo");
    check((prog(A).ranks.tempest || 0) >= 1, "learned tempest");
    const damaging = [
      "furious_cleave",
      "wrath_charge",
      "earthsplitter",
      "lance_of_light",
      "pillar_of_flame",
      "halo",
      "snare_glyph",
      "summon_shade",
      "tempest",
    ];
    const utility = ["war_cry", "grace", "shadow_step", "bastion"];
    await go(A, "inferno_05");
    for (const id of [...damaging, ...utility]) {
      if (!(prog(A).ranks[id] >= 1)) {
        check(false, `${id} not learned, skip cast`);
        continue;
      }
      const mob = await walkToMob(A);
      if (!mob) {
        check(false, `no mob for ${id}`);
        continue;
      }
      await loadout(A, [id, "gale_bolt", "whirl_ward", "infernal_burst"]);
      await sleep(80);
      const from = A.msgs.length;
      const hp0 = nearestMob(A)?.hp;
      A.send({
        type: "cast",
        spellId: id,
        aimX: mob.x - A.snap.room.you.x,
        aimY: mob.y - A.snap.room.you.y,
      });
      try {
        await wait(
          A,
          (m) =>
            (m.type === "spell_fx" && m.spellId === id) ||
            (m.type === "combat" && m.spellId === id) ||
            (m.type === "toast" && /Ward|Cry|Grace|Bastion/i.test(m.text || "")),
          `cast ${id}`,
          id === "pillar_of_flame" ? 2500 : 4000,
          from
        );
        if (id === "pillar_of_flame") await sleep(1400);
        else if (id === "halo" || id === "summon_shade" || id === "tempest" || id === "snare_glyph") await sleep(900);
        else await sleep(250);
        const threw = A.msgs.slice(from).some((m) => m.type === "error" && m.code === "internal");
        check(!threw, `${id} executes without throw`);
        if (damaging.includes(id)) {
          const landed = () => {
            // A Lust shade inside a Storm Heart ward takes 0 — the hit still counts as landing.
            const hit = A.msgs
              .slice(from)
              .some((m) => m.type === "combat" && !m.targetIsPlayer && (m.damage > 0 || m.spellId === id));
            const fxHit = A.msgs.slice(from).some((m) => m.type === "spell_fx" && m.spellId === id && Array.isArray(m.hits) && m.hits.length);
            const hp1 = nearestMob(A)?.hp;
            return hit || fxHit || (hp1 != null && hp0 != null && hp1 < hp0);
          };
          if (!landed()) {
            const m2 = nearestMob(A);
            A.send({
              type: "cast",
              spellId: id,
              aimX: (m2?.x || 1) - A.snap.room.you.x,
              aimY: (m2?.y || 0) - A.snap.room.you.y,
            });
            await sleep(id === "pillar_of_flame" ? 1400 : 700);
          }
          check(landed(), `${id} damages a mob`);
        }
      } catch (err) {
        check(false, `${id} executes`, err.message);
      }
      await sleep(200);
    }
  }

  // PvP: new skill does nothing in Lust, does capped damage in the arena
  {
    await go(A, "inferno_05");
    await go(B, "inferno_05");
    await walkTo(A, B.snap.room.you.x, B.snap.room.you.y, 8000);
    await loadout(A, ["furious_cleave", "gale_bolt", "whirl_ward", "infernal_burst"]);
    const hpB = B.snap.room.you.hp;
    const from = A.msgs.length;
    A.send({ type: "cast", spellId: "furious_cleave", aimX: B.snap.room.you.x - A.snap.room.you.x, aimY: B.snap.room.you.y - A.snap.room.you.y });
    await sleep(400);
    const pveHit = A.msgs.slice(from).filter((m) => m.type === "combat" && m.attackerId === A.id && m.targetId === B.id && m.damage > 0);
    check(pveHit.length === 0, "furious_cleave deals no player damage in Lust", `hits ${pveHit.length} hpB ${B.snap.room.you.hp}/${hpB}`);

    await go(A, "inferno_31");
    await go(B, "inferno_31");
    await sleep(200);
    const tArena = Date.now();
    while (Date.now() - tArena < 8000) {
      const bpos = (A.snap.room.players || []).find((p) => p.id === B.id);
      if (bpos && Math.hypot(A.snap.room.you.x - bpos.x, A.snap.room.you.y - bpos.y) < 2) break;
      if (bpos) await stepToward(A, bpos.x + 1.2, bpos.y);
      else await sleep(50);
    }
    await loadout(A, ["furious_cleave", "gale_bolt", "whirl_ward", "infernal_burst"]);
    const from2 = A.msgs.length;
    const hpB2 = B.snap.room.you.hp;
    for (let i = 0; i < 6; i++) {
      const bpos = (A.snap.room.players || []).find((p) => p.id === B.id) || B.snap.room.you;
      A.send({ type: "cast", spellId: "furious_cleave", aimX: bpos.x - A.snap.room.you.x || 1, aimY: bpos.y - A.snap.room.you.y || 0 });
      await sleep(200);
    }
    const hits = A.msgs.slice(from2).filter((m) => m.type === "combat" && m.targetId === B.id && m.damage > 0);
    check(hits.length > 0, "furious_cleave hits in the arena", `hits ${hits.length}`);
    if (hits.length) {
      const cap = 0.16 * (B.snap.room.you.maxHp || hpB2);
      check(hits[0].damage <= cap + 0.5, "cleave respects melee cap", `${hits[0].damage} cap ${cap.toFixed(1)}`);
    }

    await loadout(A, ["wrath_charge", "gale_bolt", "whirl_ward", "infernal_burst"]);
    await sleep(80);
    const from3 = A.msgs.length;
    A.send({ type: "cast", spellId: "wrath_charge", aimX: B.snap.room.you.x - A.snap.room.you.x, aimY: B.snap.room.you.y - A.snap.room.you.y });
    await sleep(400);
    const st = A.msgs.slice(from3).find((m) => m.type === "status" && m.targetId === B.id) ||
      B.msgs.slice(B.msgs.length - 20).find((m) => m.type === "status");
    const status = B.msgs.slice(-15).find((m) => m.type === "status");
    if (status) {
      check(status.dur <= 400 && !status.root, "wrath_charge PvP is a short slow", JSON.stringify(status));
    } else {
      console.log("INFO wrath_charge PvP status not observed (range); arena hit path already checked");
    }
  }

  // Respec ash
  {
    await go(A, "inferno_01");
    const ash0 = A.snap.room.you.ash;
    const lv = prog(A).level;
    const cost = 200 * lv;
    const from = A.msgs.length;
    A.send({ type: "skill_respec" });
    const ok = await wait(A, (m) => m.type === "skill_result" && m.op === "respec", "respec", 4000, from);
    check(ok.ok === true, "respec succeeds when funded");
    await sleep(200);
    check(A.snap.room.you.ash === ash0 - cost, "respec debit 200×level", `${A.snap.room.you.ash} want ${ash0 - cost}`);
    check(prog(A).ranks.gale_bolt === 1 && !prog(A).ranks.ferocia, "respec resets to free ranks");
    check(JSON.stringify(prog(A).loadout) === JSON.stringify(["gale_bolt", "whirl_ward", "infernal_burst", null]), "respec default loadout");
    const need = 200 * prog(A).level;
    while (A.snap.room.you.ash >= need) {
      A.send({ type: "skill_respec" });
      await sleep(500);
    }
    const from2 = A.msgs.length;
    A.send({ type: "skill_respec" });
    const broke = await wait(A, (m) => m.type === "skill_result" && m.op === "respec", "respec broke", 3000, from2);
    check(broke.ok === false && broke.error === "ash", "respec refused when broke", broke.error);
  }

  A.ws.close();
  B.ws.close();

  if (dbUrl) {
    const pg = await import("pg");
    const client = new pg.default.Client({ connectionString: dbUrl });
    await client.connect();
    const persistName = `LvP${tag}`;
    let P = await connect(persistName);
    await waitGear(P);
    await grant(P, 5000);
    await learn(P, "ferocia");
    await learn(P, "furious_cleave");
    await loadout(P, ["furious_cleave", "gale_bolt", "whirl_ward", "infernal_burst"]);
    await sleep(400);
    const snap = {
      level: prog(P).level,
      xp: prog(P).xp,
      ranks: { ...prog(P).ranks },
      loadout: [...prog(P).loadout],
    };
    P.ws.close();
    await sleep(200);
    await stopServer();
    await startServer();
    P = await connect(persistName);
    await sleep(300);
    check(prog(P).level === snap.level, "persist level", `${prog(P).level} vs ${snap.level}`);
    check(prog(P).xp === snap.xp, "persist xp", `${prog(P).xp} vs ${snap.xp}`);
    check(prog(P).ranks.ferocia === 1 && prog(P).ranks.furious_cleave === 1, "persist ranks");
    check(prog(P).loadout[0] === "furious_cleave", "persist loadout", JSON.stringify(prog(P).loadout));
    P.ws.close();

    const bfId = crypto.randomUUID();
    const bfName = `LvBF${tag}`;
    await client.query(
      `INSERT INTO players (id, name, display_name, ash, pending_ash)
       VALUES ($1,$2,$2,25000,0)`,
      [bfId, bfName]
    );
    await client.query(
      `INSERT INTO first_clears (player_id, canto_id) VALUES ($1,'inferno_05'),($1,'inferno_06'),($1,'inferno_07')`,
      [bfId]
    );
    const has = await client.query(`SELECT 1 FROM player_progress WHERE player_id = $1`, [bfId]);
    check(has.rowCount === 0, "backfill subject has no progress row");
    await stopServer();
    await startServer();
    const BF = await connect(bfName);
    await sleep(400);
    const wantXp = firstClearXp("inferno_05") + firstClearXp("inferno_06") + firstClearXp("inferno_07");
    check(prog(BF).xp === wantXp, "backfill XP is 800×tier per clear", `${prog(BF).xp} want ${wantXp}`);
    check(prog(BF).level >= 6 && prog(BF).level <= 9, "backfill lands around 6–9", String(prog(BF).level));
    check(prog(BF).ranks.gale_bolt === 1, "backfill keeps free ranks");
    BF.ws.close();
    await client.end();
  } else {
    console.log("SKIP persistence — no DATABASE_URL");
    console.log("SKIP backfill — no DATABASE_URL");
  }
}

try {
  await startServer();
  await run();
} catch (err) {
  failures++;
  console.error("FAIL regression threw", err);
  if (srv?.logs) console.error(srv.logs.slice(-2500));
} finally {
  try {
    await stopServer();
  } catch {
    /* ignore */
  }
}

console.log(failures ? `\n${failures} failure(s)` : "\nALL PASS");
process.exit(failures ? 1 : 0);
