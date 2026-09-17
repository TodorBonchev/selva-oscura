import { CANTOS } from "./content.mjs";
import { rollDrops } from "./loot.mjs";
import {
  getOrCreatePlayer,
  snapshotPlayer,
  tryEmit,
  players,
  grantInventoryItem,
  persistPlayerFlags,
} from "./ledger.mjs";
import * as ah from "./ah.mjs";

const ATTACK_RANGE = 3.5;
const MOVE_SPEED = 8; // units per intent clamp
const PLAYER_MAX_HP = 100;
const PLAYER_DMG = 28;

const MOB_HP = {
  whirl_shade: 40,
  gale_champion: 90,
  boss: 220,
};

const MOB_DMG = {
  whirl_shade: 6,
  gale_champion: 12,
  boss: 18,
};

let entitySeq = 0;
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
    this.sessions = new Map(); // playerId -> { ws, x, y, hp, maxHp, atkCd }
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
        const ox = (Math.random() - 0.5) * 6;
        const oy = (Math.random() - 0.5) * 6;
        const arch = pack.archetype || "whirl_shade";
        const maxHp = pack.champion
          ? MOB_HP.gale_champion
          : MOB_HP[arch] || MOB_HP.whirl_shade;
        this.entities.set(id, {
          id,
          kind: "mob",
          name: pack.champion ? "Gale Champion" : "Whirl Shade",
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
    const spawn = this.canto.geo.spawn;
    const sess = {
      ws,
      playerId,
      x: spawn.x,
      y: spawn.y,
      hp: PLAYER_MAX_HP,
      maxHp: PLAYER_MAX_HP,
      atkCd: 0,
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
      you: snapshotPlayer(ledger, {
        x: youSess.x,
        y: youSess.y,
        hp: youSess.hp,
        maxHp: youSess.maxHp,
        cantoId: this.cantoId,
      }),
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
    s.x = clamp(x, 1, b.width - 1);
    s.y = clamp(y, 1, b.height - 1);
    this.markDirty();
  }

  handleAttack(playerId, targetId) {
    const s = this.sessions.get(playerId);
    if (!s) return;
    if (s.atkCd > 0) return;
    const target = this.entities.get(targetId);
    if (!target || (target.kind !== "mob" && target.kind !== "boss")) {
      this.toast(s.ws, "warn", "Nothing to strike.");
      return;
    }
    if (dist(s, target) > ATTACK_RANGE) {
      this.toast(s.ws, "warn", "Out of range.");
      return;
    }
    s.atkCd = 0.45;
    const dmg = PLAYER_DMG + Math.floor(Math.random() * 8);
    target.hp = Math.max(0, target.hp - dmg);
    this.broadcast({
      type: "combat",
      attackerId: playerId,
      targetId,
      damage: dmg,
      targetHp: target.hp,
    });
    if (target.hp <= 0) {
      this.onEntityKilled(playerId, target);
    } else {
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

    this.entities.delete(entity.id);
    this.broadcast({ type: "entity_removed", id: entity.id });

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

  async handlePickup(playerId, lootId) {
    const s = this.sessions.get(playerId);
    const ledger = players.get(playerId);
    if (!s || !ledger) return;
    const loot = this.entities.get(lootId);
    if (!loot || loot.kind !== "loot") return;
    if (dist(s, loot) > 3.5) {
      this.toast(s.ws, "warn", "Too far to pick up.");
      return;
    }
    if (ledger.inventory.length >= 40) {
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
    if (dist(s, e) > 3.2) {
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
          "Guide: The wood is not a battlefield. Seek Lust through the eastern path, then return."
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
      this.toast(s.ws, "emit", `DailyQuest pending +${r.payoutAsh} Ash`);
    } else {
      this.toast(s.ws, "warn", `Daily writ: ${r.reason}`);
    }
    this.pushSnapshot(playerId);
  }

  markDirty() {
    this.dirty = true;
  }

  tick(dt) {
    if (this.sessions.size === 0) return;
    for (const s of this.sessions.values()) {
      if (s.atkCd > 0) s.atkCd = Math.max(0, s.atkCd - dt);
    }
    let moved = false;
    for (const e of this.entities.values()) {
      if (e.kind !== "mob" && e.kind !== "boss") continue;
      if (e.atkCd > 0) e.atkCd = Math.max(0, e.atkCd - dt);
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
      const aggro = e.kind === "boss" ? 14 : 8;
      if (nearestD < aggro && nearestD > 1.2) {
        const dx = nearest.x - e.x;
        const dy = nearest.y - e.y;
        const len = Math.hypot(dx, dy) || 1;
        const speed = e.kind === "boss" ? 2.2 : 3.0;
        e.x += (dx / len) * speed * dt;
        e.y += (dy / len) * speed * dt;
        moved = true;
      }
      if (nearestD <= 2.2 && e.atkCd <= 0) {
        const arch = e.archetype || (e.kind === "boss" ? "boss" : "whirl_shade");
        const dmg = e.champion ? MOB_DMG.gale_champion : MOB_DMG[arch] || MOB_DMG.whirl_shade;
        nearest.hp = Math.max(0, nearest.hp - dmg);
        e.atkCd = e.kind === "boss" ? 1.2 : 0.9;
        this.broadcast({
          type: "combat",
          attackerId: e.id,
          targetId: nearest.playerId,
          damage: dmg,
          targetHp: nearest.hp,
        });
        this.markDirty();
        if (nearest.hp <= 0) {
          const sp = this.canto.geo.spawn;
          nearest.x = sp.x;
          nearest.y = sp.y;
          nearest.hp = nearest.maxHp;
          this.toast(nearest.ws, "warn", "You fall… and wake at the canto entrance.");
        }
      }
    }
    if (moved) this.markDirty();
    this._snapAcc += dt;
    if (this.dirty && this._snapAcc >= 0.12) {
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
    return { ok: true, room };
  }

  tick(dt) {
    for (const room of this.rooms.values()) {
      room.tick(dt);
    }
  }
}
