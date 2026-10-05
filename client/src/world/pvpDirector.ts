/**
 * Client PvP: duel / arena messages, telegraphs, juice, and the DEV hook.
 * Hot path (frame) does not allocate; DOM and strings update on change or at 10 Hz.
 */
import * as THREE from "three";
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { showToast, togglePanel, updateStats, isCompactUi } from "../ui/hud";
import { PvpHud, howIt, type FeedRow } from "../ui/pvpHud";
import { ChallengesPanel } from "../ui/challengesPanel";
import { PartyPanel } from "../ui/partyPanel";
import { cantoName } from "./gates";
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
  readonly challenges: ChallengesPanel;
  readonly party: PartyPanel;
  private specTarget: string | null = null;
  private specBar: HTMLElement | null = null;
  private specName = "";
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
  private queueSince = 0;
  private queueLeaveArmed = false;
  private queueDropAt = 0;
  private matchFor = "";
  private matchedAt = 0;
  private seenRound = 0;
  private warned30 = false;
  private warned10 = false;
  private roundDeaths = new Map<string, number>();
  private killCamFrom = 0;
  private killCamSkip = false;
  private killCamBlend = 0;
  private wasDowned = false;
  private lowOn = false;
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
  private _aim = new THREE.Vector3();
  private _want = new THREE.Vector3();
  private app: WorldApp;

  constructor(app: WorldApp) {
    this.app = app;
    this.sfx = new Sfx();
    this.fx = new PvpFx(app.scene);
    this.challenges = new ChallengesPanel((m) => this.app.socket.send(m));
    this.party = new PartyPanel({
      send: (m) => this.app.socket.send(m),
      youId: () => this.youId(),
      cantoName: (id) => cantoName(id ?? undefined),
      nearby: () => {
        const room = this.app.room;
        const you = this.app.renderYou;
        const me = this.youId();
        const out: { id: string; name: string; lv?: number; dist: number }[] = [];
        for (const p of room?.players || []) {
          if (String(p.id) === me) continue;
          const pos = this.app.interp.pos(`pl:${p.id}`, p);
          let dx = pos.x - you.x;
          let dy = pos.y - you.y;
          const b = room?.bounds;
          if (b && this.app.mapWraps()) {
            dx = wrapDelta(dx, b.width);
            dy = wrapDelta(dy, b.height);
          }
          out.push({ id: String(p.id), name: String(p.name || "Pilgrim"), lv: Number(p.lv) || undefined, dist: Math.hypot(dx, dy) });
        }
        return out.sort((a, b) => a.dist - b.dist);
      },
    });
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
      onChallenges: () => this.challenges.toggle(),
      onParty: () => this.party.toggle(),
      onSpectate: () => this.toggleSpectate(),
    });
    this.hud.setMuted(this.sfx.muted);
    window.addEventListener("pointerdown", () => this.skipKillCam(), true);
    window.addEventListener("keydown", (e) => {
      if (e.repeat || e.code === "Tab") return;
      this.skipKillCam();
    });
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
    if (room?.you?.pvp && typeof room.you.pvp.queued === "boolean") {
      const q = Boolean(room.you.pvp.queued);
      if (q && !this.queueFlag && !this.queueSince) this.queueSince = performance.now();
      if (!q) this.queueSince = 0;
      this.queueFlag = q;
    }
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
          msg.reason === "expired" ? "The challenge expired" : `${msg.byName || "Someone"} declines the duel`,
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
        this.onQueueMsg(Boolean(msg.queued), Number(msg.size) || 0);
        return true;
      case "pvp_leaderboard":
        this.paintBoard(msg);
        return true;
      case "challenges":
        this.challenges.paint(msg);
        return true;
      case "party":
      case "party_invite":
        return this.party.onMessage(msg);
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
    if (how === "thorns") this.app.skillVfx?.sparkThorns(pos.x, pos.y, now);
    if (group && !blocked) this.fx.flashHero(group, heavy, now);
    if (blocked) {
      app.combat?.number(pos.x, gy + 2.15, pos.y, 0, "block", tid, now, "schivato", "dmg-pvp");
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
    app.combat?.number(pos.x, gy + 2.15, pos.y, dmg, style, tid, now, undefined, "dmg-pvp");
    if (hitSelf) {
      const src = this.heroPlanar(attacker, false);
      app.kickShake(heavy ? 0.28 : 0.16, app.renderYou.x - src.x, app.renderYou.y - src.y);
      app.hitStopUntil = now + (heavy ? 90 : 55);
      app.camPunch = Math.max(app.camPunch, heavy ? 0.36 : 0.22);
      this.hud.pulseHurt();
      this.hud.pulseHit(this.hitAngle(src.x, src.y));
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

  /** Arena spectator: toggle with the server (it hides you and blocks hits). */
  toggleSpectate() {
    const on = !this.app.room?.you?.pvp?.spec;
    this.app.socket.send({ type: "arena_spectate", on });
  }

  /** Fighters you can watch (spectators are already hidden by the server). */
  private specPool(): any[] {
    const me = this.youId();
    return (this.app.room?.players || []).filter((p: any) => String(p.id) !== me && !(p.hp != null && p.hp <= 0 && !p.pvp?.downed));
  }

  private nextSpecTarget(step = 1) {
    const pool = this.specPool();
    if (!pool.length) {
      this.specTarget = null;
      return;
    }
    const i = pool.findIndex((p: any) => String(p.id) === this.specTarget);
    const n = pool[(i < 0 ? 0 : i + step + pool.length) % pool.length];
    this.specTarget = String(n.id);
  }

  /** Camera focus while spectating, else null (WorldApp follows you). */
  spectateFocus(): { x: number; y: number } | null {
    const room = this.app.room;
    if (!room?.you?.pvp?.spec) return null;
    let pl = room.players?.find((p: any) => String(p.id) === this.specTarget);
    if (!pl) {
      this.nextSpecTarget();
      pl = room.players?.find((p: any) => String(p.id) === this.specTarget);
    }
    if (!pl) return null;
    return this.app.interp.pos(`pl:${pl.id}`, pl);
  }

  private paintSpectate() {
    const room = this.app.room;
    const arena = room?.role === "arena" || room?.cantoId === "inferno_31";
    const spec = Boolean(room?.you?.pvp?.spec);
    this.hud.setSpectate(Boolean(arena), spec);
    if (!spec) {
      if (this.specBar) {
        this.specBar.remove();
        this.specBar = null;
        this.specName = "";
      }
      return;
    }
    if (!this.specBar) {
      const bar = document.createElement("div");
      bar.className = "spec-bar";
      bar.innerHTML = `<button type="button" class="spec-prev" aria-label="Previous fighter">◂</button>
        <span class="spec-label">Spectating</span>
        <button type="button" class="spec-next" aria-label="Next fighter">▸</button>
        <button type="button" class="spec-leave">Fight</button>`;
      bar.querySelector(".spec-prev")!.addEventListener("click", () => this.nextSpecTarget(-1));
      bar.querySelector(".spec-next")!.addEventListener("click", () => this.nextSpecTarget(1));
      bar.querySelector(".spec-leave")!.addEventListener("click", () => this.toggleSpectate());
      document.body.appendChild(bar);
      this.specBar = bar;
    }
    const pl = room?.players?.find((p: any) => String(p.id) === this.specTarget);
    const label = pl ? `Spectating ${pl.name || "a fighter"}${pl.lv ? ` · Lv ${pl.lv}` : ""}` : "Spectating: the pit is empty";
    if (label !== this.specName) {
      this.specName = label;
      this.specBar.querySelector(".spec-label")!.textContent = label;
    }
  }

  frame(rawDt: number, now: number) {
    const dt = rawDt > 0 && rawDt < 0.25 ? rawDt : 0.016;
    this.party.tick(now);
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
    if (this.roundEndUntil) {
      if (now > this.roundEndUntil) {
        this.roundEndUntil = 0;
        this.hud.hideRoundEnd();
      } else {
        const s = Math.max(0, Math.ceil((this.roundEndUntil - now) / 1000));
        this.hud.setRoundNext(`Next round in ${s} s`);
      }
    }
    if (this.queueDropAt && now - this.queueDropAt > 450) this.settleQueueDrop();
    if (this.inviteFrom && this.inviteUntil && now > this.inviteUntil) {
      this.inviteFrom = null;
      this.hud.hideInvite();
    }
    this.expireFeed(now);
    const downed = Boolean(this.app.room?.you?.pvp?.downed);
    const compact = isCompactUi();
    const camMs = compact ? 1000 : 1300;
    this.hud.setKillCam(downed && !this.killCamSkip && now < this.killCamFrom + camMs);
    if (downed && this.respawnUntil) {
      const left = Math.max(0, this.respawnUntil - now);
      this.hud.setRecapTimer(left > 0 ? `Respawn ${Math.ceil(left / 1000)}` : "");
    }
    if (now - this.lastHud < 100) return;
    this.lastHud = now;
    this.paintHud(now);
    this.paintSpectate();
  }

  /**
   * After placeFollowCamera. A down eases a short offset toward the killer and
   * back — no lookAt, so a phone camera never snaps. A scored KO only pushes in.
   */
  nudgeCamera(rawDt: number) {
    const cam = this.app.camera;
    const now = performance.now();
    const compact = isCompactUi();
    const dt = Math.max(0, rawDt);
    const downed = Boolean(this.app.room?.you?.pvp?.downed);
    const camMs = compact ? 900 : 1100;
    const want = downed && !this.killCamSkip && this.killerId && now < this.killCamFrom + camMs ? 1 : 0;
    const k = 1 - Math.exp(-dt * (compact ? 6 : 4));
    this.killCamBlend += (want - this.killCamBlend) * k;
    if (this.killCamBlend < 0.015 && want === 0) this.killCamBlend = 0;
    if (this.killCamBlend > 0.001 && this.killerId) {
      const node = this.app.nodes.get(`pl:${this.killerId}`);
      if (node) {
        const p = node.group.position;
        const dx = p.x - cam.position.x;
        const dz = p.z - cam.position.z;
        const len = Math.hypot(dx, dz) || 1;
        const max = compact ? 0.28 : 1.05;
        const u = this.killCamBlend * max;
        cam.position.x += (dx / len) * u;
        cam.position.z += (dz / len) * u;
        if (!compact) cam.position.y += 0.16 * this.killCamBlend;
      }
    }
    if (this.pushLeft > 0 && this.killCamBlend < 0.25) {
      cam.getWorldDirection(this._fwd);
      const push = (compact ? 0.2 : 0.42) * Math.min(1, this.pushLeft / 0.32);
      cam.position.addScaledVector(this._fwd, push);
      this.pushLeft = Math.max(0, this.pushLeft - dt);
    }
  }

  /** Before the follow lerp: a respawn across the pit cuts, it does not pan. */
  catchRespawnCamera() {
    const downed = Boolean(this.app.room?.you?.pvp?.downed);
    if (this.wasDowned && !downed) {
      this.slowUntil = 0;
      this.pushLeft = 0;
      this.killCamSkip = false;
      this.killCamBlend = 0;
      const dx = this.app.camFollow.x - this.app.renderYou.x;
      const dz = this.app.camFollow.z - this.app.renderYou.y;
      if (dx * dx + dz * dz > 36) {
        this.app.camFollow.x = this.app.renderYou.x;
        this.app.camFollow.z = this.app.renderYou.y;
        this.app.camLead.x = 0;
        this.app.camLead.z = 0;
      }
    }
    this.wasDowned = downed;
  }

  timeScale(): number {
    if (this.slowUntil <= 0) return 1;
    const now = performance.now();
    if (this.slowUntil - now > 1200) {
      this.slowUntil = 0;
      return 1;
    }
    if (now < this.slowUntil) return 0.35;
    const u = (now - this.slowUntil) / 180;
    if (u >= 1) {
      this.slowUntil = 0;
      return 1;
    }
    return 0.35 + 0.65 * u;
  }

  paintRemote(el: HTMLElement, pl: any) {
    this.paintPlate(el, pl?.pvp, this.canTarget(pl), Boolean(pl?.pvp?.downed) || (pl?.hp != null && pl.hp <= 0), pl?.flair);
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
    this.inviteName = String(msg.fromName || "Someone");
    const sec = Number(msg.expiresIn) || 15;
    this.inviteUntil = performance.now() + sec * 1000;
    const title = msg.title ? String(msg.title) : "";
    const rating = Number(msg.rating) || 1200;
    const rival = this.app.room?.players?.find((p: { id?: string; lv?: number }) => String(p.id) === this.inviteFrom);
    const lv = Number(rival?.lv) || 0;
    const named = lv ? `Lv ${lv} ${this.inviteName}` : this.inviteName;
    const who = title ? `${named} (${rating}, ${title})` : `${named} (${rating})`;
    this.hud.showInvite(`${who} challenges you to a duel`);
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
    if (d.ranked && you && (String(d.a) === you || String(d.b) === you) && d.phase !== "over" && this.matchFor !== d.id) {
      this.matchFor = d.id;
      this.matchedAt = performance.now();
      this.queueDropAt = 0;
      this.queueLeaveArmed = false;
      this.hud.flashAnnounce("Match found");
      this.announceUntil = performance.now() + 1400;
      this.sfx.match();
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
    let title = "Draw";
    if (!draw && d.winnerId === you) title = "Victory";
    else if (!draw && mine) title = "Defeat";
    else if (!draw) {
      const name = d.winnerId === d.a ? d.aName || "Winner" : d.bName || "Winner";
      title = name;
    }
    const delta = d.ratingDelta && you && d.ratingDelta[you] != null ? fmtDelta(Number(d.ratingDelta[you])) : "";
    const why = d.reason ? reasonLine(d.reason) : "";
    const sub = [why, delta ? `${delta} rating` : ""].filter(Boolean).join(" · ");
    this.hud.showResult(title, sub);
    this.resultUntil = performance.now() + 3400;
    if (title === "Victory") this.sfx.victory();
    else if (title === "Defeat") {
      if (performance.now() - this.defeatAt > 1800) this.sfx.defeat();
    }
    if (title === "Victory" && d.reason === "down") this.noteKill();
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
    this.killCamSkip = false;
    this.killCamFrom = now;
    this.killCamBlend = 0;
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
    this.hud.showRecap(`Downed by ${name}`, html || "<div>—</div>");
    this.hud.setRecapTimer(wait > 0 ? `Respawn ${Math.ceil(wait / 1000)}` : "");
    this.defeatAt = now;
    this.sfx.defeat();
  }

  private onKill(msg: any) {
    const now = performance.now();
    const you = this.youId();
    const killerId = String(msg.killerId ?? "");
    const victimId = String(msg.victimId ?? "");
    this.roundDeaths.set(victimId, (this.roundDeaths.get(victimId) || 0) + 1);
    const lvName = (id: string, fallback: string) => {
      const pl = this.app.room?.players?.find((p: { id?: string; lv?: number }) => String(p.id) === id);
      const lv = Number(pl?.lv) || 0;
      return lv ? `Lv ${lv} ${fallback}` : fallback;
    };
    this.feed.unshift({
      killer: lvName(killerId, String(msg.killerName || "")),
      victim: lvName(victimId, String(msg.victimName || "")),
      how: String(msg.how || "melee"),
      mine: killerId === you || victimId === you,
      down: victimId === you,
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
    const n = Number(msg.n) || 0;
    const winners = Array.isArray(msg.winners) ? msg.winners : [];
    const board = Array.isArray(msg.board) ? msg.board : [];
    const you = this.youId();
    const purse = this.app.room?.you?.pvp;
    let win = "No kills";
    if (winners.length === 1) {
      win = `Winner · ${esc(String(winners[0].name || ""))} · ${Number(winners[0].kills) || 0}`;
    } else if (winners.length > 1) {
      const names = winners.map((w: { name?: string }) => esc(String(w.name || ""))).join(", ");
      win = `Draw · ${names}`;
    }
    const top = board.slice(0, 3);
    let rows = "";
    for (let i = 0; i < top.length; i++) {
      const r = top[i];
      const id = String(r.id || "");
      const mine = id === you ? " mine" : "";
      const deaths = this.roundDeaths.get(id) || 0;
      const rlv = Number(r.lv) ? `Lv ${Number(r.lv)} ` : "";
      rows += `<div class="pvp-score-row cols${mine}"><span>${i + 1}</span><span>${esc(rlv + String(r.name || ""))}</span><em>${Number(r.kills) || 0}</em><span>${deaths}</span><span>${Number(r.streak) || 0}</span></div>`;
    }
    if (!rows) rows = `<div>No blood this round</div>`;
    const me = board.find((r: { id?: string }) => String(r.id || "") === you);
    const myK = me ? Number(me.kills) || 0 : Number(purse?.roundKills) || 0;
    const myD = this.roundDeaths.get(you) || 0;
    const myS = me ? Number(me.streak) || 0 : Number(purse?.streak) || 0;
    const rating = Number(purse?.rating) || 1200;
    const html =
      `<div class="pvp-roundend-kicker">Pozzo dei Giganti</div>` +
      `<div class="pvp-roundend-title">Round ${n} closed</div>` +
      `<div class="pvp-roundend-win">${win}</div>` +
      `<div class="pvp-score-row cols head"><span>#</span><span>Name</span><span>Kills</span><span>Deaths</span><span>Streak</span></div>` +
      rows +
      `<div class="pvp-roundend-you">You · ${myK} kills · ${myD} deaths · streak ${myS} · rating ${rating}</div>` +
      `<div class="pvp-roundend-live">Round ${n + 1} is open</div>` +
      `<div class="pvp-roundend-next">Next round in 8 s</div>`;
    this.hud.showRoundEnd(html);
    this.roundEndUntil = performance.now() + 8000;
    this.roundDeaths.clear();
    this.warned30 = false;
    this.warned10 = false;
    this.sfx.gong();
  }

  private noteKill() {
    const now = performance.now();
    if (now - this.slowMarked < 700) return;
    this.slowMarked = now;
    const compact = isCompactUi();
    this.slowUntil = now + (compact ? 240 : 300);
    this.pushLeft = compact ? 0.16 : 0.3;
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
      this.lastCount = "Fight!";
      this.hud.setCountdown("Fight!");
      this.sfx.gong();
      return;
    }
    if (this.fightLineUntil && now > this.fightLineUntil && this.lastCount === "Fight!") {
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
      const text = left > 0 ? `Back into the ring! ${Math.ceil(left / 1000)}` : "Back into the ring!";
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
      this.hud.setPending(`Waiting for ${this.pending.toName} · Cancel`);
      this.hud.setChallenge(null);
    } else if (hub && !this.inviteFrom && !inDuel) {
      const id = this.nearestRival(CHALLENGE_CHIP);
      if (id) {
        const pl = room.players?.find((p: any) => String(p.id) === id);
        const name = String(pl?.name || "pilgrim");
        const lv = Number(pl?.lv) || 1;
        const hint = isCompactUi() ? "" : " (G)";
        this.hud.setChallenge(`⚔ Challenge Lv ${lv} ${name}${hint}`);
      } else this.hud.setChallenge(null);
    } else this.hud.setChallenge(null);

    const mine = you ? activeDuel(this.duels, you) : null;
    if (mine && (mine.phase === "countdown" || mine.phase === "fight")) {
      const opp = mine.a === you ? mine.b : mine.a;
      const duel = mine as Duel;
      const name = mine.a === you ? duel.bName || "Opponent" : duel.aName || "Opponent";
      const pl = room?.players?.find((p: any) => String(p.id) === opp);
      const hp = this.hpOverride.has(opp) ? this.hpOverride.get(opp)! : Number(pl?.hp) || 0;
      const max = Number(pl?.maxHp) || hp || 1;
      this.hud.setOpponent(name, max > 0 ? hp / max : 0);
    } else this.hud.setOpponent(null, 0);

    if (arena && room?.arena?.round) {
      const n = Number(room.arena.round.n) || 1;
      const left = Number(room.arena.round.endsAt) - Date.now();
      const streakN = Number(room.you?.pvp?.streak) || 0;
      this.hud.setArena(true, `Round ${n}`, fmtClock(left), streakN > 0 ? `Streak ${streakN}` : "");
      this.hud.arenaClock.classList.toggle("hot", left > 0 && left <= 30000);
      if (n !== this.seenRound) {
        const first = this.seenRound === 0;
        this.seenRound = n;
        this.warned30 = false;
        this.warned10 = false;
        if (!this.roundEndUntil) {
          this.hud.flashAnnounce(`Round ${n}`);
          this.announceUntil = now + (first ? 1200 : 1500);
          if (first) this.sfx.announce();
          else this.sfx.gong();
        }
      }
      if (!this.roundEndUntil && !this.warned30 && left <= 30000 && left > 10000) {
        this.warned30 = true;
        this.hud.flashAnnounce("Thirty seconds");
        this.announceUntil = now + 1400;
        this.sfx.tick();
      }
      if (!this.roundEndUntil && !this.warned10 && left > 0 && left <= 10000) {
        this.warned10 = true;
        this.hud.flashAnnounce("Ten seconds");
        this.announceUntil = now + 1400;
        this.sfx.tick();
      }
    } else {
      this.seenRound = 0;
      this.warned30 = false;
      this.warned10 = false;
      this.hud.arenaClock.classList.remove("hot");
      this.hud.setArena(false, "", "", "");
    }

    const queued = Boolean(room?.you?.pvp?.queued ?? this.queueFlag);
    if (queued) {
      if (!this.queueSince) this.queueSince = now;
      const elapsed = Math.max(0, now - this.queueSince);
      const band = 80 + Math.floor(elapsed / 3000) * 100;
      const mm = Math.floor(elapsed / 60000);
      const ss = Math.floor(elapsed / 1000) % 60;
      const clock = `${mm}:${ss < 10 ? "0" : ""}${ss}`;
      this.hud.setQueue(`Queued ${clock} · Cancel`, true, `±${band} · ${this.queueSize} waiting`, clock);
    } else this.hud.setQueue("Ranked 1v1", false, "", "");

    const hp = Number(room?.you?.hp) || 0;
    const maxHp = Number(room?.you?.maxHp) || 0;
    const low = (arena || inDuel) && !room?.you?.pvp?.downed && maxHp > 0 && hp > 0 && hp / maxHp <= 0.3;
    if (low !== this.lowOn) {
      this.lowOn = low;
      this.hud.setLowHp(low);
    }

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
    const lv = Number(you.lv ?? you.prog?.level) || 1;
    const plate = `Lv ${lv} ${name}`;
    if (nameEl && nameEl.textContent !== plate) nameEl.textContent = plate;
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

  private paintPlate(el: HTMLElement, pvp: any, hostile: boolean, downed: boolean, flair?: any) {
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
    // A worn challenge title (cosmetic, challenges panel) replaces the computed PvP title
    const worn = flair?.t ? String(flair.t) : "";
    const title = worn || (pvp?.title ? String(pvp.title) : "");
    const rating = pvp && pvp.rating != null ? Number(pvp.rating) : 1200;
    const mark = flair?.f ? String(flair.f) : "";
    el.classList.toggle("flair-laurel", mark === "laurel");
    el.classList.toggle("flair-ember", mark === "ember");
    // The rating only means something where pilgrims may fight (hub duels, the arena):
    // in the PvE circles a plate carries the worn title alone
    const pveCircle = /^inferno_0[5-8]$/.test(String(this.app.room?.cantoId || ""));
    const text = pveCircle ? title : title ? `${title} · ${rating}` : String(rating);
    if (sub.textContent !== text) sub.textContent = text;
    sub.hidden = !text;
    el.classList.toggle("pvp-foe", hostile);
    el.classList.toggle("pvp-down", downed);
    el.classList.toggle("title-gilt", title === "Giant" || title === "Champion" || title === "Weekly Victor");
  }

  private scoreHtml(you: string): string {
    const board = this.app.room?.arena?.board;
    if (!Array.isArray(board) || !board.length) return `<div class="muted">No blood this round</div>`;
    let html = "";
    for (let i = 0; i < board.length; i++) {
      const r = board[i];
      const mine = String(r.id) === you ? " mine" : "";
      const deaths = this.roundDeaths.get(String(r.id || "")) || 0;
      const slv = Number(r.lv) ? `Lv ${Number(r.lv)} ` : "";
      html += `<div class="pvp-score-row${mine}">${esc(slv + String(r.name || ""))}<em>${Number(r.kills) || 0}</em><span class="d">${deaths}</span><span>${Number(r.streak) || 0}</span></div>`;
    }
    return html;
  }

  private paintBoard(msg: any) {
    const top = Array.isArray(msg.top) ? msg.top : [];
    let html = `<div class="pvp-lb-head"><span>#</span><span>Name</span><span>Rating</span><span>W–L</span><span>Kills</span></div>`;
    for (let i = 0; i < top.length; i++) {
      const r = top[i];
      const title = r.title ? `<i>${esc(String(r.title))}</i>` : "";
      const blv = Number(r.lv) ? `Lv ${Number(r.lv)} ` : "";
      html += `<div class="pvp-lb-row"><span>${Number(r.rank) || i + 1}</span><span>${esc(blv + String(r.name || ""))}${title}</span><span>${Number(r.rating) || 0}</span><span>${Number(r.wins) || 0}-${Number(r.losses) || 0}</span><span>${Number(r.kills) || 0}</span></div>`;
    }
    if (!top.length) html += `<div class="muted">The leaderboard is still empty</div>`;
    const you = msg.you;
    const purse = this.app.room?.you?.pvp;
    let youHtml = "";
    if (you) {
      youHtml = `<div class="pvp-lb-you">You · #${Number(you.rank) || "—"} ${esc(String(you.name || ""))} · ${Number(you.rating) || 0} · ${Number(you.wins) || 0}-${Number(you.losses) || 0}</div>`;
    }
    const peak = Number(purse?.peak ?? you?.rating ?? 0) || 0;
    const best = Number(purse?.bestStreak) || 0;
    const rounds = Number(purse?.roundsWon) || 0;
    const stats = `<div class="pvp-lb-stats">Peak ${peak} · best streak ${best} · rounds won ${rounds}</div>`;
    this.hud.setBoard(html, youHtml, stats);
  }

  private toggleQueue() {
    const room = this.app.room;
    const queued = Boolean(room?.you?.pvp?.queued ?? this.queueFlag);
    this.queueLeaveArmed = queued;
    this.app.socket.pvpQueue(!queued);
  }

  /** queued:false arrives before duel_state on a match. Wait, then say why the queue dropped. */
  private onQueueMsg(queued: boolean, size: number) {
    this.queueSize = size;
    const was = this.queueFlag;
    this.queueFlag = queued;
    if (queued) {
      if (!this.queueSince) this.queueSince = performance.now();
      this.queueDropAt = 0;
      this.queueLeaveArmed = false;
      return;
    }
    this.queueSince = 0;
    const matched = this.matchedAt && performance.now() - this.matchedAt < 2500;
    if (was && !this.inRankedFight() && !matched) this.queueDropAt = performance.now();
    else this.queueDropAt = 0;
  }

  private settleQueueDrop() {
    this.queueDropAt = 0;
    if (this.inRankedFight()) return;
    if (this.matchedAt && performance.now() - this.matchedAt < 2500) return;
    if (this.queueLeaveArmed) {
      this.queueLeaveArmed = false;
      showToast("You left the queue", "info");
      return;
    }
    const room = this.app.room;
    const arena = Boolean(room && (room.role === "arena" || room.cantoId === "inferno_31"));
    showToast(arena ? "Queue closed" : "The queue is only in the well", "info");
  }

  private inRankedFight(): boolean {
    const you = this.youId();
    if (!you) return false;
    for (let i = 0; i < this.duels.length; i++) {
      const d = this.duels[i]!;
      if (!d.ranked || d.phase === "over") continue;
      if (d.a === you || d.b === you) return true;
    }
    return false;
  }

  private skipKillCam() {
    if (!this.app.room?.you?.pvp?.downed) return;
    if (this.killCamSkip) return;
    this.killCamSkip = true;
    this.hud.setKillCam(false);
  }

  /**
   * Degrees, 0 = threat ahead of the camera (chevron up).
   * right = (−fwd.z, 0, fwd.x). Check: fwd (0,0,−1) → right (1,0,0).
   */
  private hitAngle(ax: number, ay: number): number {
    const cam = this.app.camera;
    cam.getWorldDirection(this._aim);
    this._aim.y = 0;
    const len = Math.hypot(this._aim.x, this._aim.z);
    if (len < 1e-4) return 0;
    const fx = this._aim.x / len;
    const fz = this._aim.z / len;
    const rx = -fz;
    const rz = fx;
    const you = this.app.renderYou;
    const dx = ax - you.x;
    const dz = ay - you.y;
    return (Math.atan2(dx * rx + dz * rz, dx * fx + dz * fz) * 180) / Math.PI;
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
  if (reason === "down") return "knockdown";
  if (reason === "ring") return "out of the ring";
  if (reason === "timeout") return "time expired";
  if (reason === "draw") return "draw";
  if (reason === "forfeit") return "forfeit";
  if (reason === "disconnect") return "disconnect";
  if (reason === "afk") return "idle";
  return reason;
}
