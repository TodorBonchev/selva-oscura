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
} from "./ledger.mjs";
import * as ah from "./ah.mjs";
import {
  PLAYER_MAX_MANA,
  MANA_REGEN_PER_SEC,
  spellById,
} from "./spells.mjs";

const ATTACK_RANGE = 3.5;
/** Generous loot / POI reach so mobile players rarely see "Too far". */
const PICKUP_RANGE = 6.5;
const INTERACT_RANGE = 5.2;
const INTERACT_RANGE_PORTAL = 6.2;
const MOVE_SPEED = 8; // units per intent clamp
const PLAYER_MAX_HP = 130;
const RESPAWN_IFRAMES = 2.0; // seconds of invulnerability after waking at the entrance
const PLAYER_BASE_DMG = 22;
const PLAYER_ATK_CD = 0.42;

const MOB_HP = {
  whirl_shade: 36,
  gale_wisp: 16,
  gale_warden: 120,
  storm_heart: 90,
  gale_champion: 80,
  boss: 200,
};

const MOB_DMG = {
  whirl_shade: 3,
  gale_wisp: 2,
  gale_warden: 6,
  gale_champion: 7,
  boss: 12,
};

let entitySeq = 0;
function heartWards(room, e) {
  if (!e || e.archetype === "storm_heart" || e.kind === "boss") return false;
  for (const h of room.entities.values()) {
    if (h.archetype !== "storm_heart" || !(h.hp > 0)) continue;
    if (Math.hypot(h.x - e.x, h.y - e.y) <= 14) return true;
  }
  return false;
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
    this.spawnWorld();
  }

  spawnWorld() {
    this.entities.clear();
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
        toCanto: ex.to_canto,
      });
    }

    for (const pack of this.canto.packs || []) {
      const count = pack.count;
      for (let i = 0; i < count; i++) {
        const id = eid("mob");
        const ring = 2.4 + count * 0.45;
        const ang = (i / Math.max(1, count)) * Math.PI * 2 + Math.random() * 0.2;
        const ox = Math.cos(ang) * ring + (Math.random() - 0.5) * 0.6;
        const oy = Math.sin(ang) * ring + (Math.random() - 0.5) * 0.6;
        const arch = pack.archetype || "whirl_shade";
        const maxHp = pack.champion
          ? MOB_HP.gale_champion
          : MOB_HP[arch] || MOB_HP.whirl_shade;
        this.entities.set(id, {
          id,
          kind: "mob",
          name: pack.name || (pack.champion ? "Gale Champion" : "Whirl Shade"),
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

    for (const boss of this.canto.bosses || []) {
      const id = boss.id;
      this.entities.set(id, {
        id,
        kind: "boss",
        name: boss.name,
        x: boss.anchor.x,
        y: boss.anchor.y,
        hp: MOB_HP.boss,
        maxHp: MOB_HP.boss,
        dropTable: boss.drop_table,
        firstClearEmit: boss.first_clear_emit !== false,
        atkCd: 0,
      });
    }
  }

  join(ws, playerId, name) {
    const ledger = getOrCreatePlayer(playerId, name);
    // Empty bag → grant weapon + armor so Equip is testable without a kill
    if (!ledger.inventory || ledger.inventory.length === 0) {
      const kit = makeStarterKitItems();
      for (const item of kit) {
        void grantInventoryItem(playerId, item).catch((err) =>
          console.error("[starter] grant failed", err.message)
        );
      }
      this.toast(ws, "loot", "Starter kit: Ashen Club + Torn Cape (open INV → Equip).");
    }
    const spawn = this.canto.geo.spawn;
    const gear = computeGearStats(ledger);
    const maxHp = PLAYER_MAX_HP + gear.maxHp;
    const sess = {
      ws,
      playerId,
      x: spawn.x,
      y: spawn.y,
      hp: maxHp,
      maxHp,
      mana: PLAYER_MAX_MANA,
      maxMana: PLAYER_MAX_MANA,
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
    if (this.cantoId !== "inferno_01") {
      ledger.visitedInferno = true;
      void persistPlayerFlags(playerId).catch((err) =>
        console.error("[db] persist visitedInferno failed", err.message)
      );
    }
    return sess;
  }

  leave(playerId) {
    this.sessions.delete(playerId);
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

  buildSnapshot(forPlayerId) {
    const youSess = this.sessions.get(forPlayerId);
    const ledger = players.get(forPlayerId);
    const entities = [];
    for (const e of this.entities.values()) {
      entities.push({
        id: e.id,
        kind: e.kind,
        name: e.name,
        x: e.x,
        y: e.y,
        hp: e.hp,
        maxHp: e.maxHp,
        packId: e.packId,
        champion: e.champion,
        elite: e.elite,
        archetype: e.archetype,
        poiKind: e.poiKind,
        label: e.label,
        toCanto: e.toCanto,
        item: e.item,
      });
    }
    const playerSnaps = [];
    for (const [pid, s] of this.sessions) {
      const led = players.get(pid);
      playerSnaps.push(
        snapshotPlayer(led, {
          x: s.x,
          y: s.y,
          hp: s.hp,
          maxHp: s.maxHp,
          mana: s.mana,
          maxMana: s.maxMana,
          cantoId: this.cantoId,
        })
      );
    }
    return {
      cantoId: this.cantoId,
      title: this.canto.title,
      role: this.canto.role,
      bounds: this.canto.geo.bounds,
      entities,
      players: playerSnaps,
      you: {
        ...snapshotPlayer(ledger, {
          x: youSess.x,
          y: youSess.y,
          hp: youSess.hp,
          maxHp: youSess.maxHp,
          mana: youSess.mana,
          maxMana: youSess.maxMana,
          cantoId: this.cantoId,
        }),
        armorBuff: youSess.armorBuff || 0,
        wardUntil: youSess.wardUntil || 0,
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
    if (!s) return;
    const b = this.canto.geo.bounds;
    const dx = x - s.x;
    const dy = y - s.y;
    const d = Math.hypot(dx, dy);
    if (d > MOVE_SPEED) {
      const scale = MOVE_SPEED / d;
      x = s.x + dx * scale;
      y = s.y + dy * scale;
    }
    const nx = clamp(x, 0.5, b.width - 0.5);
    const ny = clamp(y, 0.5, b.height - 0.5);
    const mdx = nx - s.x;
    const mdy = ny - s.y;
    if (Math.hypot(mdx, mdy) > 0.05) {
      const ml = Math.hypot(mdx, mdy) || 1;
      s._lastFaceX = mdx / ml;
      s._lastFaceY = mdy / ml;
    }
    s.x = nx;
    s.y = ny;
    this.markDirty();
  }

  handleAttack(playerId, targetId) {
    const s = this.sessions.get(playerId);
    if (!s) return;
    if (s.atkCd > 0) return;
    const target = this.entities.get(targetId);
    if (!target) return;
    if (target.kind !== "mob" && target.kind !== "boss") {
      this.toast(s.ws, "warn", "Nothing to strike.");
      return;
    }
    if (dist(s, target) > ATTACK_RANGE) {
      this.toast(s.ws, "warn", "Out of range.");
      return;
    }
    s.atkCd = PLAYER_ATK_CD;
    const gear = computeGearStats(players.get(playerId) || { inventory: [] });
    const dmg = PLAYER_BASE_DMG + gear.dmg + Math.floor(Math.random() * 6);
    const victims = [target];
    for (const e of this.entities.values()) {
      if (e === target || (e.kind !== "mob" && e.kind !== "boss")) continue;
      if (dist(s, e) > ATTACK_RANGE + 0.35) continue;
      if (dist(target, e) > 2.6) continue;
      victims.push(e);
    }
    let anyDead = false;
    for (const v of victims) {
      let hit = v === target ? dmg : Math.max(8, Math.round(dmg * 0.55));
      if (heartWards(this, v)) hit = Math.max(1, Math.round(hit * 0.7));
      v.hp = Math.max(0, v.hp - hit);
      this.broadcast({
        type: "combat",
        attackerId: playerId,
        targetId: v.id,
        damage: hit,
        targetHp: v.hp,
      });
      if (v.hp <= 0) {
        anyDead = true;
        this.onEntityKilled(playerId, v);
      }
    }
    if (!anyDead) this.pushAllSnapshots();
  }

  handleCast(playerId, spellId, aimX, aimY) {
    const s = this.sessions.get(playerId);
    if (!s) return;
    const spell = spellById(spellId);
    if (!spell) {
      this.toast(s.ws, "warn", "Unknown spell.");
      return;
    }
    const cdLeft = s.spellCd?.[spell.id] ?? 0;
    if (cdLeft > 0) {
      this.toast(s.ws, "warn", `${spell.name} recharging…`);
      return;
    }
    if (s.mana < spell.manaCost) {
      this.toast(s.ws, "warn", `Not enough mana for ${spell.name} (${spell.manaCost}).`);
      this.send(s.ws, {
        type: "spell_fx",
        spellId: "mana_deny",
        casterId: playerId,
        x: s.x,
        y: s.y,
      });
      return;
    }

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

  _spendSpell(s, spell) {
    s.mana = Math.max(0, s.mana - spell.manaCost);
    if (!s.spellCd) s.spellCd = {};
    s.spellCd[spell.id] = spell.cooldown;
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
      if (heartWards(this, target)) dmg = Math.max(1, Math.round(dmg * 0.7));
      target.hp = Math.max(0, target.hp - dmg);
      this.broadcast({
        type: "combat",
        attackerId: playerId,
        targetId: target.id,
        damage: dmg,
        targetHp: target.hp,
        spellId: spell.id,
      });
      this.broadcast({
        type: "spell_fx",
        spellId: spell.id,
        casterId: playerId,
        x: s.x,
        y: s.y,
        tx: target.x,
        ty: target.y,
      });
      if (target.hp <= 0) {
        this.onEntityKilled(playerId, target);
      } else {
        this.pushAllSnapshots();
      }
    } else {
      this.broadcast({
        type: "spell_fx",
        spellId: spell.id,
        casterId: playerId,
        x: s.x,
        y: s.y,
        tx,
        ty,
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
    const base =
      spell.baseDamage +
      Math.floor(gear.dmg * 0.7) +
      Math.floor(Math.random() * (spell.damageVar + 1));
    const hit = [];
    for (const e of [...this.entities.values()]) {
      if (e.kind !== "mob" && e.kind !== "boss") continue;
      if (dist(s, e) > spell.radius) continue;
      let dmg = base + Math.floor(Math.random() * 5);
      if (heartWards(this, e)) dmg = Math.max(1, Math.round(dmg * 0.7));
      e.hp = Math.max(0, e.hp - dmg);
      hit.push({ id: e.id, dmg, hp: e.hp, ent: e });
      this.broadcast({
        type: "combat",
        attackerId: playerId,
        targetId: e.id,
        damage: dmg,
        targetHp: e.hp,
        spellId: spell.id,
      });
    }
    this.broadcast({
      type: "spell_fx",
      spellId: spell.id,
      casterId: playerId,
      x: s.x,
      y: s.y,
      radius: spell.radius,
    });
    for (const h of hit) {
      if (h.hp <= 0) this.onEntityKilled(playerId, h.ent);
    }
    if (!hit.some((h) => h.hp <= 0)) {
      this.pushAllSnapshots();
    } else {
      // onEntityKilled already pushed; ensure mana bar updates
      this.pushAllSnapshots();
    }
  }

  onEntityKilled(killerId, entity) {
    const killer = this.sessions.get(killerId);
    const ledger = players.get(killerId);
    const dropTable = entity.dropTable || "inferno_pack_common";
    const isBoss = entity.kind === "boss";
    const isChampion = Boolean(entity.champion);

    const drops = rollDrops(dropTable, {
      champion: isChampion,
      boss: isBoss,
    });

    for (const item of drops) {
      const lootId = eid("loot");
      this.entities.set(lootId, {
        id: lootId,
        kind: "loot",
        name: item.name,
        x: entity.x + (Math.random() - 0.5) * 1.5,
        y: entity.y + (Math.random() - 0.5) * 1.5,
        item,
      });
    }

    if (entity.archetype === "storm_heart") {
      for (const e of [...this.entities.values()]) {
        if (e === entity || e.kind !== "mob") continue;
        if (Math.hypot(e.x - entity.x, e.y - entity.y) > 14) continue;
        const burst = 22;
        e.hp = Math.max(0, e.hp - burst);
        this.broadcast({
          type: "combat",
          attackerId: killerId,
          targetId: e.id,
          damage: burst,
          targetHp: e.hp,
          spellId: "heart",
        });
        if (e.hp <= 0) this.onEntityKilled(killerId, e);
      }
      if (killer) this.toast(killer.ws, "emit", "The Storm Heart shatters.");
    }

    this.entities.delete(entity.id);
    this.broadcast({ type: "entity_removed", id: entity.id });
    if (entity.packId && killer) {
      let left = 0;
      for (const e of this.entities.values()) {
        if (e.packId === entity.packId && e.kind === "mob") left++;
      }
      if (left === 0) this.toast(killer.ws, "info", "The gust breaks. Press on.");
    }
    if (killer && entity.kind === "mob") {
      let mobs = 0;
      let bossUp = false;
      for (const e of this.entities.values()) {
        if (e.kind === "mob" && e.hp > 0) mobs++;
        if (e.kind === "boss" && e.hp > 0) bossUp = true;
      }
      if (mobs === 0 && bossUp) this.toast(killer.ws, "emit", "The road is clear. The Judge waits.");
    }

    if (drops.length && killer) {
      this.toast(
        killer.ws,
        "loot",
        `Dropped: ${drops.map((d) => `${d.rarity} ${d.name}`).join(", ")}`
      );
    }

    // Eligible emits only — never trash
    if (isChampion) {
      const r = tryEmit(killerId, "ChampionPack", { packId: entity.packId });
      if (r.ok && killer) {
        this.toast(killer.ws, "emit", `ChampionPack pending +${r.payoutAsh} Ash`);
      }
    }
    if (isBoss) {
      const r = tryEmit(killerId, "Boss", { bossId: entity.id, cantoId: this.cantoId });
      if (r.ok && killer) {
        this.toast(killer.ws, "emit", `Boss pending +${r.payoutAsh} Ash`);
      }
      const fc = this.canto.first_clear;
      if (fc?.enabled && entity.firstClearEmit) {
        const r2 = tryEmit(killerId, "FirstClear", { cantoId: this.cantoId, requires: entity.id });
        if (r2.ok && killer) {
          this.toast(killer.ws, "emit", `FirstClear pending +${r2.payoutAsh} Ash`);
        } else if (killer && r2.reason === "already_cleared") {
          this.toast(killer.ws, "info", "First clear already claimed for this canto.");
        }
      }
    }

    this.pushAllSnapshots();
  }

  handleDash(playerId, aimX, aimY) {
    const s = this.sessions.get(playerId);
    if (!s || s.hp <= 0) return;
    if (s.dashCd > 0) {
      this.toast(s.ws, "warn", `Dash cooling (${Math.ceil(s.dashCd)}s)`);
      return;
    }
    let dx = Number(aimX) || s._lastFaceX || 0;
    let dy = Number(aimY) || s._lastFaceY || -1;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    const step = 5.5;
    const b = this.canto.geo.bounds;
    s.x = Math.max(2, Math.min(b.width - 2, s.x + dx * step));
    s.y = Math.max(2, Math.min(b.height - 2, s.y + dy * step));
    s._lastFaceX = dx;
    s._lastFaceY = dy;
    s.iframes = Math.max(s.iframes || 0, 0.35);
    s.dashCd = 4;
    const fromX = s.x - dx * step;
    const fromY = s.y - dy * step;
    let cut = 0;
    for (const e of [...this.entities.values()]) {
      if (e.kind !== "mob" && e.kind !== "boss") continue;
      const d0 = Math.hypot(e.x - fromX, e.y - fromY);
      const d1 = Math.hypot(e.x - s.x, e.y - s.y);
      if (Math.min(d0, d1) > 2.2) continue;
      let dmg = e.kind === "boss" ? 12 : 18;
      if (heartWards(this, e)) dmg = Math.max(1, Math.round(dmg * 0.7));
      e.hp = Math.max(0, e.hp - dmg);
      cut++;
      this.broadcast({
        type: "combat",
        attackerId: playerId,
        targetId: e.id,
        damage: dmg,
        targetHp: e.hp,
        spellId: "dash",
      });
      if (e.hp <= 0) this.onEntityKilled(playerId, e);
    }
    this.toast(s.ws, cut ? "loot" : "info", cut ? `Dash cuts ${cut}` : "Dash");
    this.markDirty();
    this.pushSnapshot(playerId);
  }

  handleSip(playerId) {
    const s = this.sessions.get(playerId);
    if (!s) return;
    if (s.sipCd > 0) {
      this.toast(s.ws, "warn", `Flask cooling (${Math.ceil(s.sipCd)}s)`);
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
    if (dist(s, loot) > PICKUP_RANGE) {
      this.toast(s.ws, "warn", "Too far to pick up.");
      return;
    }
    const bagCount = ledger.inventory.filter((i) => !i.equipSlot).length;
    if (bagCount >= 40) {
      this.toast(s.ws, "warn", "Inventory full.");
      return;
    }
    this.entities.delete(lootId);
    await grantInventoryItem(playerId, loot.item);
    this.toast(s.ws, "loot", `Picked up ${loot.item.rarity} ${loot.item.name}`);
    this.pushAllSnapshots();
  }

  handleInteract(playerId, targetId) {
    const s = this.sessions.get(playerId);
    const ledger = players.get(playerId);
    if (!s || !ledger) return;
    const e = this.entities.get(targetId);
    if (!e) return;
    const maxDist =
      e.kind === "exit" || e.poiKind === "portal" ? INTERACT_RANGE_PORTAL : INTERACT_RANGE;
    if (dist(s, e) > maxDist) {
      this.toast(s.ws, "warn", "Move closer.");
      return;
    }

    if (e.kind === "exit") {
      this.send(s.ws, { type: "toast", level: "info", text: `Travel: ${e.toCanto}` });
      // Client/world manager will travel
      return { travel: e.toCanto };
    }

    if (e.kind === "poi") {
      if (e.poiKind === "npc") {
        ledger.spokeToGuide = true;
        void persistPlayerFlags(playerId).catch((err) =>
          console.error("[db] persist spokeToGuide failed", err.message)
        );
        this.toast(
          s.ws,
          "info",
          "Guide: Follow the gold arrow into Lust. Clear the road shades, then the Judge. Return and claim the writ."
        );
      } else if (e.poiKind === "stash") {
        this.toast(s.ws, "info", `Stash holds ${ledger.stash.length} items (stub — inventory only for now).`);
      } else if (e.poiKind === "ah") {
        this.send(s.ws, { type: "ah_listings", listings: ah.getListings() });
        this.toast(s.ws, "info", "Auction House opened (off-chain Ash ledger).");
      } else if (e.poiKind === "quest") {
        this.tryDaily(playerId);
      } else if (e.poiKind === "portal") {
        return { travel: "inferno_01" };
      } else if (e.poiKind === "cache") {
        if (s.lootedCache) {
          this.toast(s.ws, "info", "The wind cache is empty.");
          return;
        }
        const bagCount = ledger.inventory.filter((i) => !i.equipSlot).length;
        if (bagCount >= 40) {
          this.toast(s.ws, "warn", "Inventory full.");
          return;
        }
        const drops = rollDrops("inferno_pack_common", { champion: true, boss: false });
        const item = drops[0];
        if (!item) {
          this.toast(s.ws, "info", "The cache holds only dust.");
          return;
        }
        s.lootedCache = true;
        void grantInventoryItem(playerId, item).then(() => {
          this.toast(s.ws, "loot", `Cache: ${item.rarity} ${item.name}`);
          this.pushSnapshot(playerId);
        });
        return;
      } else if (e.poiKind === "bell") {
        if (s.bellCd > 0) {
          this.toast(s.ws, "warn", `The bell is quiet (${Math.ceil(s.bellCd)}s)`);
          return;
        }
        s.bellCd = 18;
        let stilled = 0;
        for (const mob of this.entities.values()) {
          if (mob.kind !== "mob") continue;
          if (dist(s, mob) > 10) continue;
          mob.stunLeft = 2.4;
          stilled++;
        }
        this.toast(s.ws, "emit", stilled ? `The bell stills ${stilled}` : "The bell rings, and nothing answers.");
      } else if (e.poiKind === "pyre" || e.poiKind === "shrine") {
        s.hp = s.maxHp;
        s.mana = s.maxMana;
        this.toast(
          s.ws,
          "emit",
          e.poiKind === "pyre"
            ? "The camp pyre warms you. Life and breath restored."
            : "The Wind Shrine knits your wounds and fills your breath."
        );
      }
    }
    this.pushSnapshot(playerId);
    return null;
  }

  tryDaily(playerId) {
    const s = this.sessions.get(playerId);
    const ledger = players.get(playerId);
    if (!s || !ledger) return;
    if (!ledger.spokeToGuide) {
      this.toast(s.ws, "warn", "Speak with the Guide first.");
      return;
    }
    if (!ledger.visitedInferno) {
      this.toast(s.ws, "warn", "Return from any Inferno instance once (travel to Lust).");
      return;
    }
    const r = tryEmit(playerId, "DailyQuest", { questId: "dw_daily_scout" });
    if (r.ok) {
      this.toast(s.ws, "emit", `Writ accepted. +${r.payoutAsh.toLocaleString()} Ash set aside (pending).`);
    } else {
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
    const gear = r.gearStats || computeGearStats(players.get(playerId));
    const ratio = s.maxHp > 0 ? s.hp / s.maxHp : 1;
    s.maxHp = PLAYER_MAX_HP + gear.maxHp;
    s.hp = Math.max(1, Math.min(s.maxHp, Math.round(s.maxHp * ratio)));
    this.toast(s.ws, "info", `Equipped ${r.item.name} → ${r.slot}`);
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
    const gear = r.gearStats || computeGearStats(players.get(playerId));
    const ratio = s.maxHp > 0 ? s.hp / s.maxHp : 1;
    s.maxHp = PLAYER_MAX_HP + gear.maxHp;
    s.hp = Math.max(1, Math.min(s.maxHp, Math.round(s.maxHp * ratio)));
    this.toast(s.ws, "info", `Unequipped ${r.item.name}`);
    this.pushSnapshot(playerId);
  }

  markDirty() {
    this.dirty = true;
  }

  tick(dt) {
    if (this.sessions.size === 0) return;
    let manaDirty = false;
    for (const s of this.sessions.values()) {
      if (s.atkCd > 0) s.atkCd = Math.max(0, s.atkCd - dt);
      if (s.sipCd > 0) s.sipCd = Math.max(0, s.sipCd - dt);
      if (s.dashCd > 0) s.dashCd = Math.max(0, s.dashCd - dt);
      if (s.bellCd > 0) s.bellCd = Math.max(0, s.bellCd - dt);
      if (s.iframes > 0) s.iframes = Math.max(0, s.iframes - dt);
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
        s.mana = Math.min(s.maxMana, s.mana + MANA_REGEN_PER_SEC * dt);
        if (Math.floor(s.mana) !== Math.floor(before)) manaDirty = true;
      }
    }
    if (manaDirty) this.markDirty();
    let moved = false;
    for (const e of this.entities.values()) {
      if (e.kind !== "mob" && e.kind !== "boss") continue;
      if (e.atkCd > 0) e.atkCd = Math.max(0, e.atkCd - dt);
      if (e.stunLeft > 0) {
        e.stunLeft = Math.max(0, e.stunLeft - dt);
        continue;
      }
      if (e.archetype === "storm_heart") continue;
      let nearest = null;
      let nearestD = 999;
      for (const s of this.sessions.values()) {
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
      const leash = e.kind === "boss" ? 16 : 11;
      if (e.kind !== "boss" && homeD > leash) {
        const hx = e.homeX - e.x;
        const hy = e.homeY - e.y;
        const hl = Math.hypot(hx, hy) || 1;
        e.x += (hx / hl) * 4.2 * dt;
        e.y += (hy / hl) * 4.2 * dt;
        moved = true;
        continue;
      }
      const aggro = e.kind === "boss" ? 14 : 8;
      const winding = e.kind === "boss" && e.windupLeft > 0;
      // Hold still during slam windup so the ground ring matches the hit.
      if (!winding && nearestD < aggro && nearestD > 1.2) {
        const dx = nearest.x - e.x;
        const dy = nearest.y - e.y;
        const len = Math.hypot(dx, dy) || 1;
        const speed =
          e.archetype === "gale_wisp" ? 5.4 : e.archetype === "gale_warden" ? 1.6 : e.kind === "boss" ? 2.2 : 3.0;
        e.x += (dx / len) * speed * dt;
        e.y += (dy / len) * speed * dt;
        moved = true;
      }
      // Boss: telegraph windup before the hit so players can dodge
      if (winding) {
        e.windupLeft = Math.max(0, e.windupLeft - dt);
        if (e.windupLeft <= 0) {
          const target = this.sessions.get(e.windupTargetId);
          e.windupTargetId = null;
          e.atkCd = 1.35;
          if (target && !(target.iframes > 0)) {
            const dHit = dist(e, target);
            if (dHit <= 3.2) {
              const arch = e.archetype || "boss";
              const dmg = MOB_DMG[arch] || MOB_DMG.boss || 18;
              const led = players.get(target.playerId);
              const armor =
                (led ? computeGearStats(led).armor : 0) + (target.armorBuff || 0);
              const soak = Math.floor(armor * 0.5);
              const taken = Math.max(1, dmg - soak);
              const soaked = Math.max(0, dmg - taken);
              target.hp = Math.max(0, target.hp - taken);
              this.broadcast({
                type: "combat",
                attackerId: e.id,
                targetId: target.playerId,
                targetIsPlayer: true,
                damage: taken,
                soaked,
                wardActive: !!(target.armorBuff > 0),
                targetHp: target.hp,
              });
              this.markDirty();
              if (target.hp <= 0) {
                const sp = this.canto.geo.spawn;
                target.x = sp.x;
                target.y = sp.y;
                target.hp = target.maxHp;
                target.iframes = RESPAWN_IFRAMES;
                this.toast(target.ws, "warn", "You are slain… and wake at the canto entrance.");
              }
            }
          }
        }
        continue;
      }
      if (nearestD <= 2.2 && e.atkCd <= 0 && !(nearest.iframes > 0)) {
        if (e.kind === "boss") {
          // Start Judge slam telegraph — ~1.4s so countdown pip reads 2→1 clearly
          e.windupLeft = 1.4;
          e.windupTargetId = nearest.playerId;
          e.atkCd = 2.2; // covers windup + recovery
          this.broadcast({
            type: "boss_telegraph",
            id: e.id,
            attackerId: e.id,
            x: e.x,
            y: e.y,
            radius: 3.2,
            duration: 1.4,
          });
          this.markDirty();
          continue;
        }
        const arch = e.archetype || "whirl_shade";
        const dmg = e.champion ? MOB_DMG.gale_champion : MOB_DMG[arch] || MOB_DMG.whirl_shade;
        const led = players.get(nearest.playerId);
        const armor =
          (led ? computeGearStats(led).armor : 0) + (nearest.armorBuff || 0);
        const soak = Math.floor(armor * 0.5);
        const taken = Math.max(1, dmg - soak);
        const soaked = Math.max(0, dmg - taken);
        nearest.hp = Math.max(0, nearest.hp - taken);
        e.atkCd = 0.9;
        this.broadcast({
          type: "combat",
          attackerId: e.id,
          targetId: nearest.playerId,
          targetIsPlayer: true,
          damage: taken,
          soaked,
          wardActive: !!(nearest.armorBuff > 0),
          targetHp: nearest.hp,
        });
        this.markDirty();
        if (nearest.hp <= 0) {
          const sp = this.canto.geo.spawn;
          nearest.x = sp.x;
          nearest.y = sp.y;
          nearest.hp = nearest.maxHp;
          nearest.iframes = RESPAWN_IFRAMES;
          this.toast(nearest.ws, "warn", "You are slain… and wake at the canto entrance.");
        }
      }
    }
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
      this.rooms.set(id, new CantoRoom(id));
    }
    this.playerRoom = new Map(); // playerId -> cantoId
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
    if (cid) this.rooms.get(cid)?.leave(playerId);
    this.playerRoom.delete(playerId);
  }

  getRoom(playerId) {
    const cid = this.playerRoom.get(playerId);
    return cid ? this.rooms.get(cid) : null;
  }

  travel(playerId, toCanto, ws, name) {
    if (!this.rooms.has(toCanto)) return { ok: false, reason: "unknown_canto" };
    const from = this.getRoom(playerId);
    const sess = from?.sessions.get(playerId);
    // Allow travel if near exit OR explicit travel after interact
    const room = this.ensureJoin(ws, playerId, name, toCanto);
    room.pushSnapshot(playerId);
    room.toast(ws, "info", `Entered ${room.canto.title}.`);
    if (room.canto.role === "hub" || room.cantoId === "inferno_01") {
      room.toast(
        ws,
        "info",
        "No foes in the Dark Wood — take the eastern portal Toward Lust."
      );
    }
    return { ok: true, room };
  }

  tick(dt) {
    for (const room of this.rooms.values()) {
      room.tick(dt);
    }
  }
}
