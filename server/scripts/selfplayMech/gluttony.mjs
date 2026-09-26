/**
 * Self-play behaviour for Gluttony (see index.mjs for the hook contract).
 *
 * Both styles wade at the mire's pace (the server budgets it; stepping faster only
 * makes the bot's prediction drift and resync). Buried shades are not entities, so
 * they never enter foes() — they rise when the bot walks by, like for a player.
 * The skilled bot also steps around the bubbling mounds it can see, throws clods into
 * a gaping maw (Cerbero, the Triple Maw) and cuts down Fango crawling to feed the Maw.
 */
import { makeMire } from "../../src/cantoMech/gluttonyMire.mjs";
import { CANTOS } from "../../src/content.mjs";

const STEP = 0.4; // bot walk step per 50 ms (8 u/s)
const MOUND_KEEP = 4.4;
const CLOD_REACH = 10.5;
const BITE_KINDS = new Set(["maw_bite_l", "maw_bite_c", "maw_bite_r", "cerbero_bite"]);

/** GLUT_DEBUG=1: per-run breakdown of Gluttony damage by source, printed on leaving. */
const DEBUG = Boolean(process.env.GLUT_DEBUG);

function debugNote(bot, s, m) {
  const d = (s.dbg ||= { by: {}, n: {}, t0: Date.now(), done: false });
  const here = bot.snap?.cantoId === "inferno_06";
  if (m.type === "snapshot" && here && m.room?.cantoId !== "inferno_06" && !d.done) {
    d.done = true;
    const secs = Math.round((Date.now() - d.t0) / 1000);
    console.log(`[glut ${bot.name} ${bot.style}] ${secs}s dmg by source ${JSON.stringify(d.by)} events ${JSON.stringify(d.n)} clods ${s.clods} throws ${s.throws}`);
    return;
  }
  if (!here) {
    d.t0 = Date.now();
    return;
  }
  if (m.type === "combat" && m.targetIsPlayer && m.targetId === bot.snap?.you?.id && m.damage > 0) {
    const k = m.teleKind || "untelegraphed";
    d.by[k] = (d.by[k] || 0) + m.damage;
  } else if (m.type && m.type.startsWith("glut_")) {
    d.n[m.type] = (d.n[m.type] || 0) + 1;
  } else if (m.type === "toast" && /slain/i.test(m.text || "")) {
    d.n.deaths = (d.n.deaths || 0) + 1;
  }
}

const bots = new WeakMap();
function st(bot) {
  let s = bots.get(bot);
  if (!s) {
    // The static layout comes from the same content the server loads (the first
    // snapshot of a canto reaches the previous canto's hooks, so its one-off
    // mech.cw / mech.bm can't be relied on here); the live mound mask rides every one.
    const geo = CANTOS.inferno_06?.geo;
    const mounds = [];
    for (const p of CANTOS.inferno_06?.packs || []) {
      if (p.buried) for (const sp of p.spots || []) mounds.push(Number(sp[0]), Number(sp[1]));
    }
    s = { mire: makeMire(geo), mounds, bb: 0, carry: false, grabAt: 0, throwAt: 0, clods: 0, throws: 0 };
    bots.set(bot, s);
  }
  return s;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Unwoken mound nearest the segment you→goal that the walk would pass too close to. */
function blockingMound(s, you, goal) {
  const dx = goal.x - you.x;
  const dy = goal.y - you.y;
  const l2 = dx * dx + dy * dy || 1;
  let best = null;
  let bestT = Infinity;
  for (let i = 0, k = 0; i < s.mounds.length; i += 2, k++) {
    if (!(s.bb & (1 << k))) continue;
    const mx = s.mounds[i];
    const my = s.mounds[i + 1];
    // the goal itself sits by the mound (the cache): nothing to avoid
    if (Math.hypot(goal.x - mx, goal.y - my) < MOUND_KEEP) continue;
    const t = Math.max(0, Math.min(1, ((mx - you.x) * dx + (my - you.y) * dy) / l2));
    const px = you.x + dx * t;
    const py = you.y + dy * t;
    if (Math.hypot(mx - px, my - py) < MOUND_KEEP && t < bestT) {
      bestT = t;
      best = { x: mx, y: my, px, py };
    }
  }
  return best;
}

export default {
  onMsg(bot, m) {
    const s = st(bot);
    if (DEBUG) debugNote(bot, s, m);
    if (m.type === "snapshot") {
      const x = m.room && m.room.cantoId === "inferno_06" ? m.room.mech : null;
      if (!x) return;
      s.bb = Number(x.bb) || 0;
      s.carry = Boolean(x.c);
    }
  },

  steer(bot, you, goal) {
    const s = st(bot);
    let wx = goal.x;
    let wy = goal.y;
    if (bot.style === "skilled" && s.mounds.length) {
      const mb = blockingMound(s, you, goal);
      if (mb) {
        // step around it on the side the path already leans to
        let ox = mb.px - mb.x;
        let oy = mb.py - mb.y;
        let ol = Math.hypot(ox, oy);
        if (ol < 0.05) {
          ox = -(goal.y - you.y);
          oy = goal.x - you.x;
          ol = Math.hypot(ox, oy) || 1;
        }
        wx = mb.x + (ox / ol) * (MOUND_KEEP + 0.6);
        wy = mb.y + (oy / ol) * (MOUND_KEEP + 0.6);
      }
    }
    // wade at the mire's pace
    const mul = s.mire ? s.mire.mulAt(you.x, you.y) : 1;
    const d = Math.hypot(wx - you.x, wy - you.y);
    const max = STEP * mul;
    if (d > max && d > 1e-6) {
      wx = you.x + ((wx - you.x) / d) * max;
      wy = you.y + ((wy - you.y) / d) * max;
    }
    return { x: wx, y: wy };
  },

  async step(bot, you, now, target) {
    if (bot.style !== "skilled" || !bot.snap) return false;
    const s = st(bot);
    const ents = bot.snap.entities;
    // the biter in reach: the Maw or Cerbero
    let biter = null;
    let biterD = Infinity;
    for (const e of ents) {
      if (!(e.hp > 0)) continue;
      if (e.id !== "triple_maw" && !/^cerbero$/i.test(String(e.name || ""))) continue;
      const d = Math.hypot(e.x - you.x, e.y - you.y);
      if (d < biterD) {
        biterD = d;
        biter = e;
      }
    }
    // Carrying: throw into a gaping maw (a bite windup we can see); until one gapes,
    // hold the fistful instead of wasting it on the next swing (a few seconds at most)
    if (s.carry && biter && biterD <= CLOD_REACH && now - s.throwAt > 600) {
      for (const t of bot.telegraphs) {
        if (!BITE_KINDS.has(t.kind) || t.attackerId !== biter.id) continue;
        const age = now - t.at;
        if (age < 260 || age > t.durMs - 180) continue;
        s.throwAt = now;
        s.throws++;
        s.holdSince = 0;
        bot.send({ type: "attack", targetId: biter.id, combo: 0 });
        await sleep(50);
        return true;
      }
      if (!s.holdSince) s.holdSince = now;
      if (now - s.holdSince < 5000) {
        // keep just outside its jaws while waiting for them to open
        const want = biter.id === "triple_maw" ? 7.2 : 5.2;
        if (Math.abs(biterD - want) > 0.8) {
          const dir = biterD > want ? 1 : -1;
          const k = (Math.min(Math.abs(biterD - want), STEP * (s.mire ? s.mire.mulAt(you.x, you.y) : 1)) * dir) / (biterD || 1);
          bot.moveTo(you.x + (biter.x - you.x) * k, you.y + (biter.y - you.y) * k);
        }
        await sleep(50);
        return true;
      }
    } else if (!s.carry) {
      s.holdSince = 0;
    }
    // Fango crawling to the Maw: cut it down first
    let fango = null;
    let fd = Infinity;
    for (const e of ents) {
      if (e.name !== "Fango" || !(e.hp > 0)) continue;
      const d = Math.hypot(e.x - you.x, e.y - you.y);
      if (d < fd) {
        fd = d;
        fango = e;
      }
    }
    if (fango && fd < 11 && target?.id !== fango.id) {
      if (fd > 2.8) {
        const k = Math.min(fd - 2.4, STEP * (s.mire ? s.mire.mulAt(you.x, you.y) : 1)) / fd;
        bot.moveTo(you.x + (fango.x - you.x) * k, you.y + (fango.y - you.y) * k);
      } else if (!bot._atkAt || now - bot._atkAt > 450) {
        bot._combo = bot._atkAt && now - bot._atkAt < 800 ? ((bot._combo || 0) + 1) % 3 : 0;
        bot._atkAt = now;
        bot.send({ type: "attack", targetId: fango.id, combo: bot._combo });
      }
      await sleep(50);
      return true;
    }
    // Empty-handed by a biter: scoop a clod when one lies close
    if (!s.carry && biter && biterD < 12 && now - s.grabAt > 1500 && you.hp > you.maxHp * 0.35) {
      let clod = null;
      let cd = Infinity;
      for (const e of ents) {
        if (e.kind !== "poi" || e.poiKind !== "clod") continue;
        const d = Math.hypot(e.x - you.x, e.y - you.y);
        if (d < cd) {
          cd = d;
          clod = e;
        }
      }
      if (clod && cd < 8) {
        if (cd > 3.6) {
          const k = Math.min(cd - 3.2, STEP * (s.mire ? s.mire.mulAt(you.x, you.y) : 1)) / cd;
          bot.moveTo(you.x + (clod.x - you.x) * k, you.y + (clod.y - you.y) * k);
        } else {
          s.grabAt = now;
          s.clods++;
          bot.send({ type: "interact", targetId: clod.id });
        }
        await sleep(50);
        return true;
      }
    }
    return false;
  },
};

