/**
 * Wrath (inferno_08) — the Styx. Inferno VII–VIII: wrathful souls tearing each
 * other in the mud, the sullen gurgling beneath («Fitti nel limo»), Filippo
 * Argenti, Phlegyas' ferry.
 *
 *  1. Fury. A wrath_shade or fury_champion gains 1 fury each time it is hit.
 *     Fury decays 1 stack per 2.5 s. At 4 stacks it enrages for 5 s (+35% damage;
 *     +25% move speed via mobAi.moveFor reading e.enraged). A stun, root, or
 *     bell still wipes fury and the enrage — crowd control is the answer.
 *  2. Styx eruptions. The geo.styx polyline is a visual band (crossing is free).
 *     While a pilgrim stands within 4 u of that band, every ~6 s a circle
 *     telegraph (kind styx_eruption, 1.1 s, radius 2.2) opens at their feet.
 *  3. Filippo Argenti (argenti_fury). Default boss AI still runs (bossTick
 *     returns false). Every ~7 s he throws a line of three styx eruptions
 *     toward the nearest pilgrim, rippling outward 0.16 s apart. At ≤50% hp, once, he tears at himself and
 *     three summoned wrath_shades rise around him. At ≤25% he enrages for good
 *     (+30% damage). onBossReset / init clear the fight.
 *  4. Phlegyas' Lantern. The default bell still stands; the ring also wipes
 *     fury on every wrathful in that still.
 *
 * Wire: telegraph kind styx_eruption (attackerId "mech:wrath" for the marsh,
 * the boss id for his line); { type: "wrath_fx", fx: "enrage",
 * id, x, y, boss? } when an enrage starts; { type: "wrath_fx", fx: "tear", id, x, y }
 * when Argenti tears at himself (phase 2, the adds rise). Snapshot entities carry
 * enraged: 1 while it holds, and fury: 1–3 while it builds (client warns from 2).
 */
const FURY_ARCH = new Set(["wrath_shade", "fury_champion"]);
const BOSS_ID = "argenti_fury";

const FURY_CAP = 4;
const FURY_DECAY = 2.5;
const ENRAGE_S = 5;
const ENRAGE_DMG = 1.35;
const BOSS_ENRAGE_DMG = 1.3;

const ERUPT_R = 2.2;
const ERUPT_MS = 1100;
const ERUPT_DMG = 16;
const STYX_NEAR = 4;
const STYX_EVERY = 6;

const BOSS_LINE_EVERY = 7;
const BOSS_LINE_FIRST = 4;
const BOSS_LINE_REACH = 16;
/** Seconds between the bursts of Argenti's thrown line (it ripples away from him). */
const LINE_STAGGER = 0.16;
const ADD_HP_BASE = 60;

let addSeq = 0;

function tierDmg(room, base) {
  return Math.max(1, Math.round(base * room.tierDmg()));
}

/** Distance from (x,y) to the styx band; 0 means standing in the river. */
export function distToStyx(styx, x, y) {
  const pts = styx?.points;
  if (!pts || pts.length < 2) return Infinity;
  const half = (Number(styx.width) || 0) / 2;
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = Number(pts[i][0]);
    const ay = Number(pts[i][1]);
    const bx = Number(pts[i + 1][0]);
    const by = Number(pts[i + 1][1]);
    const dx = bx - ax;
    const dy = by - ay;
    const l2 = dx * dx + dy * dy;
    let t = l2 > 0 ? ((x - ax) * dx + (y - ay) * dy) / l2 : 0;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    const d = Math.hypot(x - (ax + dx * t), y - (ay + dy * t));
    if (d < best) best = d;
  }
  return Math.max(0, best - half);
}

function clampPt(room, x, y) {
  const b = room.canto.geo.bounds;
  return {
    x: Math.max(2, Math.min((b?.width || 160) - 2, x)),
    y: Math.max(2, Math.min((b?.height || 120) - 2, y)),
  };
}

function erupt(room, x, y, attackerId) {
  const p = clampPt(room, x, y);
  room.telegraph({
    attackerId,
    shape: "circle",
    x: p.x,
    y: p.y,
    radius: ERUPT_R,
    duration: ERUPT_MS,
    kind: "styx_eruption",
    dmg: tierDmg(room, ERUPT_DMG),
  });
}

function clearFury(room, e) {
  const was = Boolean(e.enraged);
  e.fury = 0;
  e.furyAcc = 0;
  e.enraged = false;
  e.enrageLeft = 0;
  if (was) room.markDirty();
}

function beginEnrage(room, e, seconds) {
  e.enraged = true;
  e.enrageLeft = seconds;
  e.fury = FURY_CAP;
  room.broadcast({
    type: "wrath_fx",
    fx: "enrage",
    id: e.id,
    boss: e.kind === "boss" ? 1 : undefined,
    x: +e.x.toFixed(2),
    y: +e.y.toFixed(2),
  });
  room.markDirty();
}

function gainFury(room, e) {
  if (!FURY_ARCH.has(e.archetype) || e._dead || !(e.hp > 0)) return;
  if (e.enraged) return;
  if ((e.stunLeft || 0) > 0 || (e.rootLeft || 0) > 0) return;
  e.fury = Math.min(FURY_CAP, (e.fury || 0) + 1);
  if (e.fury >= FURY_CAP) beginEnrage(room, e, ENRAGE_S);
  else room.markDirty();
}

function tickFury(room, dt) {
  for (const e of room.entities.values()) {
    if (!FURY_ARCH.has(e.archetype) || e._dead || !(e.hp > 0)) continue;
    if ((e.stunLeft || 0) > 0 || (e.rootLeft || 0) > 0) {
      if (e.fury || e.enraged) clearFury(room, e);
      continue;
    }
    if (e.enraged) {
      e.enrageLeft = (e.enrageLeft || 0) - dt;
      if (e.enrageLeft <= 0) clearFury(room, e);
      continue;
    }
    if ((e.fury || 0) > 0) {
      e.furyAcc = (e.furyAcc || 0) + dt;
      if (e.furyAcc >= FURY_DECAY) {
        const steps = Math.floor(e.furyAcc / FURY_DECAY);
        e.furyAcc -= steps * FURY_DECAY;
        e.fury = Math.max(0, e.fury - steps);
        room.markDirty();
        if (e.fury <= 0) {
          e.fury = 0;
          e.furyAcc = 0;
        }
      }
    }
  }
}

function tickStyx(room, dt) {
  const styx = room.canto?.geo?.styx;
  if (!styx) return;
  for (const s of room.sessions.values()) {
    if (!(s.hp > 0)) continue;
    const near = distToStyx(styx, s.x, s.y) <= STYX_NEAR;
    if (!near) {
      s._styxNear = false;
      continue;
    }
    if (!s._styxNear) {
      s._styxNear = true;
      s._styxCd = STYX_EVERY;
    }
    s._styxCd -= dt;
    if (s._styxCd > 0) continue;
    s._styxCd = STYX_EVERY;
    erupt(room, s.x, s.y, "mech:wrath");
  }
}

function nearestPlayer(room, boss, reach) {
  let best = null;
  let bd = reach;
  for (const s of room.sessions.values()) {
    if (!(s.hp > 0)) continue;
    const d = Math.hypot(s.x - boss.x, s.y - boss.y);
    if (d < bd) {
      bd = d;
      best = s;
    }
  }
  return best;
}

function shadeHp(room) {
  for (const e of room.entities.values()) {
    if (e.archetype === "wrath_shade" && e.maxHp && !e.summoned) return e.maxHp;
  }
  return Math.max(1, Math.round(ADD_HP_BASE * room.tierDmg()));
}

function spawnAdds(room, boss) {
  const hp = shadeHp(room);
  for (let i = 0; i < 3; i++) {
    addSeq += 1;
    const ang = (i / 3) * Math.PI * 2 + 0.4;
    const p = clampPt(room, boss.x + Math.cos(ang) * 3.4, boss.y + Math.sin(ang) * 3.4);
    const id = `mob_wrath_${addSeq}`;
    room.entities.set(id, {
      id,
      kind: "mob",
      name: "Wrath Shade",
      x: p.x,
      y: p.y,
      hp,
      maxHp: hp,
      packId: "argenti_tears",
      champion: false,
      elite: false,
      dropTable: "inferno_pack_common",
      archetype: "wrath_shade",
      atkCd: 0.45,
      summoned: true,
      homeX: p.x,
      homeY: p.y,
    });
  }
  room.markDirty();
}

function despawnAdds(room) {
  for (const e of [...room.entities.values()]) {
    if (!e.summoned || e.packId !== "argenti_tears") continue;
    room.tele.cancelBy(e.id, "gone");
    room.entities.delete(e.id);
    room.broadcast({ type: "entity_removed", id: e.id });
  }
}

function phaseChecks(room, boss) {
  if (!(boss.hp > 0) || boss._dead) return;
  if (!boss._tore && boss.hp <= boss.maxHp * 0.5) {
    boss._tore = true;
    boss.phase = 2;
    spawnAdds(room, boss);
    room.broadcast({ type: "wrath_fx", fx: "tear", id: boss.id, x: +boss.x.toFixed(2), y: +boss.y.toFixed(2) });
    for (const s of room.sessions.values()) {
      room.toast(s.ws, "warn", "Filippo Argenti tears at himself!");
    }
  }
  if (!boss._berserk && boss.hp <= boss.maxHp * 0.25) {
    boss._berserk = true;
    boss.phase = Math.max(boss.phase || 1, 2);
    beginEnrage(room, boss, 1e9);
  }
}

function lineOfEruptions(room, boss, target) {
  const dx = target.x - boss.x;
  const dy = target.y - boss.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const step = 4.6;
  const start = Math.min(3.2, Math.max(2.2, len * 0.35));
  // The line rolls outward from his feet (one burst every LINE_STAGGER s) so it reads
  // as a thrown wave to sidestep, not three circles that pop at once.
  const bx = boss.x;
  const by = boss.y;
  for (let i = 0; i < 3; i++) {
    const x = bx + ux * (start + i * step);
    const y = by + uy * (start + i * step);
    if (i === 0) erupt(room, x, y, boss.id);
    else {
      room.schedule(i * LINE_STAGGER, () => {
        if (boss._dead || !(boss.hp > 0) || boss.resetting) return;
        erupt(room, x, y, boss.id);
      });
    }
  }
}

function resetBoss(boss) {
  boss.enraged = false;
  boss.enrageLeft = 0;
  boss.fury = 0;
  boss._tore = false;
  boss._berserk = false;
  boss._eruptCd = BOSS_LINE_FIRST;
  boss.phase = undefined;
}

export default {
  init(room) {
    room._wrath = { t: 0 };
    const boss = room.entities.get(BOSS_ID);
    if (boss) resetBoss(boss);
  },

  tick(room, dt) {
    tickFury(room, dt);
    tickStyx(room, dt);
  },

  onDamage(room, target, amount, source) {
    if (!(amount > 0)) return amount;
    if (target?.playerId) {
      const e = source?.id ? room.entities.get(source.id) : null;
      if (e?.enraged && source.teleKind !== "styx_eruption") {
        const mul = e.kind === "boss" ? BOSS_ENRAGE_DMG : ENRAGE_DMG;
        return Math.max(1, Math.round(amount * mul));
      }
      return amount;
    }
    if (target && FURY_ARCH.has(target.archetype)) gainFury(room, target);
    return amount;
  },

  /**
   * Phlegyas' Lantern: wipe fury in the bell's still, then let the default
   * still run (return false). A ring that reaches a wrathful counts the daily.
   */
  onBell(room, sess) {
    const R = 10;
    let answered = 0;
    for (const mob of room.entities.values()) {
      if (mob.kind !== "mob" || !(mob.hp > 0)) continue;
      if (String(mob.archetype || "").endsWith("_heart")) continue;
      if (Math.hypot(sess.x - mob.x, sess.y - mob.y) > R) continue;
      answered++;
      if (mob.fury || mob.enraged) clearFury(room, mob);
    }
    if (answered > 0) room.tryDaily(sess.playerId, "wrath_daily_lantern", { quiet: true });
    return false;
  },

  /** Adds on top of the default slam AI — always returns false. */
  bossTick(room, boss, dt) {
    if (boss.id !== BOSS_ID) return false;
    phaseChecks(room, boss);
    if (boss.resetting || !(boss.hp > 0)) return false;
    if (boss._eruptCd == null) boss._eruptCd = BOSS_LINE_FIRST;
    boss._eruptCd -= dt;
    if (boss._eruptCd > 0) return false;
    const target = nearestPlayer(room, boss, BOSS_LINE_REACH);
    if (!target) {
      boss._eruptCd = 1.5;
      return false;
    }
    boss._eruptCd = BOSS_LINE_EVERY;
    lineOfEruptions(room, boss, target);
    return false;
  },

  onBossReset(room, boss) {
    if (boss?.id !== BOSS_ID) return;
    resetBoss(boss);
    despawnAdds(room);
  },

  onKilled(room, e) {
    if (e?.id === BOSS_ID) despawnAdds(room);
  },
};
