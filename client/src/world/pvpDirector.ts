/**
 * Client PvP: duel / arena messages, telegraphs, juice, and the DEV hook.
 * Hot path (frame) does not allocate; DOM and strings update on change or at 10 Hz.
 */
import * as THREE from "three";
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { showToast, togglePanel, updateStats, isCompactUi } from "../ui/hud";
import { PvpHud, howIt, type FeedRow } from "../ui/pvpHud";
import { Sfx } from "../ui/sfx";
import { PvpFx } from "./pvpFx";
import { canTargetPlayer, activeDuel, type DuelLite, type TargetPlayer } from "./pvpRules";
import { wrapDelta } from "./wrap";
import { humanoidSwing } from "./heroAnim";
import { yawFromPlanar, CAM_SIDE_X, CAM_SIDE_Z } from "./frames";
import type { WorldApp } from "./WorldApp";
import type { DmgStyle } from "../ui/damageNumbers";

const EMPTY: DuelLite[] = [];
const RING_SLACK = 0.5;
const OUT_MS = 1500;
const CHALLENGE_CHIP = 7;
const _xy = { x: 0, y: 0 };

type Duel = DuelLite & {
  id: string;
  aName?: string;
  bName?: string;
  cx: number;
  cy: number;
  r: number;
  startsAt?: number;
  endsAt?: number;
  ranked?: boolean;
  winnerId?: string;
  reason?: string;
  ratingDelta?: Record<string, number>;
};

function esc(s: string): string {
  return s.replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"));
}

function fmtClock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r < 10 ? "0" : ""}${r}`;
}

function fmtDelta(n: number): string {
  if (!n) return "0";
  return (n > 0 ? "+" : "−") + Math.abs(Math.round(n));
}

export class PvpDirector {
  readonly hud: PvpHud;
  readonly sfx: Sfx;
  readonly fx: PvpFx;
  duels: Duel[] = EMPTY as unknown as Duel[];
  inviteFrom: string | null = null;
  pending: { toId: string; toName: string } | null = null;
  private inviteUntil = 0;
  private inviteName = "";
  private feed: FeedRow[] = [];
  private hpOverride = new Map<string, number>();
  private queueSize = 0;
  private queueFlag = false;
  private lastHud = 0;
  private lastCount = "";
  private gongFor = "";
  private fightLineFor = "";
  private fightLineUntil = 0;
  private resultUntil = 0;
  private announceUntil = 0;
  private roundEndUntil = 0;
  private outSince = -1;
  private slowUntil = 0;
  private slowMarked = 0;
  pushLeft = 0;
  private killerId: string | null = null;
  private respawnUntil = 0;
  private defeatAt = 0;
  private tabHeld = false;
  private localLabel: CSS2DObject | null = null;
  private localName = "";
  private subs = new WeakMap<HTMLElement, HTMLElement>();
  private scoreCache = "";
  private _fwd = new THREE.Vector3();
  private _want = new THREE.Vector3();
  private app: WorldApp;

  constructor(app: WorldApp) {
    this.app = app;
    this.sfx = new Sfx();
    this.fx = new PvpFx(app.scene);
    this.hud = new PvpHud({
      onChallenge: () => this.challengeNearest(),
      onCancel: () => this.cancelPending(),
      onAccept: () => this.accept(),
      onDecline: () => this.decline(),
      onQueue: () => this.toggleQueue(),
      onBoard: () => this.toggleBoard(),
      onScore: () => {
        this.hud.scorePinned = !this.hud.scorePinned;
      },
      onMute: () => this.hud.setMuted(this.sfx.toggleMuted()),
    });
    this.hud.setMuted(this.sfx.muted);
  }

  youId(): string {
    const id = this.app.room?.you?.id ?? this.app.socket.playerId;
    return id != null ? String(id) : "";
  }

  canTarget(pl: TargetPlayer | null | undefined): boolean {
    const room = this.app.room;
    if (!room || !pl) return false;
    return canTargetPlayer(room.role, room.cantoId, this.duels, this.youId(), pl);
  }

  /** True when this id is a pilgrim in the room (mobs also strike with targetIsPlayer). */
  isPlayerAttacker(id: string): boolean {
    if (!id) return false;
    if (id === this.youId()) return true;
    const ps = this.app.room?.players;
    if (!ps) return false;
    for (let i = 0; i < ps.length; i++) if (String(ps[i].id) === id) return true;
    return false;
  }

  onSnapshot(room: any) {
    this.duels = Array.isArray(room?.duels) ? room.duels : (EMPTY as unknown as Duel[]);
    this.hpOverride.clear();
    if (room?.you?.pvp && typeof room.you.pvp.queued === "boolean") this.queueFlag = Boolean(room.you.pvp.queued);
    this.fx.syncRings(this.duels, this.ringY);
    if (!room?.you?.pvp?.downed && this.hud.recapOn) this.hud.hideRecap();
    this.paintPlayers();
  }

  /** Returns true when the message was a PvP one (do not fall through to canto mechs). */
  onMessage(msg: any): boolean {
    switch (msg?.type) {
      case "duel_invite":
        this.onInvite(msg);
        return true;
      case "duel_pending":
        this.pending = { toId: String(msg.toId), toName: String(msg.toName || "") };
        this.hud.setChallenge(null);
        return true;
      case "duel_declined":
        this.pending = null;
        this.hud.setPending(null);
        showToast(
          msg.reason === "expired" ? "La sfida è scaduta" : `${msg.byName || "Qualcuno"} rifiuta il duello`,
          "info"
        );
        return true;
      case "duel_state":
        this.onDuelState(msg.duel);
        return true;
      case "pvp_windup":
        this.onWindup(msg);
        return true;
      case "pvp_down":
        this.onDown(msg);
        return true;
      case "pvp_kill":
        this.onKill(msg);
        return true;
      case "pvp_round":
        this.onRound(msg);
        return true;
      case "pvp_queue":
        this.queueFlag = Boolean(msg.queued);
        this.queueSize = Number(msg.size) || 0;
        return true;
      case "pvp_leaderboard":
        this.paintBoard(msg);
        return true;
      default:
        return false;
    }
  }

  /** Player-vs-player combat (not a mob blow, which also sets targetIsPlayer). */
  onPlayerCombat(msg: any) {
    const now = performance.now();
    const app = this.app;
    const room = app.room;
    const you = this.youId();
    const tid = String(msg.targetId ?? "");
    const attacker = String(msg.attackerId ?? "");
    const hitSelf = tid === you;
    const weHit = attacker === you;
    const how = String(msg.how || "");
    const heavy = how === "finisher" || how === "infernal_burst";
    const blocked = Boolean(msg.iframeBlocked) || (Number(msg.damage) || 0) <= 0 && Boolean(msg.iframeBlocked);
    const dmg = Number(msg.damage) || 0;
    if (msg.targetHp != null && Number.isFinite(Number(msg.targetHp))) {
      const hp = Number(msg.targetHp);
      this.hpOverride.set(tid, hp);
      const pl = room?.players?.find((p: any) => String(p.id) === tid);
      if (pl) pl.hp = hp;
      if (hitSelf && room?.you) {
        room.you.hp = hp;
        updateStats(room.you, room.title, room.subtitleIt || room.subtitle_it);
      }
    }
    const pos = this.heroPlanar(tid, hitSelf);
    const gy = app.standY(pos.x, pos.y);
    const group = hitSelf ? app.youGroup : app.nodes.get(`pl:${tid}`)?.group;
    if (group && !blocked) this.fx.flashHero(group, heavy, now);
    if (blocked) {
      app.combat?.number(pos.x, gy + 2.15, pos.y, 0, "block", tid, now, "schivato");
      if (hitSelf) {
        const src = this.heroPlanar(attacker, false);
        app.kickShake(0.06, app.renderYou.x - src.x, app.renderYou.y - src.y);
      }
      return;
    }
    const style: DmgStyle = hitSelf
      ? "self"
      : how === "dash"
        ? "dash"
        : how === "gale_bolt" || how === "infernal_burst"
          ? "spell"
          : heavy
            ? "heavy"
            : weHit
              ? "melee"
              : "other";
    app.combat?.number(pos.x, gy + 2.15, pos.y, dmg, style, tid, now);
    if (hitSelf) {
      const src = this.heroPlanar(attacker, false);
      app.kickShake(heavy ? 0.28 : 0.16, app.renderYou.x - src.x, app.renderYou.y - src.y);
      app.hitStopUntil = now + (heavy ? 100 : 64);
      app.camPunch = Math.max(app.camPunch, heavy ? 0.42 : 0.28);
      this.hud.pulseHurt();
      if (heavy) this.sfx.heavy();
      else this.sfx.hit();
      return;
    }
    if (weHit) {
      app.kickShake(heavy ? 0.22 : 0.1, pos.x - app.renderYou.x, pos.y - app.renderYou.y);
      app.hitStopUntil = now + (heavy ? 96 : 58);
      if (heavy) this.sfx.heavy();
      else this.sfx.hit();
      if (msg.targetHp != null && Number(msg.targetHp) <= 0) this.noteKill();
      return;
    }
    // A bystander's screen does not freeze.
  }

  /** Ground height for rings (one closure, not one per frame). */
  private readonly ringY = (x: number, y: number) => this.app.standY(x, y, 0);

  frame(rawDt: number, now: number) {
    const dt = rawDt > 0 && rawDt < 0.25 ? rawDt : 0.016;
    this.fx.tick(now, dt);
    this.fx.syncRings(this.liveRings(), this.ringY);
    this.pulseShimmer();
    this.tickCountdown(now);
    this.tickRingWarn(now);
    if (this.resultUntil && now > this.resultUntil) {
      this.resultUntil = 0;
      this.hud.hideResult();
    }
    if (this.announceUntil && now > this.announceUntil) {
      this.announceUntil = 0;
      this.hud.hideAnnounce();
    }
    if (this.roundEndUntil && now > this.roundEndUntil) {
      this.roundEndUntil = 0;
      this.hud.hideRoundEnd();
    }
    if (this.inviteFrom && this.inviteUntil && now > this.inviteUntil) {
      this.inviteFrom = null;
      this.hud.hideInvite();
    }
    this.expireFeed(now);
    const downed = Boolean(this.app.room?.you?.pvp?.downed);
    this.hud.setKillCam(downed);
    if (downed && this.respawnUntil) {
      const left = Math.max(0, this.respawnUntil - now);
      this.hud.setRecapTimer(left > 0 ? `Rinascita ${Math.ceil(left / 1000)}` : "");
    }
    if (now - this.lastHud < 100) return;
    this.lastHud = now;
    this.paintHud(now);
  }

  /** After placeFollowCamera. Kill cam eases toward the killer; a scored down pushes in. */
  nudgeCamera(rawDt: number) {
    const cam = this.app.camera;
    const downed = Boolean(this.app.room?.you?.pvp?.downed);
    if (downed && this.killerId) {
      const node = this.app.nodes.get(`pl:${this.killerId}`);
      if (node) {
        const k = node.group.position;
        this._want.set(k.x + CAM_SIDE_X * 6.2, k.y + 4.2, k.z + CAM_SIDE_Z * 6.2);
        const a = 1 - Math.exp(-Math.max(0, rawDt) * 2.6);
        cam.position.lerp(this._want, a);
        cam.lookAt(k.x, k.y + 1.3, k.z);
      }
      return;
    }
    if (this.pushLeft > 0) {
      cam.getWorldDirection(this._fwd);
      cam.position.addScaledVector(this._fwd, 0.62 * Math.min(1, this.pushLeft / 0.4));
      this.pushLeft = Math.max(0, this.pushLeft - Math.max(0, rawDt));
    }
  }

  timeScale(): number {
    if (this.slowUntil <= 0) return 1;
    const now = performance.now();
    if (now < this.slowUntil) return 0.3;
    const u = (now - this.slowUntil) / 280;
    if (u >= 1) {
      this.slowUntil = 0;
      return 1;
    }
    return 0.3 + 0.7 * u;
  }

  paintRemote(el: HTMLElement, pl: any) {
    this.paintPlate(el, pl?.pvp, this.canTarget(pl), Boolean(pl?.pvp?.downed) || (pl?.hp != null && pl.hp <= 0));
  }

  challengeNearest(): boolean {
    const id = this.nearestRival(8);
    if (!id) return false;
    this.app.socket.duelChallenge(id);
    return true;
  }

  accept(): boolean {
    if (!this.inviteFrom) return false;
    this.app.socket.duelRespond(this.inviteFrom, true);
    this.inviteFrom = null;
    this.hud.hideInvite();
    return true;
  }

  decline(): boolean {
    if (!this.inviteFrom) return false;
    this.app.socket.duelRespond(this.inviteFrom, false);
    this.inviteFrom = null;
    this.hud.hideInvite();
    return true;
  }

  cancelPending() {
    if (!this.pending) return;
    this.pending = null;
    this.hud.setPending(null);
    this.app.socket.duelCancel();
  }

  onKeyG() {
    if (this.pending) {
      this.cancelPending();
      return;
    }
    if (this.hud.inviteOpen()) return;
    this.challengeNearest();
  }

  tabDown() {
    this.tabHeld = true;
  }
  tabUp() {
    this.tabHeld = false;
  }

  state() {
    const room = this.app.room;
    return {
      duels: this.duels === (EMPTY as unknown as Duel[]) ? [] : this.duels,
      inviteFrom: this.inviteFrom,
      pending: this.pending,
      arena: room?.arena ?? null,
      youPvp: room?.you?.pvp ?? null,
      downed: Boolean(room?.you?.pvp?.downed),
      recapVisible: this.hud.recapOn,
      killFeed: this.feed.length,
    };
  }

  private onInvite(msg: any) {
    this.inviteFrom = String(msg.fromId);
    this.inviteName = String(msg.fromName || "Qualcuno");
    const sec = Number(msg.expiresIn) || 15;
    this.inviteUntil = performance.now() + sec * 1000;
    const title = msg.title ? String(msg.title) : "";
    const rating = Number(msg.rating) || 1200;
    const who = title ? `${this.inviteName} (${rating}, ${title})` : `${this.inviteName} (${rating})`;
    this.hud.showInvite(`${who} ti sfida a duello`);
    this.hud.setInviteFrac(1);
  }

  private onDuelState(d: Duel | null | undefined) {
    if (!d || !d.id) return;
    if (this.duels === (EMPTY as unknown as Duel[])) this.duels = [];
    let idx = -1;
    for (let i = 0; i < this.duels.length; i++) if (this.duels[i]!.id === d.id) idx = i;
    const you = this.youId();
    if (you && (String(d.a) === you || String(d.b) === you)) {
      this.pending = null;
      this.hud.setPending(null);
    }
    if (d.phase === "over") {
      if (idx >= 0) this.duels.splice(idx, 1);
      this.showResult(d);
      this.fx.syncRings(this.duels, this.ringY);
      return;
    }
    if (idx >= 0) this.duels[idx] = d;
    else this.duels.push(d);
    this.fx.syncRings(this.duels, this.ringY);
  }

  private showResult(d: Duel) {
    const you = this.youId();
    const mine = d.a === you || d.b === you;
    const draw = d.reason === "draw" || !d.winnerId;
    let title = "Patta";
    if (!draw && d.winnerId === you) title = "Vittoria";
    else if (!draw && mine) title = "Sconfitta";
    else if (!draw) {
      const name = d.winnerId === d.a ? d.aName || "Vincitore" : d.bName || "Vincitore";
      title = name;
    }
    const delta = d.ratingDelta && you && d.ratingDelta[you] != null ? fmtDelta(Number(d.ratingDelta[you])) : "";
    const why = d.reason ? reasonLine(d.reason) : "";
    const sub = [why, delta].filter(Boolean).join(" · ");
    this.hud.showResult(title, sub);
    this.resultUntil = performance.now() + 3400;
    if (title === "Vittoria") this.sfx.victory();
    else if (title === "Sconfitta") {
      if (performance.now() - this.defeatAt > 1800) this.sfx.defeat();
    }
    if (title === "Vittoria" && d.reason === "down") this.noteKill();
    this.pending = null;
    this.hud.setPending(null);
  }

  private onWindup(msg: any) {
    const now = performance.now();
    const x = Number(msg.x) || 0;
    const y = Number(msg.y) || 0;
    let fx = Number(msg.fx) || 0;
    let fy = Number(msg.fy) || 0;
    if (fx === 0 && fy === 0) fy = -1;
    const heavy = Boolean(msg.heavy);
    const ms = Number(msg.ms) || (heavy ? 300 : 120);
    this.fx.windup(x, this.app.standY(x, y, 0.08), y, fx, fy, heavy, ms, now);
    const id = String(msg.id ?? "");
    if (!id || id === this.youId()) return;
    const rec = this.app.nodes.get(`pl:${id}`);
    if (!rec) return;
    const ud = rec.group.userData;
    ud.lastSwingAt = this.app.animT;
    ud.swingKind = heavy ? 2 : 0;
    ud.gaitYaw = yawFromPlanar(fx, fy);
    rec.group.rotation.y = ud.gaitYaw;
    humanoidSwing(rec.group, this.app.animT, heavy ? 2 : 0, Math.max(280, ms), 0);
    this.app.heroMotor?.remoteSwing(rec.group, heavy ? 2 : 0);
  }

  private onDown(msg: any) {
    const now = performance.now();
    this.killerId = msg.killerId ? String(msg.killerId) : null;
    const wait = Number(msg.respawnIn) || 0;
    this.respawnUntil = now + wait;
    const name = String(msg.killerName || "—");
    const rows = Array.isArray(msg.recap) ? msg.recap : [];
    let html = "";
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      html += `<div>${esc(String(r.name || ""))} · ${esc(howIt(String(r.how || "")))} · ${Number(r.dmg) || 0} × ${Number(r.count) || 0}</div>`;
    }
    if (msg.total) html += `<div class="pvp-recap-total">${Number(msg.total)}</div>`;
    this.hud.showRecap(`Abbattuto da ${name}`, html || "<div>—</div>");
    this.hud.setRecapTimer(wait > 0 ? `Rinascita ${Math.ceil(wait / 1000)}` : "");
    this.defeatAt = now;
    this.sfx.defeat();
  }

  private onKill(msg: any) {
    const now = performance.now();
    const you = this.youId();
    const killerId = String(msg.killerId ?? "");
    const victimId = String(msg.victimId ?? "");
    this.feed.unshift({
      killer: String(msg.killerName || ""),
      victim: String(msg.victimName || ""),
      how: String(msg.how || "melee"),
      mine: killerId === you || victimId === you,
      at: now,
    });
    if (this.feed.length > 5) this.feed.length = 5;
    if (msg.announce) {
      this.hud.flashAnnounce(String(msg.announce));
      this.announceUntil = now + 1600;
      this.sfx.announce();
    }
    if (killerId === you) this.noteKill();
  }

  private onRound(msg: any) {
    const winners = Array.isArray(msg.winners) ? msg.winners : [];
    let html = `<div class="pvp-roundend-title">Round ${Number(msg.n) || ""}</div>`;
    if (!winners.length) html += `<div>Nessuna uccisione</div>`;
    for (let i = 0; i < winners.length; i++) {
      const w = winners[i];
      html += `<div>${esc(String(w.name || ""))} · ${Number(w.kills) || 0}</div>`;
    }
    this.hud.showRoundEnd(html);
    this.roundEndUntil = performance.now() + 6000;
    this.sfx.gong();
  }

  private noteKill() {
    const now = performance.now();
    if (now - this.slowMarked < 700) return;
    this.slowMarked = now;
    this.slowUntil = now + 400;
    this.pushLeft = 0.4;
    this.sfx.kill();
  }

  private tickCountdown(now: number) {
    const d = this.focusDuel();
    if (!d) {
      if (this.lastCount) {
        this.lastCount = "";
        this.hud.setCountdown(null);
      }
      return;
    }
    if (d.phase === "countdown") {
      const sec = Math.max(0, Math.ceil(((d.startsAt || 0) - Date.now()) / 1000));
      const text = sec > 0 ? String(sec) : "";
      if (text !== this.lastCount) {
        if (text) this.sfx.tick();
        this.lastCount = text;
        this.hud.setCountdown(text || null);
      }
      return;
    }
    if (d.phase === "fight" && this.fightLineFor !== d.id) {
      this.fightLineFor = d.id;
      this.fightLineUntil = now + 900;
      this.gongFor = d.id;
      this.lastCount = "Combatti!";
      this.hud.setCountdown("Combatti!");
      this.sfx.gong();
      return;
    }
    if (this.fightLineUntil && now > this.fightLineUntil && this.lastCount === "Combatti!") {
      this.fightLineUntil = 0;
      this.lastCount = "";
      this.hud.setCountdown(null);
    }
  }

  private tickRingWarn(now: number) {
    const room = this.app.room;
    const you = this.youId();
    const d = this.focusDuel();
    if (!room || !d || d.phase !== "fight" || (d.a !== you && d.b !== you)) {
      if (this.outSince >= 0) {
        this.outSince = -1;
        this.hud.setRingWarn(null);
      }
      return;
    }
    const b = room.bounds || { width: 0, height: 0 };
    const dx = this.sep(this.app.renderYou.x - d.cx, b.width);
    const dy = this.sep(this.app.renderYou.y - d.cy, b.height);
    if (Math.hypot(dx, dy) > (d.r || 9) + RING_SLACK) {
      if (this.outSince < 0) this.outSince = now;
      const left = OUT_MS - (now - this.outSince);
      const text = left > 0 ? `Torna nel cerchio! ${Math.ceil(left / 1000)}` : "Torna nel cerchio!";
      this.hud.setRingWarn(text);
    } else if (this.outSince >= 0) {
      this.outSince = -1;
      this.hud.setRingWarn(null);
    }
  }

  private paintHud(now: number) {
    const room = this.app.room;
    const you = this.youId();
    const arena = Boolean(room && (room.role === "arena" || room.cantoId === "inferno_31"));
    const hub = Boolean(room && (room.role === "hub" || room.cantoId === "inferno_01"));
    if (this.inviteFrom) {
      const frac = this.inviteUntil > now ? (this.inviteUntil - now) / 15000 : 0;
      this.hud.setInviteFrac(frac);
    }
    const inDuel = Boolean(you && activeDuel(this.duels, you));
    if (this.pending && inDuel) {
      this.pending = null;
      this.hud.setPending(null);
    }
    if (this.pending) {
      this.hud.setPending(`In attesa di ${this.pending.toName} · Annulla`);
      this.hud.setChallenge(null);
    } else if (hub && !this.inviteFrom && !inDuel) {
      const id = this.nearestRival(CHALLENGE_CHIP);
      if (id) {
        const pl = room.players?.find((p: any) => String(p.id) === id);
        const name = String(pl?.name || "pellegrino");
        const hint = isCompactUi() ? "" : " (G)";
        this.hud.setChallenge(`⚔ Sfida ${name}${hint}`);
      } else this.hud.setChallenge(null);
    } else this.hud.setChallenge(null);

    const mine = you ? activeDuel(this.duels, you) : null;
    if (mine && (mine.phase === "countdown" || mine.phase === "fight")) {
      const opp = mine.a === you ? mine.b : mine.a;
      const duel = mine as Duel;
      const name = mine.a === you ? duel.bName || "Avversario" : duel.aName || "Avversario";
      const pl = room?.players?.find((p: any) => String(p.id) === opp);
      const hp = this.hpOverride.has(opp) ? this.hpOverride.get(opp)! : Number(pl?.hp) || 0;
      const max = Number(pl?.maxHp) || hp || 1;
      this.hud.setOpponent(name, max > 0 ? hp / max : 0);
    } else this.hud.setOpponent(null, 0);

    if (arena && room?.arena?.round) {
      const n = Number(room.arena.round.n) || 1;
      const left = Number(room.arena.round.endsAt) - Date.now();
      const streakN = Number(room.you?.pvp?.streak) || 0;
      this.hud.setArena(true, `Round ${n}`, fmtClock(left), streakN > 0 ? `Serie ${streakN}` : "");
    } else this.hud.setArena(false, "", "", "");

    const queued = Boolean(room?.you?.pvp?.queued ?? this.queueFlag);
    this.hud.setQueue(queued ? `In coda · ${this.queueSize}` : "Classificata 1v1", queued);

    this.hud.setFeed(this.feed, now);
    const showScore = (this.tabHeld || this.hud.scorePinned) && arena;
    if (showScore) {
      const html = this.scoreHtml(you);
      this.hud.setScore(html, true);
      this.scoreCache = html;
    } else if (!this.hud.score.classList.contains("hidden")) {
      this.hud.setScore(this.scoreCache, false);
    }
    this.paintLocal();
    this.paintPlayers();
  }

  private paintLocal() {
    const g = this.app.youGroup;
    const you = this.app.room?.you;
    if (!g || !you) return;
    if (!this.localLabel) {
      const wrap = document.createElement("div");
      wrap.className = "world-label you-label";
      wrap.innerHTML = `<div class="wl-name"></div><div class="wl-pvp"></div>`;
      const lab = new CSS2DObject(wrap);
      lab.position.set(0, 2.35, 0);
      lab.center.set(0.5, 1);
      g.add(lab);
      this.localLabel = lab;
    }
    const nameEl = this.localLabel.element.querySelector(".wl-name");
    const name = String(you.name || "");
    if (nameEl && nameEl.textContent !== name) nameEl.textContent = name;
    if (name !== this.localName) this.localName = name;
    this.paintPlate(this.localLabel.element, you.pvp, false, Boolean(you.pvp?.downed));
  }

  private paintPlayers() {
    const room = this.app.room;
    if (!room?.players) return;
    for (let i = 0; i < room.players.length; i++) {
      const pl = room.players[i];
      if (!pl || String(pl.id) === this.youId()) continue;
      const rec = this.app.nodes.get(`pl:${pl.id}`);
      if (rec?.hpEl) this.paintRemote(rec.hpEl, pl);
    }
  }

  private paintPlate(el: HTMLElement, pvp: any, hostile: boolean, downed: boolean) {
    let sub: HTMLElement | undefined = this.subs.get(el);
    if (!sub) {
      const found = el.querySelector(".wl-pvp");
      if (found instanceof HTMLElement) sub = found;
      else {
        sub = document.createElement("div");
        sub.className = "wl-pvp";
        const name = el.querySelector(".wl-name");
        if (name && name.parentNode) name.parentNode.insertBefore(sub, name.nextSibling);
        else el.appendChild(sub);
      }
      this.subs.set(el, sub);
    }
    const title = pvp?.title ? String(pvp.title) : "";
    const rating = pvp && pvp.rating != null ? Number(pvp.rating) : 1200;
    const text = title ? `${title} · ${rating}` : String(rating);
    if (sub.textContent !== text) sub.textContent = text;
    el.classList.toggle("pvp-foe", hostile);
    el.classList.toggle("pvp-down", downed);
    el.classList.toggle("title-gilt", title === "Gigante" || title === "Campione");
  }

  private scoreHtml(you: string): string {
    const board = this.app.room?.arena?.board;
    if (!Array.isArray(board) || !board.length) return `<div class="muted">Nessun sangue in questo round</div>`;
    let html = "";
    for (let i = 0; i < board.length; i++) {
      const r = board[i];
      const mine = String(r.id) === you ? " mine" : "";
      html += `<div class="pvp-score-row${mine}">${esc(String(r.name || ""))}<em>${Number(r.kills) || 0}</em><span>${Number(r.streak) || 0}</span></div>`;
    }
    return html;
  }

  private paintBoard(msg: any) {
    const top = Array.isArray(msg.top) ? msg.top : [];
    let html = `<div class="pvp-lb-head"><span>#</span><span>Nome</span><span>Rating</span><span>V–S</span><span>Ucc.</span></div>`;
    for (let i = 0; i < top.length; i++) {
      const r = top[i];
      const title = r.title ? `<i>${esc(String(r.title))}</i>` : "";
      html += `<div class="pvp-lb-row"><span>${Number(r.rank) || i + 1}</span><span>${esc(String(r.name || ""))}${title}</span><span>${Number(r.rating) || 0}</span><span>${Number(r.wins) || 0}-${Number(r.losses) || 0}</span><span>${Number(r.kills) || 0}</span></div>`;
    }
    if (!top.length) html += `<div class="muted">La classifica è ancora vuota</div>`;
    const you = msg.you;
    const purse = this.app.room?.you?.pvp;
    let youHtml = "";
    if (you) {
      youHtml = `<div class="pvp-lb-you">Tu · #${Number(you.rank) || "—"} ${esc(String(you.name || ""))} · ${Number(you.rating) || 0} · ${Number(you.wins) || 0}-${Number(you.losses) || 0}</div>`;
    }
    const peak = Number(purse?.peak ?? you?.rating ?? 0) || 0;
    const best = Number(purse?.bestStreak) || 0;
    const rounds = Number(purse?.roundsWon) || 0;
    const stats = `<div class="pvp-lb-stats">Picco ${peak} · serie migliore ${best} · round vinti ${rounds}</div>`;
    this.hud.setBoard(html, youHtml, stats);
  }

  private toggleQueue() {
    const room = this.app.room;
    const queued = Boolean(room?.you?.pvp?.queued ?? this.queueFlag);
    this.app.socket.pvpQueue(!queued);
  }

  toggleBoard() {
    const el = document.getElementById("pvp-board");
    const opening = !el || el.classList.contains("hidden");
    togglePanel("pvp-board");
    if (opening) this.app.socket.pvpLeaderboard();
  }

  private focusDuel(): Duel | null {
    const you = this.youId();
    let any: Duel | null = null;
    for (let i = 0; i < this.duels.length; i++) {
      const d = this.duels[i]!;
      if (d.phase !== "countdown" && d.phase !== "fight") continue;
      if (!any) any = d;
      if (you && (d.a === you || d.b === you)) return d;
    }
    return any;
  }

  private liveRings(): Duel[] {
    return this.duels;
  }

  private nearestRival(range: number): string | null {
    const room = this.app.room;
    if (!room?.players) return null;
    const you = this.youId();
    const b = room.bounds || { width: 0, height: 0 };
    let best: string | null = null;
    let bestD = range;
    for (let i = 0; i < room.players.length; i++) {
      const pl = room.players[i];
      if (!pl || String(pl.id) === you) continue;
      const at = this.playerXY(pl);
      const dx = this.sep(at.x - this.app.renderYou.x, b.width);
      const dy = this.sep(at.y - this.app.renderYou.y, b.height);
      const d = Math.hypot(dx, dy);
      if (d < bestD) {
        bestD = d;
        best = String(pl.id);
      }
    }
    return best;
  }

  private playerXY(pl: { id: string; x: number; y: number }): { x: number; y: number } {
    const rec = this.app.nodes.get(`pl:${pl.id}`);
    if (rec) {
      _xy.x = rec.group.position.x;
      _xy.y = rec.group.position.z;
    } else {
      _xy.x = pl.x;
      _xy.y = pl.y;
    }
    return _xy;
  }

  private heroPlanar(id: string, self: boolean): { x: number; y: number } {
    if (self) return this.app.renderYou;
    const rec = this.app.nodes.get(`pl:${id}`);
    if (rec) {
      _xy.x = rec.group.position.x;
      _xy.y = rec.group.position.z;
      return _xy;
    }
    return this.app.renderYou;
  }

  private sep(dx: number, size: number): number {
    if (this.app.mapWraps() && size > 0) return wrapDelta(dx, size);
    return dx;
  }

  private expireFeed(now: number) {
    let n = this.feed.length;
    while (n > 0 && now - this.feed[n - 1]!.at > 6000) n--;
    if (n !== this.feed.length) this.feed.length = n;
  }

  private pulseShimmer() {
    const room = this.app.room;
    const you = room?.you;
    if (this.app.youGroup) {
      const on = Boolean(you?.pvp?.invuln) && !you?.pvp?.downed;
      this.fx.shimmer(this.app.youGroup, on);
    }
    if (!room?.players) return;
    for (let i = 0; i < room.players.length; i++) {
      const pl = room.players[i];
      if (!pl || String(pl.id) === this.youId()) continue;
      const rec = this.app.nodes.get(`pl:${pl.id}`);
      if (!rec) continue;
      const on = Boolean(pl.pvp?.invuln) && !pl.pvp?.downed && !(pl.hp != null && pl.hp <= 0);
      this.fx.shimmer(rec.group, on);
    }
  }
}

function reasonLine(reason: string): string {
  if (reason === "down") return "atterramento";
  if (reason === "ring") return "fuori dal cerchio";
  if (reason === "timeout") return "tempo scaduto";
  if (reason === "draw") return "pareggio";
  if (reason === "forfeit") return "resa";
  if (reason === "disconnect") return "sconnessione";
  if (reason === "afk") return "inerzia";
  return reason;
}
