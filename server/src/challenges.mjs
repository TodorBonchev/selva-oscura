/**
 * Daily challenge (arena or circles) + weekly boss race. Cosmetic rewards only (titles and a
 * nameplate flair) — nothing here grants stats, Ash or items.
 *
 *   Daily (UTC day): one task (arena or PvE) picked from DAILY_POOL by the date.
 *   Weekly (ISO week, UTC Monday 00:00): defeat this week's boss (rotates through the
 *   canto bosses). Finishers are ranked by time; the first three earn a podium.
 *
 * Persistence: migrations/007_challenges.sql. Memory mode keeps everything in RAM.
 * Hooks (called by pvp.mjs / room.mjs) never throw into the caller.
 */
import { dbEnabled, query } from "./db.mjs";
import { players } from "./ledger.mjs";

export const DAILY_POOL = [
  { id: "d:arena_kills", text: "Take 5 kills in the Pozzo dei Giganti", goal: 5, ev: "arena_kill" },
  { id: "d:arena_streak", text: "Reach a 3-kill streak in the Pozzo dei Giganti", goal: 3, ev: "arena_streak" },
  { id: "d:round_win", text: "Win an arena round (most kills when it ends)", goal: 1, ev: "round_win" },
  { id: "d:duel_win", text: "Win 2 duels (challenge with G, or the ranked queue)", goal: 2, ev: "duel_win" },
  { id: "d:arena_kills8", text: "Take 8 kills in the Pozzo dei Giganti", goal: 8, ev: "arena_kill" },
  // PvE days, so a pilgrim who never enters the pit still has a daily
  { id: "d:mob_kills", text: "Slay 40 foes in the circles of the Inferno", goal: 40, ev: "mob_kill" },
  { id: "d:heart_break", text: "Break 2 ward hearts (Storm, Mire, Hoard or Rage Heart)", goal: 2, ev: "heart_break" },
];

const HEARTS = new Set(["storm_heart", "mire_heart", "hoard_heart", "rage_heart"]);

export const WEEKLY_BOSSES = [
  { canto: "inferno_05", bossId: "minos_gate", name: "Minos", title: "title:judge_breaker" },
  { canto: "inferno_06", bossId: "triple_maw", name: "the Triple Maw", title: "title:maw_breaker" },
  { canto: "inferno_07", bossId: "hoard_crush", name: "Plutus", title: "title:plutus_breaker" },
  { canto: "inferno_08", bossId: "argenti_fury", name: "Filippo Argenti", title: "title:argenti_bane" },
];

/** Every unlockable. kind "title" shows under the name; "flair" is a nameplate mark. */
export const COSMETICS = [
  { id: "title:pit_regular", kind: "title", label: "Pit Regular", desc: "Complete a daily arena challenge" },
  { id: "title:pit_veteran", kind: "title", label: "Pit Veteran", desc: "Complete 7 daily arena challenges" },
  { id: "title:judge_breaker", kind: "title", label: "Judge-Breaker", desc: "Defeat Minos in his weekly race" },
  { id: "title:maw_breaker", kind: "title", label: "Maw-Breaker", desc: "Defeat the Triple Maw in its weekly race" },
  { id: "title:plutus_breaker", kind: "title", label: "Plutus-Breaker", desc: "Defeat Plutus in his weekly race" },
  { id: "title:argenti_bane", kind: "title", label: "Argenti's Bane", desc: "Defeat Filippo Argenti in his weekly race" },
  { id: "title:weekly_victor", kind: "title", label: "Weekly Victor", desc: "Finish a weekly race in the top 3" },
  { id: "flair:laurel", kind: "flair", label: "Gold Laurel", desc: "Finish a weekly race in the top 3" },
  { id: "flair:ember", kind: "flair", label: "Ember Mark", desc: "Finish 3 weekly races" },
];
const COSMETIC_BY_ID = new Map(COSMETICS.map((c) => [c.id, c]));
const PODIUM = 3;

/** key `${pid}|${period}|${cid}` → { progress, done } */
const prog = new Map();
/** week → [{ id, name, at }] sorted by at */
const race = new Map();
/** pid → Set(cosmeticId) */
const owned = new Map();
/** pid → { title, flair } */
const worn = new Map();
/** pid → { dailies, weeklies } (lifetime completions) */
const totals = new Map();

function safe(label, fn) {
  try {
    return fn();
  } catch (err) {
    console.error(`[chal] ${label}`, err?.message || err);
    return undefined;
  }
}

function persist(label, sql, params) {
  if (!dbEnabled()) return;
  query(sql, params).catch((err) => console.error(`[chal] persist ${label}`, err.message));
}

/** Clock (tests may pin it with _setClock). */
let clock = () => Date.now();
export function _setClock(fn) {
  clock = typeof fn === "function" ? fn : () => Date.now();
}
/** Test helper: forget all RAM state. */
export function _challengesReset() {
  prog.clear();
  race.clear();
  owned.clear();
  worn.clear();
  totals.clear();
  prunedFor = "";
}

export function dayKey(now = clock()) {
  return new Date(now).toISOString().slice(0, 10);
}

/** ISO-8601 week key, e.g. "2026-W41" (UTC). */
export function weekKey(now = clock()) {
  const d = new Date(now);
  const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const day = new Date(t).getUTCDay() || 7;
  const thu = new Date(t + (4 - day) * 86400000);
  const y = thu.getUTCFullYear();
  const wk = Math.ceil(((thu.getTime() - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7);
  return `${y}-W${String(wk).padStart(2, "0")}`;
}

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function dailyChallenge(day = dayKey()) {
  return DAILY_POOL[hashStr(day) % DAILY_POOL.length];
}

export function weeklyBoss(week = weekKey()) {
  const n = Number(String(week).split("-W")[1]) || 0;
  return WEEKLY_BOSSES[n % WEEKLY_BOSSES.length];
}

function msToNextDay(now = clock()) {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) - now;
}

function msToNextWeek(now = clock()) {
  const d = new Date(now);
  const day = d.getUTCDay() || 7;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + (8 - day)) - now;
}

function nameOf(id) {
  return players.get(id)?.name || "Wanderer";
}

function ownedSet(id) {
  let s = owned.get(id);
  if (!s) {
    s = new Set();
    owned.set(id, s);
  }
  return s;
}

function totalsOf(id) {
  let t = totals.get(id);
  if (!t) {
    t = { dailies: 0, weeklies: 0 };
    totals.set(id, t);
  }
  return t;
}

function unlock(room, playerId, cosmeticId) {
  const c = COSMETIC_BY_ID.get(cosmeticId);
  if (!c) return false;
  const s = ownedSet(playerId);
  if (s.has(cosmeticId)) return false;
  s.add(cosmeticId);
  persist(
    "cosmetic",
    `INSERT INTO player_cosmetics (player_id, cosmetic_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
    [playerId, cosmeticId]
  );
  // First title / flair of its kind is worn straight away (the player can change it)
  const w = worn.get(playerId) || { title: null, flair: null };
  if (c.kind === "title" && !w.title) w.title = cosmeticId;
  if (c.kind === "flair" && !w.flair) w.flair = cosmeticId;
  worn.set(playerId, w);
  writeWorn(playerId);
  const sess = room?.sessions?.get(playerId);
  if (sess) {
    try {
      room.toast(sess.ws, "loot", `${c.kind === "title" ? "Title" : "Nameplate flair"} unlocked: ${c.label}`);
    } catch {
      /* closing */
    }
  }
  room?.markDirty?.();
  return true;
}

function writeWorn(playerId) {
  const w = worn.get(playerId) || { title: null, flair: null };
  persist(
    "flair",
    `INSERT INTO player_flair (player_id, title, flair, updated_at) VALUES ($1,$2,$3,NOW())
     ON CONFLICT (player_id) DO UPDATE SET title = EXCLUDED.title, flair = EXCLUDED.flair, updated_at = NOW()`,
    [playerId, w.title, w.flair]
  );
}

function rowOf(playerId, period, cid) {
  const k = `${playerId}|${period}|${cid}`;
  let r = prog.get(k);
  if (!r) {
    r = { progress: 0, done: false };
    prog.set(k, r);
  }
  return r;
}

function writeRow(playerId, period, cid, r) {
  persist(
    "progress",
    `INSERT INTO challenge_progress (player_id, period_key, challenge_id, progress, done_at, updated_at)
     VALUES ($1,$2,$3,$4, CASE WHEN $5 THEN NOW() ELSE NULL END, NOW())
     ON CONFLICT (player_id, period_key, challenge_id) DO UPDATE SET
       progress = GREATEST(challenge_progress.progress, EXCLUDED.progress),
       done_at = COALESCE(challenge_progress.done_at, EXCLUDED.done_at),
       updated_at = NOW()`,
    [playerId, period, cid, r.progress, r.done]
  );
}

function pushPanel(room, playerId) {
  const sess = room?.sessions?.get(playerId);
  if (!sess) return;
  try {
    room.send(sess.ws, { type: "challenges", ...challengesPayload(playerId) });
  } catch {
    /* closing */
  }
}

/** Drop progress rows from past days/weeks (RAM only; the DB keeps history). */
let prunedFor = "";
function pruneOld(day, week) {
  const tag = `${day}|${week}`;
  if (prunedFor === tag) return;
  prunedFor = tag;
  for (const k of prog.keys()) {
    const period = k.split("|")[1];
    if (period !== day && period !== week) prog.delete(k);
  }
  for (const wk of race.keys()) if (wk !== week) race.delete(wk);
}

/** Advance today's daily for `ev`. mode "add" adds n, "max" keeps the best n. */
function dailyEvent(room, playerId, ev, n, mode = "add") {
  if (!playerId) return;
  const day = dayKey();
  pruneOld(day, weekKey());
  const ch = dailyChallenge(day);
  if (ch.ev !== ev) return;
  const r = rowOf(playerId, day, ch.id);
  if (r.done) return;
  const next = mode === "max" ? Math.max(r.progress, n) : r.progress + n;
  if (next === r.progress) return;
  r.progress = Math.min(ch.goal, next);
  if (r.progress >= ch.goal) {
    r.done = true;
    const t = totalsOf(playerId);
    t.dailies += 1;
    const sess = room?.sessions?.get(playerId);
    if (sess) {
      try {
        room.toast(sess.ws, "emit", `Daily challenge complete: ${ch.text}`);
      } catch {
        /* closing */
      }
    }
    unlock(room, playerId, "title:pit_regular");
    if (t.dailies >= 7) unlock(room, playerId, "title:pit_veteran");
  }
  writeRow(playerId, day, ch.id, r);
  pushPanel(room, playerId);
}

export function challengesOnArenaKill(room, killerId, streak) {
  safe("arenaKill", () => {
    dailyEvent(room, killerId, "arena_kill", 1);
    dailyEvent(room, killerId, "arena_streak", Number(streak) || 0, "max");
  });
}

export function challengesOnRoundWin(room, playerId) {
  safe("roundWin", () => dailyEvent(room, playerId, "round_win", 1));
}

export function challengesOnDuelWin(room, playerId) {
  safe("duelWin", () => dailyEvent(room, playerId, "duel_win", 1));
}

/** A PvE foe fell to `killerId` (room.onEntityKilled). Arena/hub kills never count. */
export function challengesOnMobKill(room, killerId, entity) {
  safe("mobKill", () => {
    if (!room || !entity || !killerId) return;
    const role = room.canto?.role;
    if (role === "arena" || role === "hub") return;
    if (entity.kind !== "mob" && entity.kind !== "boss") return;
    if (HEARTS.has(entity.archetype)) {
      dailyEvent(room, killerId, "heart_break", 1);
      return;
    }
    dailyEvent(room, killerId, "mob_kill", 1);
  });
}

/** A boss fell in `room`; `ids` are the players credited with the kill. */
export function challengesOnBossKill(room, entity, ids) {
  safe("bossKill", () => {
    if (!room || !entity || entity.kind !== "boss") return;
    const week = weekKey();
    const boss = weeklyBoss(week);
    if (room.cantoId !== boss.canto) return;
    if (!String(entity.id || "").includes(boss.bossId)) return;
    let list = race.get(week);
    if (!list) {
      list = [];
      race.set(week, list);
    }
    for (const id of ids || []) {
      if (!id || list.some((r) => r.id === id)) continue;
      const at = clock();
      list.push({ id, name: nameOf(id), at });
      const rank = list.length;
      persist(
        "race",
        `INSERT INTO weekly_race (week_key, player_id, name, boss_id, finished_at)
         VALUES ($1,$2,$3,$4, to_timestamp($5/1000.0)) ON CONFLICT DO NOTHING`,
        [week, id, nameOf(id), boss.bossId, at]
      );
      const r = rowOf(id, week, `w:${boss.bossId}`);
      r.progress = 1;
      r.done = true;
      writeRow(id, week, `w:${boss.bossId}`, r);
      const t = totalsOf(id);
      t.weeklies += 1;
      const sess = room.sessions.get(id);
      if (sess) {
        try {
          room.toast(
            sess.ws,
            "emit",
            rank <= PODIUM
              ? `Weekly race: you are #${rank} to defeat ${boss.name} this week!`
              : `Weekly race complete: ${boss.name} defeated (#${rank} this week).`
          );
        } catch {
          /* closing */
        }
      }
      unlock(room, id, boss.title);
      if (rank <= PODIUM) {
        unlock(room, id, "title:weekly_victor");
        unlock(room, id, "flair:laurel");
      }
      if (t.weeklies >= 3) unlock(room, id, "flair:ember");
      pushPanel(room, id);
    }
  });
}

export function challengesPayload(playerId) {
  const now = clock();
  const day = dayKey(now);
  const week = weekKey(now);
  const ch = dailyChallenge(day);
  const dr = prog.get(`${playerId}|${day}|${ch.id}`);
  const boss = weeklyBoss(week);
  const list = race.get(week) || [];
  const mine = list.findIndex((r) => r.id === playerId);
  const ownedNow = owned.get(playerId) || new Set();
  const w = worn.get(playerId) || { title: null, flair: null };
  return {
    day,
    daily: {
      id: ch.id,
      text: ch.text,
      goal: ch.goal,
      progress: dr?.progress || 0,
      done: Boolean(dr?.done),
      resetsInMs: msToNextDay(now),
    },
    week,
    weekly: {
      boss: boss.name,
      canto: boss.canto,
      done: mine >= 0,
      rank: mine >= 0 ? mine + 1 : 0,
      finishers: list.length,
      resetsInMs: msToNextWeek(now),
      top: list.slice(0, 5).map((r, i) => ({ rank: i + 1, name: r.name, at: r.at })),
    },
    totals: { ...totalsOf(playerId) },
    cosmetics: COSMETICS.map((c) => ({ id: c.id, kind: c.kind, label: c.label, desc: c.desc, owned: ownedNow.has(c.id) })),
    wearing: { title: w.title, flair: w.flair },
  };
}

export function handleChallengesGet(room, sess) {
  safe("get", () => {
    if (!room || !sess) return;
    room.send(sess.ws, { type: "challenges", ...challengesPayload(sess.playerId) });
  });
}

/** Wear (or clear with null) an owned title / flair. */
export function handleFlairSet(room, sess, kind, cosmeticId) {
  safe("flairSet", () => {
    if (!room || !sess) return;
    const k = kind === "flair" ? "flair" : "title";
    const id = cosmeticId == null || cosmeticId === "" ? null : String(cosmeticId);
    if (id) {
      const c = COSMETIC_BY_ID.get(id);
      if (!c || c.kind !== k || !ownedSet(sess.playerId).has(id)) {
        room.toast(sess.ws, "warn", "You have not unlocked that yet.");
        return;
      }
    }
    const w = worn.get(sess.playerId) || { title: null, flair: null };
    w[k] = id;
    worn.set(sess.playerId, w);
    writeWorn(sess.playerId);
    room.markDirty?.();
    room.send(sess.ws, { type: "challenges", ...challengesPayload(sess.playerId) });
  });
}

/** Compact nameplate cosmetics for snapshots: { t: "Pit Regular", f: "laurel" } or null. */
export function flairOf(playerId) {
  const w = worn.get(playerId);
  if (!w || (!w.title && !w.flair)) return null;
  const out = {};
  if (w.title) {
    const c = COSMETIC_BY_ID.get(w.title);
    if (c) out.t = c.label;
  }
  if (w.flair) out.f = String(w.flair).replace(/^flair:/, "");
  return Object.keys(out).length ? out : null;
}

export async function hydrateChallenges() {
  if (!dbEnabled()) return;
  try {
    const day = dayKey();
    const week = weekKey();
    const p = await query(
      `SELECT player_id, period_key, challenge_id, progress, done_at FROM challenge_progress
       WHERE period_key = $1 OR period_key = $2`,
      [day, week]
    );
    for (const r of p.rows) {
      prog.set(`${r.player_id}|${r.period_key}|${r.challenge_id}`, {
        progress: Number(r.progress) || 0,
        done: r.done_at != null,
      });
    }
    const t = await query(
      `SELECT player_id,
              SUM(CASE WHEN challenge_id LIKE 'd:%' THEN 1 ELSE 0 END)::int AS dailies,
              SUM(CASE WHEN challenge_id LIKE 'w:%' THEN 1 ELSE 0 END)::int AS weeklies
         FROM challenge_progress WHERE done_at IS NOT NULL GROUP BY player_id`
    );
    for (const r of t.rows) totals.set(String(r.player_id), { dailies: r.dailies | 0, weeklies: r.weeklies | 0 });
    const rr = await query(
      `SELECT player_id, name, finished_at FROM weekly_race WHERE week_key = $1 ORDER BY finished_at ASC`,
      [week]
    );
    race.set(
      week,
      rr.rows.map((r) => ({ id: String(r.player_id), name: r.name || "Wanderer", at: new Date(r.finished_at).getTime() }))
    );
    const c = await query(`SELECT player_id, cosmetic_id FROM player_cosmetics`);
    for (const r of c.rows) ownedSet(String(r.player_id)).add(String(r.cosmetic_id));
    const f = await query(`SELECT player_id, title, flair FROM player_flair`);
    for (const r of f.rows) worn.set(String(r.player_id), { title: r.title || null, flair: r.flair || null });
    console.log(`[chal] hydrated ${p.rowCount} progress, ${rr.rowCount} racers, ${c.rowCount} cosmetics`);
  } catch (err) {
    console.error("[chal] hydrate failed", err.message);
  }
}
