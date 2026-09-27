/**
 * Local hero motor: everything about how YOUR pilgrim moves and fights on
 * screen, kept out of WorldApp. Owns
 *  - facing: yaw turns toward the aim at a finite rate (faster when attacking),
 *  - the sword swing timeline: anticipation → contact (the attack packet is sent
 *    at contact, via host.onSwingContact) → follow-through → recovery, and the
 *    three-swing combo (forehand, backhand, overhead finisher),
 *  - a small root step into the cut and a movement slow while swinging,
 *  - the dash as a short eased tween (server stays authoritative) + streak/dust,
 *  - the death collapse (pinned at the fall spot) before the respawn teleport,
 *  - the blade trail, footstep dust on foot plants,
 *  - pooled blade trails for remote pilgrims' swings.
 *
 * Timing: the swing / dash / death timelines run on the motor's own combat
 * clock (real frame time, NOT the world's animT, which is clamped to 50 ms per
 * frame and slowed during hit-stop), so the swing cadence, the attack packet
 * and the respawn pin don't stretch with frame rate or landed hits. The pose
 * shows a visual progress that freezes with the world's hit-stop and catches
 * up after it (the blow still "sticks", the rhythm doesn't slip).
 */
import * as THREE from "three";
import type { Vec2 } from "../render/smoothing";
import { setPlanar, yawFromPlanar } from "./frames";
import {
  SWING_U_COCK,
  SWING_U_HIT,
  captureBladeChain,
  humanoidCast,
  humanoidDash,
  humanoidDeath,
  humanoidFlinch,
  humanoidRevive,
  humanoidSwing,
  humanoidSwingU,
  sampleBlade,
  takeFootPlant,
  tickHumanoid,
} from "./heroAnim";
import { BladeTrail, DashStreak, DustPool } from "./heroFx";

/**
 * One swing = the attack busy time. The server's PLAYER_ATK_CD is 0.42 s with a
 * 60 ms jitter grace that is carried forward (room.mjs: sustained cap stays one
 * blow per 0.42 s), so a swing every 440 ms (contact ±1 frame, ±60 ms network
 * jitter) is never dropped — no phantom slashes.
 */
export const SWING_MS = 440;
/** Attack packet goes out when the blade meets the target. */
export const SWING_CONTACT_MS = Math.round(SWING_U_HIT * SWING_MS);
export const DASH_MS = 160;
/**
 * Collapse shown at the fall spot before the respawn teleport. Short: the server
 * has already respawned you with RESPAWN_IFRAMES = 2 s, and this is eaten from it.
 */
/** The fall is held a beat before the cut to the entrance (under the dark veil: hud.ts). */
export const DEATH_POSE_MS = 720;
/** A swing that starts within this long after the previous one ended chains the combo. */
const COMBO_GAP_MS = 320;
const TURN_RATE = 15; // rad/s
const TURN_RATE_ATTACK = 30;
const STEP_IN = 0.34; // world units of root step into a cut

export interface HeroHost {
  scene: THREE.Scene;
  camera: THREE.Camera;
  youGroup: THREE.Group | null;
  renderYou: Vec2;
  velX: number;
  velY: number;
  aimX: number;
  aimY: number;
  animT: number;
  /** performance.now() deadline of the world's hit-stop (freezes the visual swing) */
  hitStopUntil: number;
  standY(x: number, y: number, lift?: number): number;
  /** Live render position of a foe (null when gone/dead). */
  foeRenderPos(id: string): Vec2 | null;
  /** Blade reached the target: send the attack now (range/liveness checks are the host's). */
  onSwingContact(targetId: string | null, kind: number): void;
  /** Death pose finished: jump to the server's respawn point. */
  onReviveTeleport(): void;
}

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

/** Blade trails lent to remote pilgrims while they swing (hidden when idle: no draw — BladeTrail.clear). */
const REMOTE_TRAILS = 2;
type RemoteTrail = {
  trail: BladeTrail;
  root: THREE.Object3D | null;
  prev: Float32Array;
  until: number;
  t: number;
  dt: number;
  push: (tip: THREE.Vector3, base: THREE.Vector3, k: number) => void;
};

export class HeroMotor {
  readonly trail = new BladeTrail();
  readonly dust = new DustPool();
  readonly streak = new DashStreak();
  private yaw = 0;
  private yawInit = false;
  /** combat clock (ms of real frame time) */
  private now = 0;
  // swing
  private swingStart = -1e9;
  /** pose progress of the swing (lags the combat clock only through hit-stop) */
  private uVis = -1;
  private swingKind = 0;
  private swingTarget: string | null = null;
  private contactSent = true;
  private combo = -1;
  private bladePrev = new Float32Array(16);
  private bladeSampling = false;
  // dash
  private dashStart = -1;
  private dashFrom: Vec2 = { x: 0, y: 0 };
  private dashTo: Vec2 = { x: 0, y: 0 };
  // death
  private deathStart = -1;
  private deathSpot: Vec2 = { x: 0, y: 0 };
  private toes: [THREE.Object3D | null, THREE.Object3D | null] | null = null;
  private sampleT = 0;
  private sampleDt = 0;
  private pushSample = (tip: THREE.Vector3, base: THREE.Vector3, k: number) =>
    this.trail.push(tip, base, this.sampleT - (1 - k) * this.sampleDt);

  private remote: RemoteTrail[] = [];
  /**
   * External carry (planar u/s — a canto gust): the legs step with it. Cloth wind
   * (planar, ~0..1.4): the cape streams with it. A canto mechanic sets both per frame.
   */
  extVelX = 0;
  extVelY = 0;
  clothWindX = 0;
  clothWindY = 0;

  constructor(private host: HeroHost) {
    host.scene.add(this.trail.mesh, this.dust.group, this.streak.mesh);
    for (let i = 0; i < REMOTE_TRAILS; i++) {
      const r: RemoteTrail = {
        trail: new BladeTrail(this.trail.mesh.material as THREE.Material),
        root: null,
        prev: new Float32Array(16),
        until: 0,
        t: 0,
        dt: 0,
        push: (tip, base, k) => r.trail.push(tip, base, r.t - (1 - k) * r.dt),
      };
      host.scene.add(r.trail.mesh);
      this.remote.push(r);
    }
  }

  /** Gold trail in Avarice, warm steel elsewhere. */
  setPalette(gold: boolean) {
    const tint = gold ? 0xffdc8a : 0xfff2d8;
    this.trail.setTint(tint);
    for (const r of this.remote) r.trail.setTint(tint);
  }

  /** A remote pilgrim began a swing (its pose is already started): lend it a trail. */
  remoteSwing(root: THREE.Object3D, kind: number) {
    let r = this.remote.find((x) => x.root === root) ?? this.remote.find((x) => !x.root);
    if (!r) r = this.remote.reduce((a, b) => (a.until < b.until ? a : b));
    r.root = root;
    r.until = this.host.animT + SWING_MS + 250;
    r.trail.clear();
    r.trail.intensity = kind === 2 ? 0.8 : 0.65;
    r.trail.life = kind === 2 ? 140 : 120;
    captureBladeChain(root, r.prev);
  }

  /** Right after a remote pilgrim's pose tick: sample its blade into its trail. */
  remoteTick(root: THREE.Object3D, dt: number) {
    const r = this.remote.find((x) => x.root === root);
    if (!r) return;
    const t = this.host.animT;
    const u = humanoidSwingU(root, t);
    if (u >= SWING_U_COCK - 0.03 && u < 0.52) {
      r.t = t;
      r.dt = dt * 1000;
      sampleBlade(root, r.prev, 5, r.push);
    } else captureBladeChain(root, r.prev);
    r.trail.update(t);
  }

  /** A remote pilgrim left: take its trail back. */
  releaseRemote(root: THREE.Object3D) {
    for (const r of this.remote) {
      if (r.root !== root) continue;
      r.root = null;
      r.trail.clear();
    }
  }

  /** Advance the combat clock by the real frame time (s); once per frame before tick. */
  advance(dtRaw: number) {
    this.now += Math.min(0.25, Math.max(0, dtRaw)) * 1000;
  }

  /** Swing progress on the combat clock, or −1. */
  swingU(t = this.now): number {
    const u = (t - this.swingStart) / SWING_MS;
    return u >= 0 && u < 1 ? u : -1;
  }

  dying(): boolean {
    return this.deathStart >= 0;
  }

  dashing(): boolean {
    return this.dashStart >= 0;
  }

  canSwing(): boolean {
    return !this.dying() && !this.dashing() && this.swingU() < 0;
  }

  canDash(): boolean {
    return !this.dying() && !this.dashing();
  }

  /** Start a swing at a foe (or the air); returns the combo kind. */
  startSwing(targetId: string | null): number {
    const t = this.now;
    const sinceEnd = t - (this.swingStart + SWING_MS);
    this.combo = sinceEnd >= 0 && sinceEnd < COMBO_GAP_MS ? (this.combo + 1) % 3 : 0;
    this.swingStart = t;
    this.swingKind = this.combo;
    this.swingTarget = targetId;
    this.contactSent = false;
    this.uVis = 0;
    this.trail.clear();
    this.bladeSampling = false;
    if (this.host.youGroup) humanoidSwing(this.host.youGroup, this.host.animT, this.swingKind, SWING_MS);
    return this.swingKind;
  }

  /** Movement multiplier while swinging (planted through the cut, free again in recovery). */
  moveScale(): number {
    const u = this.swingU();
    if (u < 0) return 1;
    if (u < 0.5) return 0.28;
    return 0.28 + 0.72 * ((u - 0.5) / 0.5);
  }

  /** Root step into the cut (world planar velocity), only when there is room. */
  stepVelocity(out: Vec2): Vec2 {
    out.x = 0;
    out.y = 0;
    const u = this.swingU();
    const u0 = SWING_U_COCK - 0.08;
    if (u < u0 || u > SWING_U_HIT || !this.swingTarget) return out;
    const p = this.host.foeRenderPos(this.swingTarget);
    if (!p) return out;
    const dx = p.x - this.host.renderYou.x;
    const dy = p.y - this.host.renderYou.y;
    const d = Math.hypot(dx, dy);
    if (d < 1.7) return out;
    const sp = STEP_IN / (((SWING_U_HIT - u0) * SWING_MS) / 1000);
    out.x = (dx / d) * sp;
    out.y = (dy / d) * sp;
    return out;
  }

  startDash(from: Vec2, to: Vec2) {
    const t = this.host.animT;
    this.dashStart = this.now;
    this.dashFrom = { x: from.x, y: from.y };
    this.dashTo = { x: to.x, y: to.y };
    this.swingStart = -1e9;
    this.uVis = -1;
    this.contactSent = true;
    this.trail.clear();
    const g = this.host.youGroup;
    if (g) humanoidDash(g, t, DASH_MS);
    const y0 = this.host.standY(from.x, from.y);
    _v.set(from.x, y0, from.y);
    _v2.set(to.x, this.host.standY(to.x, to.y), to.y);
    this.streak.begin(_v, _v2, t, DASH_MS);
    this.dust.spawn(from.x, y0 + 0.05, from.y, t, 1.5, 0.5, 480);
  }

  /** Planar position the hero is pinned to this frame (dash tween / death), or null. */
  pinnedPos(out: Vec2): Vec2 | null {
    const t = this.now;
    if (this.deathStart >= 0) {
      out.x = this.deathSpot.x;
      out.y = this.deathSpot.y;
      return out;
    }
    if (this.dashStart < 0) return null;
    const u = (t - this.dashStart) / DASH_MS;
    if (u >= 1) {
      this.dashStart = -1;
      out.x = this.dashTo.x;
      out.y = this.dashTo.y;
      this.dust.spawn(out.x, this.host.standY(out.x, out.y, 0.05), out.y, this.host.animT, 1.3, 0.45, 460);
      return out;
    }
    // ease-out cubic: explosive start, soft arrival
    const k = 1 - Math.pow(1 - Math.max(0, u), 3);
    out.x = this.dashFrom.x + (this.dashTo.x - this.dashFrom.x) * k;
    out.y = this.dashFrom.y + (this.dashTo.y - this.dashFrom.y) * k;
    return out;
  }

  startDeath(at: Vec2) {
    if (this.deathStart >= 0) return;
    this.deathStart = this.now;
    this.deathSpot = { x: at.x, y: at.y };
    this.dashStart = -1;
    this.swingStart = -1e9;
    this.uVis = -1;
    this.contactSent = true;
    if (this.host.youGroup) humanoidDeath(this.host.youGroup, this.host.animT);
  }

  /** Blow landed on the hero from world planar direction (toward the attacker). */
  flinch(fromX: number, fromY: number) {
    if (this.dying() || !this.host.youGroup) return;
    humanoidFlinch(this.host.youGroup, fromX, fromY, this.host.animT);
  }

  cast(spellId: string, windMs: number) {
    const g = this.host.youGroup;
    if (!g || this.dying()) return;
    const kind = spellId === "gale_bolt" ? "gale" : spellId === "whirl_ward" ? "ward" : "burst";
    humanoidCast(g, kind, this.host.animT, windMs);
  }

  /**
   * Per frame, after the planar position is final (draw). `dt` is the world's
   * frame step (animT), `dtRaw` the real one (combat clock).
   */
  update(dt: number, opts: { channeling: boolean; dtRaw?: number }) {
    const dtRaw = opts.dtRaw ?? dt;
    const h = this.host;
    const g = h.youGroup;
    if (!g) return;
    const t = h.animT;
    setPlanar(g.position, h.renderYou.x, h.renderYou.y, h.standY(h.renderYou.x, h.renderYou.y));

    // death: hold the fall, then hand over to the respawn and rise from a kneel
    if (this.deathStart >= 0 && this.now - this.deathStart > DEATH_POSE_MS) {
      this.deathStart = -1;
      h.onReviveTeleport();
      humanoidRevive(g, t);
      setPlanar(g.position, h.renderYou.x, h.renderYou.y, h.standY(h.renderYou.x, h.renderYou.y));
    }

    // facing: re-aim at a live target until contact, turn at a finite rate
    const u = this.swingU();
    if (u >= 0 && u < SWING_U_HIT && this.swingTarget) {
      const p = h.foeRenderPos(this.swingTarget);
      if (p) {
        const dx = p.x - h.renderYou.x;
        const dy = p.y - h.renderYou.y;
        if (dx * dx + dy * dy > 0.01) {
          h.aimX = dx;
          h.aimY = dy;
        }
      }
    }
    if (this.deathStart < 0 && (h.aimX !== 0 || h.aimY !== 0)) {
      const want = yawFromPlanar(h.aimX, h.aimY);
      if (!this.yawInit) {
        this.yaw = want;
        this.yawInit = true;
      }
      const diff = Math.atan2(Math.sin(want - this.yaw), Math.cos(want - this.yaw));
      const rate = u >= 0 || this.dashing() ? TURN_RATE_ATTACK : TURN_RATE;
      const maxStep = rate * dt;
      // exponential approach capped at the turn rate: quick start, soft settle
      const stepAmt = diff * (1 - Math.exp(-dt * 22));
      this.yaw += Math.max(-maxStep, Math.min(maxStep, stepAmt));
    }
    g.rotation.y = this.yaw;

    // contact: send the attack when the blade arrives
    if (!this.contactSent && u >= SWING_U_HIT) {
      this.contactSent = true;
      h.onSwingContact(this.swingTarget, this.swingKind);
    } else if (!this.contactSent && u < 0) {
      // swing was cut short by a hitch longer than the whole cycle: still resolve it
      this.contactSent = true;
      h.onSwingContact(this.swingTarget, this.swingKind);
    }

    // visual swing progress: = combat progress, except it holds through the
    // world's hit-stop and then catches up (the cadence never slips)
    if (u < 0) this.uVis = -1;
    else {
      const du = (dt * 1000) / SWING_MS;
      const lag = u - Math.max(0, this.uVis);
      if (this.uVis < 0 || lag < 0) this.uVis = u;
      else if (performance.now() < h.hitStopUntil) this.uVis += Math.min(lag, du);
      else this.uVis = lag < 0.004 ? u : this.uVis + Math.max(Math.min(lag, du), lag * (1 - Math.exp(-dtRaw * 30)));
    }
    const uv = this.uVis;

    const vx = this.dashing() ? 0 : h.velX + this.extVelX;
    const vz = this.dashing() ? 0 : h.velY + this.extVelY;
    tickHumanoid(g, {
      moving: Math.hypot(vx, vz) > 0.4,
      tMs: t,
      attacking: false,
      speed: Math.hypot(vx, vz),
      channeling: opts.channeling,
      swingU: uv,
      vx,
      vz,
      windX: this.clothWindX,
      windZ: this.clothWindY,
    });

    // blade trail: sub-frame arc samples from the strike through the follow-through
    const sampling = uv >= SWING_U_COCK - 0.03 && uv < 0.52;
    if (sampling) {
      if (!this.bladeSampling) {
        this.bladeSampling = true;
        this.trail.intensity = this.swingKind === 2 ? 0.95 : 0.8;
        this.trail.life = this.swingKind === 2 ? 140 : 120;
      }
      this.sampleT = t;
      this.sampleDt = dt * 1000;
      sampleBlade(g, this.bladePrev, dt > 0.025 ? 8 : 5, this.pushSample);
    } else {
      this.bladeSampling = false;
      captureBladeChain(g, this.bladePrev);
    }
    this.trail.update(t);
    // lent trails fade out (their samples come from remoteTick), then go back
    for (const r of this.remote) {
      if (!r.root) continue;
      r.trail.update(t);
      if (t > r.until) {
        r.root = null;
        r.trail.clear();
      }
    }

    // footstep dust on the plant (running only)
    const plant = takeFootPlant(g);
    if (plant && Math.hypot(h.velX, h.velY) > 4.5) {
      if (!this.toes) this.toes = [g.getObjectByName("toeL") ?? null, g.getObjectByName("toeR") ?? null];
      const toe = this.toes[plant === 1 ? 0 : 1];
      if (toe) {
        toe.getWorldPosition(_v);
        this.dust.spawn(_v.x, h.standY(_v.x, _v.z, 0.04), _v.z, t, 0.75, 0.32, 380);
      }
    }
    this.dust.update(t);
    this.streak.update(t, g.position, h.camera);
  }
}
