/**
 * Self-play behaviour for Lust (see index.mjs for the hook contract).
 *
 * The bot plays the storm like the client does: while a gust blows and it stands out
 * of every windbreak's lee, its predicted position drifts downwind (the client's
 * moveFeel drift), and it walks around the rock islands instead of into them (the
 * straight-line walker would grind against a windbreak forever). Skilled bots also
 * cut the lovers' bond with a dash when one stands in reach.
 */
import { PLAYER_DRIFT, gustEnvelope, inLee, segBlocked, segsCross } from "../../src/cantoMech/lustGeo.mjs";

const STEP = (8 * 50) / 1000;

function st(bot) {
  if (!bot._lust) bot._lust = { phase: "calm", startAt: 0, endAt: 0, wx: 1, wy: 0, power: 1, wb: null, lov: null, lastAt: 0 };
  return bot._lust;
}

function take(L, m, now) {
  if (m.phase && m.phase !== L.phase) {
    L.phase = m.phase;
    L.startAt = now;
  }
  const left = Number(m.left);
  if (Number.isFinite(left)) L.endAt = now + left;
  if (Number.isFinite(Number(m.dirX))) {
    L.wx = Number(m.dirX);
    L.wy = Number(m.dirY);
  }
  L.power = m.judged ? 1.35 : 1;
  if (Array.isArray(m.wb) && m.wb.length >= 3) {
    const wb = [];
    for (let i = 0; i + 2 < m.wb.length; i += 3) wb.push({ x: m.wb[i], y: m.wb[i + 1], r: m.wb[i + 2] });
    L.wb = wb;
  }
  if ("lov" in m) L.lov = m.lov || null;
}

function strength(L, now) {
  if (L.phase !== "gust") return 0;
  return gustEnvelope((now - L.startAt) / 1000, (L.endAt - now) / 1000, L.power);
}

/** The client's drift: the gust carries our predicted position (mutates you + bot.me). */
function drift(bot, you, now) {
  const L = st(bot);
  // (catches up after ticks the generic dodge spent: the gust never paused)
  const dt = Math.min(0.3, Math.max(0, (now - (L.lastAt || now)) / 1000));
  L.lastAt = now;
  const s = strength(L, now);
  if (s <= 0.02 || dt <= 0) return false;
  if (inLee(L.wb, L.wx, L.wy, you.x, you.y)) return false;
  const k = PLAYER_DRIFT * s * dt;
  you.x += L.wx * k;
  you.y += L.wy * k;
  if (bot.me) {
    bot.me.x = you.x;
    bot.me.y = you.y;
  }
  return true;
}

/** A waypoint around the first windbreak between `you` and `goal` (or null). */
function detour(L, you, goal, pad) {
  const w = segBlocked(L.wb, you.x, you.y, goal.x, goal.y, pad);
  if (!w) return null;
  // the goal itself hugs this rock: just walk at it (push-out slides us along)
  if (Math.hypot(goal.x - w.x, goal.y - w.y) < w.r + pad + 0.4) return null;
  const dx = goal.x - you.x;
  const dy = goal.y - you.y;
  const l2 = dx * dx + dy * dy || 1e-9;
  const t = ((w.x - you.x) * dx + (w.y - you.y) * dy) / l2;
  const cx = you.x + dx * t;
  const cy = you.y + dy * t;
  let ox = cx - w.x;
  let oy = cy - w.y;
  let ol = Math.hypot(ox, oy);
  if (ol < 1e-3) {
    // dead centre: go round the side that turns least
    const l = Math.sqrt(l2);
    ox = -dy / l;
    oy = dx / l;
    ol = 1;
  }
  const R = w.r + pad + 1.1;
  return { x: w.x + (ox / ol) * R, y: w.y + (oy / ol) * R };
}

/** LUST_BOT_DEBUG=1: tally the damage the bot takes in Lust by source (tuning aid). */
const DEBUG = Boolean(process.env.LUST_BOT_DEBUG);

function tally(bot, m) {
  if (m.type === "entity_removed" && bot.snap) {
    const L = st(bot);
    const e = bot.snap.entities.find((x) => x.id === m.id);
    if (e && (e.kind === "mob" || e.kind === "boss")) {
      L.t0 = L.t0 || Date.now();
      (L.kills = L.kills || []).push(`${((Date.now() - (bot.stats?.inferno_05?.t0 || L.t0)) / 1000).toFixed(0)}s:${e.name || e.archetype}`);
    }
  }
  if (!(m.type === "combat" && m.targetIsPlayer && bot.snap && m.targetId === bot.snap.you?.id && m.damage > 0)) return;
  const L = st(bot);
  const src = String(m.attackerId || "");
  const e = bot.snap.entities.find((x) => x.id === src);
  const who = e ? (e.kind === "boss" ? "minos" : e.packId === "lust_champion_pair" ? "lovers" : e.archetype || e.kind) : src.startsWith("mech") ? src : "?";
  const k = `${who}:${m.teleKind || "-"}`;
  L.dmg = L.dmg || {};
  L.dmg[k] = (L.dmg[k] || 0) + m.damage;
}

export default {
  onMsg(bot, m) {
    const now = Date.now();
    if (DEBUG && bot._lust) tally(bot, m);
    if (m.type === "snapshot") {
      if (m.room?.cantoId !== "inferno_05") {
        if (DEBUG && bot._lust?.dmg) console.log(`[lust dmg ${bot.style}]`, JSON.stringify(bot._lust.dmg));
        if (DEBUG && bot._lust?.kills) console.log(`[lust kills ${bot.style}]`, bot._lust.kills.join(" "));
        bot._lust = null;
        return;
      }
      if (m.room.mech) take(st(bot), m.room.mech, now);
    } else if (m.type === "lust_storm") {
      take(st(bot), m, now);
    } else if (m.type === "lust_tether" && bot._lust) {
      const L = bot._lust;
      if (L.lov) L.lov = [L.lov[0], L.lov[1], m.state === "bind" ? 1 : m.state === "cut" ? 2 : 0];
    }
  },

  steer(bot, you, goal) {
    const L = st(bot);
    drift(bot, you, Date.now());
    if (!L.wb) return goal;
    return detour(L, you, goal, 0.9) || goal;
  },

  async step(bot, you, now, target) {
    const L = st(bot);
    if (drift(bot, you, now)) bot.send({ type: "move", x: you.x, y: you.y });
    if (!target || !L.wb) return false;
    // A player in a Minos fight stays on him: his judging gust throws you back, and the
    // generic "boss > 12 away → nearest pack" rule would walk off and let him heal
    const minos = bot.snap.entities.find((e) => e.id === "minos_gate");
    if (minos && target.id !== minos.id && minos.hp < minos.maxHp) {
      const dm = Math.hypot(minos.x - you.x, minos.y - you.y);
      const dt = Math.hypot(target.x - you.x, target.y - you.y);
      if (dm < 22 && dt > 14) {
        const wp = detour(L, you, minos, 0.6) || minos;
        const wd = Math.hypot(wp.x - you.x, wp.y - you.y) || 1e-6;
        const k = Math.min(wd, STEP);
        bot.moveTo(you.x + ((wp.x - you.x) / wd) * k, you.y + ((wp.y - you.y) / wd) * k);
        await new Promise((r) => setTimeout(r, 50));
        return true;
      }
    }
    const d = Math.hypot(target.x - you.x, target.y - you.y);
    // A rock between us and the foe: walk round it
    if (d > 2.4) {
      const wp = detour(L, you, target, 0.6);
      if (wp) {
        const wd = Math.hypot(wp.x - you.x, wp.y - you.y) || 1e-6;
        const k = Math.min(wd, STEP);
        bot.moveTo(you.x + ((wp.x - you.x) / wd) * k, you.y + ((wp.y - you.y) / wd) * k);
        await new Promise((r) => setTimeout(r, 50));
        return true;
      }
    }
    // Skilled: cut the lovers' bond with a dash through it
    if (bot.style === "skilled" && L.lov && L.lov[2] === 1 && (!bot._dashAt || now - bot._dashAt > 4300)) {
      const a = bot.snap.entities.find((e) => e.id === L.lov[0]);
      const b = bot.snap.entities.find((e) => e.id === L.lov[1]);
      if (a && b && (target.id === a.id || target.id === b.id)) {
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        const md = Math.hypot(mx - you.x, my - you.y);
        if (md > 0.6 && md < 4.2) {
          const ux = (mx - you.x) / md;
          const uy = (my - you.y) / md;
          if (segsCross(you.x, you.y, you.x + ux * 5.5, you.y + uy * 5.5, a.x, a.y, b.x, b.y)) {
            bot._dashAt = now;
            if (bot.cur && bot.stats[bot.cur]) bot.stats[bot.cur].dashes++;
            bot.send({ type: "dash", x: ux, y: uy });
            if (bot.me) {
              bot.me.x += ux * 5.5;
              bot.me.y += uy * 5.5;
            }
            await new Promise((r) => setTimeout(r, 50));
            return true;
          }
        }
      }
    }
    return false;
  },
};
