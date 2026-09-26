/**
 * Avarice (inferno_07) canto mechanic, client side — the visual + guidance half of
 * server/src/cantoMech/avarice.mjs. Hook contract: ./index.ts.
 *
 *  - Processions: the weights roll on the procession clock (snapshot `mech.t`, the phase
 *    now, synced with half a round trip and smoothed), drawn by avariceRollers.ts; clash
 *    beats (dust, sparks, the crowds' cries, a camera kick by distance) come from the same
 *    clock. The worn tracks and clash rings are ground dressing (avariceGround.ts).
 *  - Plutus: swells with every coin he swallows (mech.inf: a bigger body, a gold shield
 *    ring), coins stream into him (ava_absorb), he calls them («Pape Satàn, pape Satàn
 *    aleppe!», ava_call), the bell breaks him like a sail when the mast snaps
 *    (ava_collapse: he sags for the collapse), and at half he hurls a weight down a lane
 *    (ava_sweep: the extra roller instance rolls the telegraphed line).
 *  - Coins leaving without dying (ava_absorb swallowed / ava_sink sunk) are dropped
 *    quietly here, before the server's entity_removed (no kill beat, no death collapse).
 *  - Colours and poses for the new telegraph kinds (registerTelePalette /
 *    registerAttackPose), the Crush-pressure fog, and the objective line: the clash rhythm
 *    near the clash points, a weight's next pass where the road crosses a lane, the
 *    Counterweight, the Fiorini, and the bell when Plutus is swollen enough to break.
 * Per frame: no allocation (fixed pools, reused vectors / matrices).
 */
import * as THREE from "three";
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import type { CantoMech } from "./index";
import type { WorldApp } from "../WorldApp";
import type { Objective } from "../objective";
import { AvariceRollers, restartLine, type RollerHost } from "../avariceRollers";
import { PROC, lanePassIn, nearestLane, untilClash, type LaneHit } from "../avariceProcession";
import { acquireFxMote, acquireFxRing, releaseFx, spawnSparks } from "../fx";
import { setPlanar } from "../frames";
import { registerAttackPose, type PoseFn } from "../mobAnim";
import { registerTelePalette, visibleWindupMs } from "../telegraphs";
import { isCompactUi } from "../../ui/hud";

const PLUTUS = "hoard_crush";
const MOTES = 14;
/** Coin he must hold before the Ledger Bell breaks him (server BELL_BREAK_MIN). */
const BELL_BREAK_MIN = 2;
/** The west clash's coin spill lands this long after the clash (server SPILL_LAG). */
const SPILL_LAG = 0.45;
/** Rolling-weight footprint along the lane + a pilgrim's pad (server ROLL_HALF_L + pad). */
const LANE_REACH = PROC.R + 0.55;
/** Below this a weight only creeps (server ROLL_MIN_SPEED): it does not crush. */
const ROLL_MIN_SPEED = 2.2;
/** Procession weights / hurled weight / charge: bronze-white on red-black. */
const PAL_WEIGHT = { base: 0x1c0703, hot: 0xd8581c, rim: 0xfff0c8 };
/** The west clash's coin spill: gold — a second beat, read apart from the clash. */
const PAL_SPILL = { base: 0x140a02, hot: 0xc89020, rim: 0xffe8a0 };
/** Plutus's hoard (pulse, fall): pale gold. */
const PAL_HOARD = { base: 0x160c02, hot: 0xe0a020, rim: 0xfff4c0 };
/** His hoard in the tip of the ring (server PILES). */
const PILES = [
  { x: 120.5, y: 48.2 },
  { x: 120.5, y: 53.2 },
];

const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const easeOut = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : 1 - (1 - t) * (1 - t));
/** windup builds, then drains through the strike (mobAnim's STRIKE ≈ 0.32 of recovery) */
const wind = (u: number, r: number) => (r > 0 ? Math.max(0, 1 - r / 0.19) : smooth(u));
const strike = (r: number) => (r <= 0 ? 0 : r < 0.32 ? easeOut(r / 0.32) : 1 - smooth((r - 0.32) / 0.68));

/** Plutus heaves a great weight up and back, then shoves it down the lane. */
const plutusRollPose: PoseFn = (u, r, _st, out) => {
  const w = wind(u, r);
  const s = strike(r);
  out.rx = 0.26 * w - 0.32 * s;
  out.y = 0.34 * w - 0.12 * s;
  out.fz = 0.45 * s;
  out.sy = 1 + 0.05 * w - 0.06 * s;
};

/** The Counterweight settles back on its haunches, then lunges into its roll. */
const cwChargePose: PoseFn = (u, r, _st, out) => {
  const w = wind(u, r);
  const s = strike(r);
  out.rx = 0.34 * w - 0.5 * s;
  out.y = -0.14 * w + 0.05 * s;
  out.sy = 1 - 0.12 * w + 0.08 * s;
  out.sx = 1 + 0.07 * w;
  out.sz = 1 + 0.07 * w;
  out.fz = 0.6 * s;
};

type Mote = { mesh: THREE.Mesh | null; sx: number; sy: number; sh: number; t0: number; dur: number };

class AvariceView {
  private rollers: AvariceRollers;
  private host: RollerHost;
  /** local procession time = performance.now()/1000 + tOff */
  private tOff = 0;
  private synced = false;
  private inf = 0;
  private infView = 0;
  private colUntil = 0;
  private colStart = 0;
  private colDur = 4000;
  private fallMs = 600;
  private tilted = false;
  private shield: THREE.Mesh;
  private shieldMat: THREE.MeshBasicMaterial;
  private motes: Mote[] = [];
  private line: { obj: CSS2DObject; el: HTMLSpanElement; until: number; go: number };
  private pressureAt = 0;
  private lastSub = "";
  private lastSubKey = -1;
  private readonly lane: LaneHit = { k: -1, s: 0, d: Infinity };

  constructor(private app: WorldApp) {
    this.host = {
      scene: app.scene,
      heightAt: (x, z) => app.standY(x, z),
      surfaceY: (x, y, lift = 0) => app.surfaceY(x, y, lift),
      youX: () => app.renderYou.x,
      youY: () => app.renderYou.y,
      animT: () => app.animT,
      pushImpact(mesh, dur, from, to) {
        app.impacts.push({ mesh, start: app.animT, dur, from, to });
      },
      pushSparks(x, y, h, color, dur) {
        if (app.sparks.length >= 4) return false;
        const b = spawnSparks(x, y, h, color, app.animT);
        b.dur = dur;
        app.scene.add(b.points);
        app.sparks.push(b);
        return true;
      },
      flashLight(x, y, h, color, intensity) {
        app.hitLight.color.setHex(color);
        app.hitLight.intensity = Math.max(app.hitLight.intensity, intensity);
        setPlanar(app.hitLight.position, x, y, h);
      },
      kick(shake, punch, dirX, dirY) {
        app.kickShake(shake, dirX, dirY);
        app.camPunch = Math.max(app.camPunch, punch);
        app.camFovKick = Math.max(app.camFovKick, punch * 2.4);
      },
      compact: () => isCompactUi(),
    };
    this.rollers = new AvariceRollers(this.host);
    // Plutus's swollen-with-coin shield (one ring; radius grows with every coin)
    this.shieldMat = new THREE.MeshBasicMaterial({
      color: 0xffcc55,
      transparent: true,
      opacity: 0.3,
      side: THREE.DoubleSide,
      forceSinglePass: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.shield = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.0, isCompactUi() ? 40 : 56), this.shieldMat);
    this.shield.rotation.x = -Math.PI / 2;
    this.shield.name = "plutusShield";
    // (kept in the scene while hidden: the shader prewarm compiles it with the canto)
    this.shield.visible = false;
    app.scene.add(this.shield);
    for (let i = 0; i < MOTES; i++) this.motes.push({ mesh: null, sx: 0, sy: 0, sh: 0, t0: 0, dur: 1 });
    const wrap = document.createElement("div");
    wrap.className = "ava-plutus-wrap";
    const el = document.createElement("span");
    el.className = "ava-plutus-line";
    wrap.appendChild(el);
    const obj = new CSS2DObject(wrap);
    // (top-centre at his feet: the line hangs under him — clear of his name plate, the
    // gate label and the top HUD, which sit above him when the camera frames the dais)
    obj.center.set(0.5, 0);
    obj.visible = false;
    app.scene.add(obj);
    this.line = { obj, el, until: 0, go: 0 };
    registerAttackPose("plutus_roll", plutusRollPose);
    registerAttackPose("cw_charge", cwChargePose);
    registerTelePalette("ava_clash", PAL_WEIGHT);
    registerTelePalette("ava_spill", PAL_SPILL);
    registerTelePalette("plutus_roll", PAL_WEIGHT);
    registerTelePalette("cw_charge", PAL_WEIGHT);
    registerTelePalette("plutus_pulse", PAL_HOARD);
    registerTelePalette("plutus_fall", PAL_HOARD);
  }

  /** Procession clock now (s). */
  procT(nowMs: number): number {
    return nowMs / 1000 + this.tOff;
  }

  onSnapshot(mech: any) {
    if (!mech || typeof mech.t !== "number") return;
    const T = Number(mech.T) || PROC.T;
    const now = performance.now() / 1000;
    const rtt = Math.max(0, Number(this.app.socket.rttMs) || 0) / 1000;
    const off = mech.t + Math.min(0.3, rtt / 2) - now;
    if (!this.synced) {
      this.tOff = off;
      this.synced = true;
    } else {
      let d = (off - this.tOff) % T;
      if (d > T / 2) d -= T;
      if (d < -T / 2) d += T;
      // small drift: ease in (no visible hitch); a real jump (tab back, stall): snap
      this.tOff += Math.abs(d) > 0.35 ? d : d * 0.12;
    }
    this.inf = Number(mech.inf) || 0;
    const col = Number(mech.col) || 0;
    const nowMs = performance.now();
    if (col > 0.05 && nowMs > this.colUntil) {
      // joined mid-collapse (or missed the message): sag for what is left
      this.colStart = nowMs - (this.colDur - col * 1000);
      this.colUntil = nowMs + col * 1000;
    } else if (col <= 0.05 && this.colUntil > nowMs + 400) {
      this.colUntil = nowMs + 300;
    }
  }

  onMessage(msg: any): boolean {
    const app = this.app;
    const now = performance.now();
    switch (msg.type) {
      case "ava_absorb": {
        this.inf = Number(msg.inf) || this.inf;
        const x = Number(msg.x) || 0;
        const y = Number(msg.y) || 0;
        this.dropQuietly(String(msg.id));
        const n = isCompactUi() ? 3 : 5;
        for (let i = 0; i < n; i++) this.spawnMote(x + (i - n / 2) * 0.15, y, app.standY(x, y, 0.8 + i * 0.1), now + i * 45, 360);
        return true;
      }
      case "ava_sink": {
        // the coin sinks back into the ground (Plutus fell): a small gold ripple, no kill beat
        const rec = app.nodes.get(String(msg.id));
        if (rec) {
          const p = rec.group.position;
          const ring = acquireFxRing(0.6, 1.0, 24, 0xffd070, 0.7);
          ring.position.set(p.x, app.surfaceY(p.x, p.z, 0.08), p.z);
          app.scene.add(ring);
          app.impacts.push({ mesh: ring, start: app.animT, dur: 520, from: 0.3, to: 1.2 });
        }
        this.dropQuietly(String(msg.id));
        return true;
      }
      case "ava_sweep_cancel": {
        this.rollers.cancelSweep(String(msg.id), now);
        return true;
      }
      case "ava_call": {
        for (const p of PILES) {
          const ring = acquireFxRing(0.7, 1.0, 32, 0xffd070, 0.8);
          setPlanar(ring.position, p.x, p.y, app.surfaceY(p.x, p.y, 0.1));
          app.scene.add(ring);
          app.impacts.push({ mesh: ring, start: app.animT, dur: 700, from: 0.4, to: 2.2 });
        }
        if (msg.first) this.say("«Pape Satàn, pape Satàn aleppe!»", 3000, now);
        return true;
      }
      case "ava_collapse": {
        this.colDur = Number(msg.dur) || 4000;
        this.fallMs = Math.max(250, Number(msg.fall) || 600);
        this.colStart = now;
        this.colUntil = now + this.colDur;
        this.inf = 0;
        const rec = app.nodes.get(PLUTUS);
        if (rec) {
          const p = rec.group.position;
          const ring = acquireFxRing(0.9, 1.06, 48, 0xfff0c8, 0.95);
          ring.position.set(p.x, p.y + 0.15, p.z);
          app.scene.add(ring);
          app.impacts.push({ mesh: ring, start: app.animT, dur: 700, from: 2.4, to: 6.5 });
          this.host.pushSparks(p.x, p.z, p.y + 2.6, 0xffd070, 800);
          this.host.flashLight(p.x, p.z, p.y + 2.4, 0xffd070, 16);
          app.kickShake(0.5, p.x - app.renderYou.x, p.z - app.renderYou.y);
          app.camPunch = Math.max(app.camPunch, 1.1);
        }
        this.say("…tal cadde a terra la fiera crudele", 3400, now);
        return true;
      }
      case "ava_sweep": {
        const x = Number(msg.x) || 0;
        const y = Number(msg.y) || 0;
        const dir = Number(msg.dir) || 0;
        const len = Number(msg.length) || 20;
        const vis = visibleWindupMs(Number(msg.duration) || 1300, app.socket.rttMs);
        // it rolls past you (along the lane) as the fill lands
        const ux = Math.cos(dir);
        const uy = Math.sin(dir);
        const hitAt = (app.renderYou.x - x) * ux + (app.renderYou.y - y) * uy;
        this.rollers.startSweep(String(msg.id), x, y, dir, len, now + vis, hitAt);
        return true;
      }
    }
    return false;
  }

  /** A line over Plutus (his call, the fall). */
  private say(text: string, ms: number, now: number) {
    const l = this.line;
    l.el.textContent = text;
    l.until = now + ms;
    l.obj.visible = true;
    l.go = restartLine(l.el, "ava-line-go", l.go);
  }

  /**
   * A Fiorino left without dying (swallowed / sunk): drop its node and entity now, so the
   * server's entity_removed that follows finds nothing to topple (no kill beat).
   */
  private dropQuietly(id: string) {
    const app = this.app;
    const list = app.room?.entities;
    if (Array.isArray(list)) {
      const i = list.findIndex((e: any) => String(e.id) === id);
      if (i >= 0) list.splice(i, 1);
    }
    const rec = app.nodes.get(id);
    if (rec) {
      // (no pack-death coin burst either)
      rec.group.userData.coinsDone = true;
      app.disposeNode(rec);
      app.nodes.delete(id);
    }
    app.lastAttackerOf.delete(id);
  }

  private spawnMote(x: number, y: number, h: number, t0: number, dur: number) {
    let m = this.motes.find((q) => !q.mesh);
    if (!m) return;
    m.mesh = acquireFxMote(0.13, 6, 0xffd070, 0.95);
    m.sx = x;
    m.sy = y;
    m.sh = h;
    m.t0 = t0;
    m.dur = dur;
    m.mesh.position.set(x, h, y);
    m.mesh.visible = false;
    this.app.scene.add(m.mesh);
  }

  tick(dt: number) {
    const app = this.app;
    const nowMs = performance.now();
    if (this.synced) this.rollers.update(this.procT(nowMs), nowMs);
    // — Plutus: swollen with coin, or fallen like a sail —
    const rec = app.nodes.get(PLUTUS);
    this.infView += (this.inf - this.infView) * (1 - Math.exp(-dt * 5));
    const collapsed = nowMs < this.colUntil;
    if (rec) {
      const g = rec.group;
      let sxz = 1 + 0.075 * this.infView;
      let sy = sxz;
      if (collapsed) {
        const e = nowMs - this.colStart;
        // (he topples over the fall telegraph's fill, landing as it does)
        const k = Math.min(easeOut(e / this.fallMs), smooth((this.colUntil - nowMs) / 650));
        sy *= 1 - 0.42 * k;
        sxz *= 1 + 0.24 * k;
        g.rotation.x = 0.2 * k;
        g.rotation.z = Math.sin(e * 0.004) * 0.05 * k;
        this.tilted = true;
      } else if (this.tilted) {
        g.rotation.x = 0;
        g.rotation.z = 0;
        this.tilted = false;
      }
      g.scale.set(sxz, sy, sxz);
      const show = this.infView > 0.12 && !collapsed;
      this.shield.visible = show;
      if (show) {
        const p = g.position;
        // (= the server's hoard-pulse radius: 2.3 + 0.45 per coin)
        const r = 2.3 + 0.45 * this.infView;
        this.shield.position.set(p.x, app.surfaceY(p.x, p.z, 0.14), p.z);
        this.shield.scale.set(r, r, 1);
        this.shield.rotation.z = app.animT * 0.0011;
        // swollen enough for the bell to break him: the ring throbs (below that it glows)
        const ripe = this.inf >= BELL_BREAK_MIN;
        const pulse = ripe ? 0.62 + 0.38 * Math.sin(app.animT * 0.011) : 0.82 + 0.18 * Math.sin(app.animT * 0.006);
        this.shieldMat.opacity = Math.min(0.75, (ripe ? 0.3 : 0.16) + 0.1 * this.infView) * pulse;
      }
      if (this.line.obj.visible) {
        const p = g.position;
        // (at his feet, as he swells or sags)
        this.line.obj.position.set(p.x, p.y + 0.1, p.z);
      }
    } else {
      this.shield.visible = false;
    }
    if (this.line.obj.visible && nowMs > this.line.until) this.line.obj.visible = false;
    // — coins streaming into him —
    for (const m of this.motes) {
      if (!m.mesh) continue;
      const u = (nowMs - m.t0) / m.dur;
      if (u < 0) continue;
      if (u >= 1 || !rec) {
        app.scene.remove(m.mesh);
        releaseFx(m.mesh);
        m.mesh = null;
        continue;
      }
      const p = rec.group.position;
      const e = smooth(u);
      m.mesh.visible = true;
      m.mesh.position.set(
        m.sx + (p.x - m.sx) * e,
        m.sh + (p.y + 2.6 - m.sh) * e + Math.sin(u * Math.PI) * 1.2,
        m.sy + (p.z - m.sy) * e
      );
    }
    // — Crush pressure: denser gold haze near Plutus (every ~quarter second) —
    if (nowMs - this.pressureAt > 250) {
      this.pressureAt = nowMs;
      this.pressure();
    }
  }

  /** Audio-free boss pressure: denser fog + gold haze fringe near Plutus. */
  private pressure() {
    const app = this.app;
    let near = false;
    const list = app.room?.entities;
    if (list) {
      for (const e of list) {
        if (e.kind !== "boss" || !(e.hp == null || e.hp > 0)) continue;
        near = Math.hypot(e.x - app.renderYou.x, e.y - app.renderYou.y) < 26;
        break;
      }
    }
    if (near !== app.crushPressureOn) {
      app.crushPressureOn = near;
      document.body.classList.toggle("crush-pressure", near);
    }
    app.fogTargetDensity = near ? Math.max(app.avaFogBase * 1.55, 0.019) : app.avaFogBase;
  }

  objective(obj: Objective) {
    const app = this.app;
    const room = app.room;
    if (!room) return;
    const me = room.you || {};
    const you = app.renderYou;
    if (obj.text.includes("Hoard Crush")) obj.text = obj.text.replace("Hoard Crush", "Plutus");
    const t = obj.target;
    let plutus: any = null;
    let bell: any = null;
    let feeders = 0;
    for (const e of room.entities) {
      if (e.id === PLUTUS && (e.hp == null || e.hp > 0)) plutus = e;
      else if (e.kind === "poi" && e.poiKind === "bell") bell = e;
      else if (e.kind === "mob" && e.packId === "ava_plutus_coins") feeders++;
    }
    const nowMs = performance.now();
    if (t && plutus && t.entity === plutus) {
      t.label = "Plutus";
      const dBoss = Math.hypot(plutus.x - you.x, plutus.y - you.y);
      const bellReady = (Number(me.bellCd) || 0) <= 0.4;
      const coin = Math.floor(this.inf);
      if (nowMs < this.colStart + this.fallMs + 120) {
        obj.text = "He falls toward the bell — step aside!";
        obj.sub = "Then strike — double damage while he lies fallen";
      } else if (nowMs < this.colUntil) {
        obj.text = "Plutus has fallen — strike now!";
        obj.sub = "Double damage while he lies fallen";
      } else if (coin >= BELL_BREAK_MIN && bell && dBoss < 30) {
        if (bellReady) {
          obj.text = "Plutus is swollen — ring the Ledger Bell";
          obj.sub = "It hangs where the weights meet — ring it between clashes";
          const dBell = Math.hypot(bell.x - you.x, bell.y - you.y);
          if (dBell > 5.5) obj.target = { id: String(bell.id), x: bell.x, y: bell.y, label: "Ledger Bell", kind: "poi", entity: bell };
        } else {
          obj.sub = `Swollen, he shrugs off blows · the bell again in ${Math.ceil(Number(me.bellCd) || 0)}s`;
        }
      } else if (dBoss < 26) {
        obj.sub =
          coin > 0
            ? `He holds ${coin}/${BELL_BREAK_MIN} coin — at ${BELL_BREAK_MIN} the Ledger Bell breaks him`
            : feeders > 0
              ? "Cut down the Fiorini before he swallows them"
              : "Each coin he swallows swells him — the Ledger Bell breaks him";
      }
      if (obj.sub) return;
    }
    if (t && t.entity && /^counterweight$/i.test(String(t.entity.name || ""))) {
      obj.text = "Defeat the Counterweight — then Plutus";
      if (Math.hypot(t.entity.x - you.x, t.entity.y - you.y) < 16) {
        obj.sub = "It charges like a weight — sidestep it, or lure it into a lane";
        return;
      }
    }
    if (obj.sub) return;
    const tt = this.procT(nowMs);
    // The rhythm at the clash points: when the next clash lands here
    for (let si = 0; si <= 1; si++) {
      const side = si as 0 | 1;
      const c = side === 0 ? PROC.W : PROC.E;
      const d = Math.hypot(c.x - you.x, c.y - you.y);
      if (d > 11) continue;
      const left = untilClash(tt, side);
      const since = PROC.T - left;
      // (the west clash spills its coin a beat later: cross once that has landed too)
      const settled = since > (side === 0 ? SPILL_LAG + 0.15 : 0.15);
      // (strings only change when the shown tenths change: no churn at 10 Hz)
      const key = side * 1000 + Math.round(left * 10);
      if (key === this.lastSubKey) {
        obj.sub = this.lastSub;
        return;
      }
      this.lastSubKey = key;
      this.lastSub =
        left < 2.4
          ? `The weights clash here in ${left.toFixed(1)}s — stand clear`
          : !settled
            ? side === 0
              ? "The coin spills — stand clear"
              : "The weights clash — stand clear"
            : since < 2.2
              ? "They recoil and turn back — cross now"
              : "The weights clash here — cross between clashes";
      obj.sub = this.lastSub;
      return;
    }
    // Beside a lane: when the next weight rolls through the nearest stretch of it
    const lane = nearestLane(you.x, you.y, this.lane);
    if (lane.d < 4.2) {
      const next = lanePassIn(tt, lane.s, 3, 0.1, LANE_REACH, ROLL_MIN_SPEED);
      const who = lane.k === 0 ? "hoarders'" : "wasters'";
      const key = 5000 + lane.k * 100 + (next === Infinity ? 99 : Math.round(next * 10));
      if (key === this.lastSubKey) {
        obj.sub = this.lastSub;
        return;
      }
      this.lastSubKey = key;
      this.lastSub =
        next === Infinity
          ? `The ${who} lane is clear — cross now`
          : next < 0.15
            ? `A weight rolls through the ${who} lane — keep clear`
            : `A weight rolls through here in ${next.toFixed(1)}s — cross behind it`;
      obj.sub = this.lastSub;
    }
  }

  dispose() {
    const app = this.app;
    this.rollers.dispose();
    app.scene.remove(this.shield);
    this.shield.geometry.dispose();
    this.shieldMat.dispose();
    for (const m of this.motes) {
      if (!m.mesh) continue;
      app.scene.remove(m.mesh);
      releaseFx(m.mesh);
      m.mesh = null;
    }
    app.scene.remove(this.line.obj);
    this.line.obj.element.remove();
    const rec = app.nodes.get(PLUTUS);
    if (rec) {
      rec.group.scale.set(1, 1, 1);
      rec.group.rotation.x = 0;
      rec.group.rotation.z = 0;
    }
    if (app.crushPressureOn) {
      app.crushPressureOn = false;
      document.body.classList.remove("crush-pressure", "crush-phase2", "crush-enrage");
    }
  }
}

let view: AvariceView | null = null;

export const avariceMech: CantoMech = {
  enter(app) {
    view?.dispose();
    view = new AvariceView(app);
    // (probes: ?debug exposes the view — procT for timing shots to the clash beats)
    if (import.meta.env.DEV && new URLSearchParams(location.search).has("debug")) (window as any).__ava = view;
  },
  exit() {
    view?.dispose();
    view = null;
  },
  tick(_app, dt) {
    view?.tick(dt);
  },
  onSnapshot(_app, mech) {
    view?.onSnapshot(mech);
  },
  onMessage(_app, msg) {
    return view ? view.onMessage(msg) : false;
  },
  objective(_app, obj) {
    view?.objective(obj);
  },
};
