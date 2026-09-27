/**
 * Self-play behaviour for Avarice (see index.mjs for the hook contract).
 *
 * The procession clock rides every snapshot (room.mech.t). The bot sees the weights as a
 * pilgrim does, not as an oracle: where they were its reaction time ago (--react, like
 * the telegraph dodge), rolling on at the speed they had then — a human extrapolates, and
 * the drums speed up into each clash (the server's own geometry gives what it saw:
 * src/cantoMech/avariceProcession.mjs). The clash beats are exact (telegraphed 1.2 s
 * ahead, a fixed rhythm the objective line counts down).
 *  - skilled: waits for a weight to pass before crossing a lane and waits out a clash
 *    before crossing a clash point (lookahead ~1 s); in a fight it steps out of a lane
 *    when it sees a weight bearing down on it; it cuts down Fiorini streaming to Plutus
 *    and rings the Ledger Bell when Plutus is swollen with coin.
 *  - naive: none of it — walks straight through the lanes and never rings the bell for
 *    Plutus (a new phone player).
 */
import { PROC, weightsAt, untilClash } from "../../src/cantoMech/avariceProcession.mjs";

const args = process.argv.slice(2);
const argv = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const REACT = Number(argv("react", "220")) / 1000;
const MOVE = 8;
const STEP_S = 0.05;
/** Weight footprint (matches the server) + a safety pad. */
const HALF_L = PROC.R;
const HALF_W = 0.72;
const PAD = 0.75;
const ws = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function procT(bot, nowMs = Date.now()) {
  return bot._avaOff == null ? null : nowMs / 1000 + bot._avaOff;
}

/** Weights as last seen: `seenT` (procession time) is when the bot saw them. */
let seenT = NaN;

/** What the bot saw at procession time `now` − REACT (cached per sighting). */
function sight(now) {
  const t0 = now - REACT;
  if (Math.abs(t0 - seenT) > 0.02) {
    weightsAt(t0, ws);
    seenT = t0;
  }
  return t0;
}

/**
 * Will (x,y) be under a rolling weight at procession time t, as the bot judges it at
 * `now`: each weight where it was seen, rolling on straight at the speed it had then.
 */
function crushedAt(now, t, x, y, pad = PAD) {
  const t0 = sight(now);
  const lead = t - t0;
  for (const w of ws) {
    if (w.speed < 1.5) continue;
    const dx = x - (w.x + w.vx * lead);
    const dy = y - (w.y + w.vy * lead);
    const along = dx * w.tx + dy * w.ty;
    if (Math.abs(along) > HALF_L + pad) continue;
    const across = -dx * w.ty + dy * w.tx;
    if (Math.abs(across) <= HALF_W + pad) return w;
  }
  return null;
}

/** Every clash spills coin a beat later over a wider ring (server SPILL_*). */
const SPILL_R = PROC.CLASH_R + 2.6;
const SPILL_LAG = 0.45;

/** Inside a clash zone that lands within `soon` seconds (or its spill still to land)? */
function clashSoon(t, x, y, soon, pad = 0.6) {
  for (const side of [0, 1]) {
    const c = side === 0 ? PROC.W : PROC.E;
    const d = Math.hypot(x - c.x, y - c.y);
    const left = untilClash(t, side);
    if (d <= PROC.CLASH_R + pad && left < soon) return true;
    if (d <= SPILL_R + pad && (left < soon + SPILL_LAG || PROC.T - left < SPILL_LAG)) return true;
  }
  return false;
}

/** Safe to stand at (x,y) from t0 to t0+h (as the bot judges it now, at t0)? */
function safe(t0, x, y, h, from = 0) {
  for (let dt = from; dt <= h; dt += 0.1) {
    if (crushedAt(t0, t0 + dt, x, y)) return false;
  }
  return !clashSoon(t0, x, y, h + 0.3);
}

/** A step out of danger: 12 directions, 1.6 units, first safe one closest to `pref`. */
function escape(t, you, pref, h) {
  let best = null;
  let bestScore = Infinity;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    for (const r of [1.6, 3.0]) {
      const x = you.x + Math.cos(a) * r;
      const y = you.y + Math.sin(a) * r;
      if (!safe(t, x, y, h, r / MOVE)) continue;
      const score = r * 2 + (pref ? Math.hypot(pref.x - x, pref.y - y) * 0.3 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = { x, y };
      }
    }
  }
  return best;
}

function stepToward(bot, you, p) {
  const d = Math.hypot(p.x - you.x, p.y - you.y) || 1e-6;
  const s = Math.min(d, MOVE * STEP_S);
  bot.moveTo(you.x + ((p.x - you.x) / d) * s, you.y + ((p.y - you.y) / d) * s);
}

export default {
  onMsg(bot, m) {
    // (AVA_DEBUG=1: per-source damage report when the bot leaves Avarice)
    if (process.env.AVA_DEBUG) {
      if (bot._avaHitLog === undefined && m.type === "snapshot" && m.room?.cantoId === "inferno_07") bot._avaHitLog = {};
      const me = bot.snap?.you?.id;
      if (m.type === "combat" && m.targetIsPlayer && m.targetId === me && m.damage > 0) {
        const k = m.teleKind || (String(m.attackerId || "").startsWith("mob") ? "mob-other" : String(m.attackerId));
        const h = (bot._avaHitLog ||= {});
        h[k] = (h[k] || 0) + m.damage;
        if (k === "ava_roll" || k === "ava_clash" || k === "ava_spill") {
          const y = bot.you;
          const mode = Date.now() - (bot._avaStepAt || 0) < 150 ? "fight" : Date.now() - (bot._avaSteerAt || 0) < 150 ? "walk" : "other";
          console.log(`[ava ${bot.name}] ${k} ${m.damage} at ${y.x.toFixed(1)},${y.y.toFixed(1)} ${mode} dodges=${bot.stats?.[bot.cur]?.dodges}`);
        }
      }
      if (m.type === "telegraph" && bot.snap?.cantoId === "inferno_07") {
        const k = (bot._avaTele ||= {});
        k[m.kind] = (k[m.kind] || 0) + 1;
      }
      if (m.type === "snapshot" && m.room?.cantoId === "inferno_07") {
        const p = m.room.entities.find((e) => e.id === "hoard_crush");
        const y = m.room.you;
        const now = Date.now();
        if (p && y && (!bot._avaStatAt || now - bot._avaStatAt > 15000)) {
          bot._avaStatAt = now;
          console.log(`[ava ${bot.name}] t+${bot._avaT0 ? Math.round((now - bot._avaT0) / 1000) : 0}s you ${y.x.toFixed(0)},${y.y.toFixed(0)} hp ${y.hp} · Plutus ${Math.round(p.hp)} @${p.x.toFixed(0)},${p.y.toFixed(0)} inf ${m.room.mech?.inf || 0} foes ${m.room.entities.filter((e) => e.kind === "mob").length}`);
        }
        if (!bot._avaT0) bot._avaT0 = now;
        if (p && y && Math.hypot(p.x - y.x, p.y - y.y) < 16) {
          if (!bot._avaBossAt) bot._avaBossAt = now;
          bot._avaBossEnd = now;
          bot._avaInfMax = Math.max(bot._avaInfMax || 0, m.room.mech?.inf || 0);
          bot._avaInfSum = (bot._avaInfSum || 0) + (m.room.mech?.inf || 0);
          bot._avaInfN = (bot._avaInfN || 0) + 1;
        }
      }
      if (m.type === "snapshot" && m.room?.cantoId !== "inferno_07" && bot._avaHitLog !== undefined && !bot._avaPrinted) {
        bot._avaPrinted = true;
        const fight = bot._avaBossAt ? ((bot._avaBossEnd - bot._avaBossAt) / 1000).toFixed(1) : "-";
        console.log(`[ava ${bot.name} ${bot.style}] dmg by source ${JSON.stringify(bot._avaHitLog)} bells=${bot._avaBells || 0} bossFight=${fight}s infMax=${bot._avaInfMax || 0} infAvg=${((bot._avaInfSum || 0) / (bot._avaInfN || 1)).toFixed(2)} teles=${JSON.stringify(bot._avaTele || {})}`);
      }
    }
    if (m.type === "snapshot" && m.room?.cantoId === "inferno_07" && m.room.mech && typeof m.room.mech.t === "number") {
      const off = m.room.mech.t - Date.now() / 1000;
      if (bot._avaOff == null) bot._avaOff = off;
      else {
        let d = (off - bot._avaOff) % PROC.T;
        if (d > PROC.T / 2) d -= PROC.T;
        if (d < -PROC.T / 2) d += PROC.T;
        bot._avaOff += Math.abs(d) > 0.3 ? d : d * 0.2;
      }
      bot._avaMech = m.room.mech;
    }
  },

  /** Walking: wait for a weight to pass, never step into a clash that is about to land. */
  steer(bot, you, goal) {
    if (process.env.AVA_DEBUG) bot._avaSteerAt = Date.now();
    if (bot.style !== "skilled") return goal;
    const t = procT(bot);
    if (t == null) return goal;
    const d = Math.hypot(goal.x - you.x, goal.y - you.y) || 1e-6;
    const ux = (goal.x - you.x) / d;
    const uy = (goal.y - you.y) / d;
    // our path over the next second
    let blocked = false;
    for (let dt = 0.1; dt <= 1.0; dt += 0.1) {
      const r = Math.min(d, MOVE * dt);
      const x = you.x + ux * r;
      const y = you.y + uy * r;
      if (crushedAt(t, t + dt, x, y) || clashSoon(t + dt, x, y, 0.5)) {
        blocked = true;
        break;
      }
    }
    if (!blocked) return goal;
    // waiting here is fine? then wait
    if (safe(t, you.x, you.y, 1.0)) return { x: you.x, y: you.y };
    return escape(t, you, goal, 1.0) || goal;
  },

  /**
   * In a fight: dodge a weight bearing down on us (seen after the reaction time), cut
   * down Fiorini, ring the bell on a swollen Plutus.
   */
  async step(bot, you, now, target) {
    if (process.env.AVA_DEBUG) bot._avaStepAt = Date.now();
    if (bot.style !== "skilled") return false;
    const t = procT(bot, now);
    if (t != null) {
      // a weight bearing down on us (seen REACT ago): is our spot hit in the next beat?
      let danger = false;
      for (let dt = 0; dt <= 0.55; dt += 0.1) {
        if (crushedAt(t, t + dt, you.x, you.y, 0.45)) {
          danger = true;
          break;
        }
      }
      if (danger) {
        const out = escape(t, you, target, 0.9);
        if (out) {
          stepToward(bot, you, out);
          bot.stats[bot.cur].dodges++;
          await sleep(50);
          return true;
        }
      }
    }
    const foes = bot.foes();
    const plutus = foes.find((e) => e.id === "hoard_crush");
    const bell = bot.poi("bell");
    const mech = bot._avaMech || {};
    // Plutus swollen with coin: ring the bell near him
    if (plutus && bell && (mech.inf || 0) >= 2 && !(mech.col > 0) && (bot.snap.you.bellCd || 0) <= 0) {
      // (the server breaks him within 15 of the bell; it rings from 6 away)
      if (Math.hypot(plutus.x - bell.x, plutus.y - bell.y) < 14.8 && Math.hypot(plutus.x - you.x, plutus.y - you.y) < 20) {
        const db = Math.hypot(bell.x - you.x, bell.y - you.y);
        if (db > 5.2) {
          stepToward(bot, you, bell);
        } else {
          bot.send({ type: "interact", targetId: bell.id });
          bot._avaBells = (bot._avaBells || 0) + 1;
        }
        await sleep(50);
        return true;
      }
    }
    // Fiorini streaming to him: cut them down first
    const coin = foes
      .filter((e) => e.packId === "ava_plutus_coins")
      .sort((a, b) => Math.hypot(a.x - you.x, a.y - you.y) - Math.hypot(b.x - you.x, b.y - you.y))[0];
    if (coin && Math.hypot(coin.x - you.x, coin.y - you.y) < 7) {
      const d = Math.hypot(coin.x - you.x, coin.y - you.y);
      if (d > 2.6) stepToward(bot, you, coin);
      else if (!bot._atkAt || now - bot._atkAt > 450) {
        bot._combo = bot._atkAt && now - bot._atkAt < 800 ? ((bot._combo || 0) + 1) % 3 : 0;
        bot._atkAt = now;
        bot.send({ type: "attack", targetId: coin.id, combo: bot._combo });
      }
      await sleep(50);
      return true;
    }
    return false;
  },
};
