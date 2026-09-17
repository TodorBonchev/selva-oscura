import Phaser from "phaser";
import { GameSocket } from "../net/GameSocket";
import { worldToScreen, screenToWorld } from "../util/iso";
import {
  showToast,
  updateStats,
  renderInventory,
  renderAh,
  getSelectedItemId,
  togglePanel,
  wireHud,
  isCompactUi,
} from "../ui/hud";
import { VirtualJoystick } from "../ui/virtualJoystick";
import {
  SmoothStore,
  MOVE_SEND_MS,
  CAM_LERP_MOBILE,
  CAM_LERP_DESKTOP,
  reconcileLocal,
  type Vec2,
} from "../render/smoothing";
import {
  ensureArtTextures,
  drawGround,
  drawPoi,
  drawExit,
  drawMob,
  drawBoss,
  drawLoot,
  drawPlayer,
  spawnParticles,
  tickParticles,
  drawParticles,
  type Particle,
} from "../render/art";

type RoomSnap = any;

const DESKTOP_HIT_RADIUS = 28;
const MOBILE_HIT_RADIUS = 48;
const INTERACT_RANGE = 3.5;
const ATTACK_RANGE = 5.5;
const MOBILE_ZOOM = 0.65;
const MOBILE_ZOOM_TABLET = 0.72;
const DESKTOP_ZOOM = 1;
const ATTACK_HOLD_MS = 280;
/** Local predicted move speed (world units / sec) — matches server feel. */
const PREDICT_SPEED = 7.2;
const TAP_ARRIVE = 0.35;

export class WorldScene extends Phaser.Scene {
  socket!: GameSocket;
  room: RoomSnap | null = null;
  graphics!: Phaser.GameObjects.Graphics;
  groundGraphics!: Phaser.GameObjects.Graphics;
  labelGroup!: Phaser.GameObjects.Group;
  labels = new Map<string, Phaser.GameObjects.Text>();
  groundCantoId: string | null = null;
  keys: Record<string, Phaser.Input.Keyboard.Key> | null = null;
  moveTarget: { x: number; y: number } | null = null;
  lastMoveSend = 0;
  lastSnapAt = 0;
  joystick: VirtualJoystick | null = null;
  attackHoldTimer: number | null = null;
  camFollowLerp = 1;

  /** Authoritative last-known local position from server. */
  serverYou: Vec2 = { x: 0, y: 0 };
  /** Render / predicted local position. */
  renderYou: Vec2 = { x: 0, y: 0 };
  /** True while joystick/WASD/tap is driving prediction. */
  predicting = false;
  remoteSmooth = new SmoothStore();
  particles: Particle[] = [];
  particleAcc = 0;
  lastCantoId: string | null = null;
  needsFullRedraw = true;
  animT = 0;

  constructor() {
    super("world");
  }

  init(data: { socket: GameSocket }) {
    this.socket = data.socket;
  }

  create() {
    this.cameras.main.setBackgroundColor("#0b0f0c");
    ensureArtTextures(this);
    this.groundGraphics = this.add.graphics();
    this.graphics = this.add.graphics();
    this.labelGroup = this.add.group();
    this.joystick = new VirtualJoystick();
    this.applyViewportZoom();

    const kb = this.input.keyboard;
    if (kb) {
      this.keys = {
        W: kb.addKey("W"),
        A: kb.addKey("A"),
        S: kb.addKey("S"),
        D: kb.addKey("D"),
        E: kb.addKey("E"),
        I: kb.addKey("I"),
        H: kb.addKey("H"),
      };
      this.keys.I.on("down", () => togglePanel("inventory"));
      this.keys.H.on("down", () => {
        togglePanel("ah");
        this.socket.ahBrowse();
      });
    }

    this.input.addPointer(2);
    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (!this.room) return;
      const target = pointer.event?.target as HTMLElement | null;
      if (
        target?.closest?.(
          "#action-bar, #panels, #hud button, #virtual-joystick, .vj-base, .vj-knob"
        )
      ) {
        return;
      }
      if (this.joystick?.isVisible()) {
        const ev = pointer.event as MouseEvent | TouchEvent | PointerEvent | undefined;
        let cx = pointer.x;
        let cy = pointer.y;
        if (ev && "clientX" in ev && typeof (ev as MouseEvent).clientX === "number") {
          cx = (ev as MouseEvent).clientX;
          cy = (ev as MouseEvent).clientY;
        } else if (ev && "changedTouches" in ev && ev.changedTouches[0]) {
          cx = ev.changedTouches[0].clientX;
          cy = ev.changedTouches[0].clientY;
        }
        if (this.joystick.containsClientPoint(cx, cy)) return;
      }
      const sx = pointer.worldX;
      const sy = pointer.worldY;
      const hit = this.pickEntity(sx, sy);
      if (hit) {
        if (hit.kind === "mob" || hit.kind === "boss") {
          this.socket.attack(hit.id);
          return;
        }
        if (hit.kind === "loot") {
          this.socket.pickup(hit.id);
          return;
        }
        if (hit.kind === "poi" || hit.kind === "exit") {
          this.doInteract(hit);
          return;
        }
      }
      if (this.joystick?.isActive()) {
        return;
      }
      const w = screenToWorld(sx, sy);
      this.moveTarget = { x: w.x, y: w.y };
      this.socket.move(w.x, w.y);
      this.lastMoveSend = Date.now();
    });

    this.scale.on("resize", () => {
      this.joystick?.syncVisibility();
      this.applyViewportZoom();
      this.centerOnYou(true);
    });

    this.socket.on((msg) => this.onNet(msg));

    wireHud({
      listSelected: (price) => {
        const id = getSelectedItemId();
        if (!id || !Number.isInteger(price) || price <= 0) {
          showToast("Select an item and enter integer Ash price", "warn");
          return;
        }
        this.socket.ahList(id, price);
      },
      refreshAh: () => this.socket.ahBrowse(),
      toggleInventory: () => togglePanel("inventory"),
      toggleAh: () => {
        togglePanel("ah");
        this.socket.ahBrowse();
      },
      interactNearest: () => this.interactNearest(),
      attackNearest: () => this.attackNearest(),
      onAttackHoldStart: () => this.startAttackHold(),
      onAttackHoldEnd: () => this.stopAttackHold(),
    });
  }

  startAttackHold() {
    this.attackNearest({ silent: true });
    this.stopAttackHold();
    this.attackHoldTimer = window.setInterval(() => {
      this.attackNearest({ silent: true });
    }, ATTACK_HOLD_MS);
  }

  stopAttackHold() {
    if (this.attackHoldTimer != null) {
      window.clearInterval(this.attackHoldTimer);
      this.attackHoldTimer = null;
    }
  }

  applyViewportZoom() {
    let zoom = DESKTOP_ZOOM;
    if (isCompactUi()) {
      zoom = window.innerWidth < 420 ? MOBILE_ZOOM : MOBILE_ZOOM_TABLET;
    }
    this.cameras.main.setZoom(zoom);
    this.camFollowLerp = isCompactUi() ? CAM_LERP_MOBILE : CAM_LERP_DESKTOP;
  }

  hitRadius(): number {
    return isCompactUi() ? MOBILE_HIT_RADIUS : DESKTOP_HIT_RADIUS;
  }

  doInteract(hit: any) {
    this.socket.interact(hit.id);
    if (hit.kind === "exit" && hit.toCanto) {
      this.time.delayedCall(50, () => this.socket.travel(hit.toCanto));
    }
    if (hit.poiKind === "portal" && hit.toCanto) {
      this.time.delayedCall(50, () => this.socket.travel(hit.toCanto));
    }
    if (hit.poiKind === "ah") {
      document.getElementById("ah")?.classList.remove("hidden");
      this.socket.ahBrowse();
    }
  }

  /** Prefer render position for local range checks. */
  youPos(): Vec2 {
    return this.renderYou;
  }

  interactNearest() {
    if (!this.room) return;
    const you = this.youPos();
    let best: any = null;
    let bestD = INTERACT_RANGE;
    for (const e of this.room.entities) {
      if (e.kind !== "poi" && e.kind !== "exit" && e.kind !== "loot") continue;
      const pos = this.entityRenderPos(e);
      const d = Math.hypot(pos.x - you.x, pos.y - you.y);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    if (!best) {
      showToast("Nothing nearby to interact with", "warn");
      return;
    }
    if (best.kind === "loot") this.socket.pickup(best.id);
    else this.doInteract(best);
  }

  attackNearest(opts?: { silent?: boolean }) {
    if (!this.room) return;
    const you = this.youPos();
    let best: any = null;
    let bestD = ATTACK_RANGE;
    for (const e of this.room.entities) {
      if (e.kind !== "mob" && e.kind !== "boss") continue;
      const pos = this.entityRenderPos(e);
      const d = Math.hypot(pos.x - you.x, pos.y - you.y);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    if (!best) {
      if (!opts?.silent) showToast("No foe in range", "warn");
      return;
    }
    this.socket.attack(best.id);
  }

  entityRenderPos(e: { id: string; x: number; y: number }): Vec2 {
    return this.remoteSmooth.pos(e.id, { x: e.x, y: e.y });
  }

  onNet(msg: any) {
    switch (msg.type) {
      case "snapshot": {
        const prevCanto = this.lastCantoId;
        this.room = msg.room;
        this.lastSnapAt = Date.now();
        updateStats(msg.room.you, msg.room.title);
        renderInventory(msg.room.you.inventory || [], () => {});

        const sx = msg.room.you.x as number;
        const sy = msg.room.you.y as number;
        const cantoChanged = prevCanto != null && prevCanto !== msg.room.cantoId;
        const first = this.lastCantoId == null;
        this.lastCantoId = msg.room.cantoId;

        this.serverYou = { x: sx, y: sy };
        if (first || cantoChanged) {
          this.renderYou = { x: sx, y: sy };
          this.remoteSmooth.clear();
          this.particles = [];
          this.moveTarget = null;
          this.groundCantoId = null;
          this.centerOnYou(true);
        }

        // Seed / refresh remote targets from snapshot (smoothed in update)
        const targets = new Map<string, Vec2>();
        for (const e of msg.room.entities) {
          targets.set(e.id, { x: e.x, y: e.y });
        }
        for (const pl of msg.room.players) {
          if (pl.id === msg.room.you.id) continue;
          targets.set(`pl:${pl.id}`, { x: pl.x, y: pl.y });
        }
        // Instant-set missing ids so first frame isn't at 0,0
        for (const [id, t] of targets) {
          if (!this.remoteSmooth.get(id)) this.remoteSmooth.set(id, t);
        }

        this.needsFullRedraw = true;
        break;
      }
      case "toast":
        showToast(msg.text, msg.level);
        break;
      case "ah_listings":
        renderAh(
          msg.listings,
          (id) => this.socket.ahBuy(id),
          (id) => {
            const L = msg.listings.find((x: any) => x.id === id);
            const bid = Math.max((L?.highestBidAsh || 0) + 100, L?.priceAsh || 0);
            this.socket.ahBid(id, bid);
          }
        );
        document.getElementById("ah")?.classList.remove("hidden");
        break;
      case "error":
        showToast(msg.message, "warn");
        break;
      case "combat":
        break;
    }
  }

  pickEntity(sx: number, sy: number): any | null {
    if (!this.room) return null;
    let best: any = null;
    let bestD = this.hitRadius();
    const consider = (e: any, wx: number, wy: number) => {
      const p = worldToScreen(wx, wy);
      const cy = p.sy - (e.kind === "boss" ? 12 : e.kind === "poi" ? 10 : 6);
      const d = Phaser.Math.Distance.Between(sx, sy, p.sx, cy);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    };
    for (const e of this.room.entities) {
      const pos = this.entityRenderPos(e);
      consider(e, pos.x, pos.y);
    }
    return best;
  }

  centerOnYou(snap = false) {
    if (!this.room) return;
    const p = worldToScreen(this.renderYou.x, this.renderYou.y);
    const cam = this.cameras.main;
    if (snap || this.camFollowLerp >= 0.99) {
      cam.centerOn(p.sx, p.sy);
      return;
    }
    const curX = cam.scrollX + cam.width * 0.5;
    const curY = cam.scrollY + cam.height * 0.5;
    const nx = curX + (p.sx - curX) * this.camFollowLerp;
    const ny = curY + (p.sy - curY) * this.camFollowLerp;
    cam.centerOn(nx, ny);
  }

  redraw() {
    if (!this.room) return;
    const g = this.graphics;
    g.clear();

    const isHub = this.room.role === "hub";
    const compact = isCompactUi();
    const labelSize = compact ? "13px" : "11px";
    const seenLabels = new Set<string>();

    if (this.groundCantoId !== this.room.cantoId) {
      this.groundGraphics.clear();
      drawGround(this.groundGraphics, this.room.bounds, isHub);
      this.groundCantoId = this.room.cantoId;
      const bg = isHub ? "#0b0f0c" : "#0a0606";
      this.cameras.main.setBackgroundColor(bg);
    }
    drawParticles(g, this.particles);

    const ents = [...this.room.entities].sort((a, b) => {
      const pa = this.entityRenderPos(a);
      const pb = this.entityRenderPos(b);
      return pa.x + pa.y - (pb.x + pb.y);
    });

    for (const e of ents) {
      const pos = this.entityRenderPos(e);
      const p = worldToScreen(pos.x, pos.y);
      if (e.kind === "poi") {
        drawPoi(g, p.sx, p.sy, e.poiKind, compact);
        this.addLabel(`poi:${e.id}`, p.sx, p.sy - 28, e.label || e.name, labelSize, seenLabels);
      } else if (e.kind === "exit") {
        drawExit(g, p.sx, p.sy);
        this.addLabel(`exit:${e.id}`, p.sx, p.sy - 30, e.label || "Exit", labelSize, seenLabels);
      } else if (e.kind === "mob") {
        drawMob(g, p.sx, p.sy, Boolean(e.champion));
        this.drawHp(g, p.sx, p.sy - 22, e.hp, e.maxHp, 24);
      } else if (e.kind === "boss") {
        drawBoss(g, p.sx, p.sy);
        this.addLabel(`boss:${e.id}`, p.sx, p.sy - 42, e.name, labelSize, seenLabels);
        this.drawHp(g, p.sx, p.sy - 50, e.hp, e.maxHp, 40);
      } else if (e.kind === "loot") {
        drawLoot(g, p.sx, p.sy, e.item?.rarity, compact, this.animT);
      }
    }

    // Other players (smoothed) then local (predicted)
    const others = this.room.players.filter((pl: any) => pl.id !== this.room!.you.id);
    for (const pl of others) {
      const pos = this.remoteSmooth.pos(`pl:${pl.id}`, { x: pl.x, y: pl.y });
      const p = worldToScreen(pos.x, pos.y);
      drawPlayer(g, p.sx, p.sy, false);
      this.addLabel(`pl:${pl.id}`, p.sx, p.sy - 28, pl.name, labelSize, seenLabels);
      this.drawHp(g, p.sx, p.sy - 36, pl.hp, pl.maxHp, 28);
    }

    {
      const p = worldToScreen(this.renderYou.x, this.renderYou.y);
      drawPlayer(g, p.sx, p.sy, true);
      this.addLabel("you", p.sx, p.sy - 28, "You", labelSize, seenLabels);
      this.pruneLabels(seenLabels);
      const you = this.room.you;
      this.drawHp(g, p.sx, p.sy - 36, you.hp, you.maxHp, 28);
    }
  }

  drawHp(
    g: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    hp: number,
    maxHp: number,
    w: number
  ) {
    if (maxHp == null) return;
    const ratio = Math.max(0, hp / maxHp);
    g.fillStyle(0x222222, 0.85);
    g.fillRect(x - w / 2, y, w, 4);
    g.lineStyle(1, 0xc9a227, 0.35);
    g.strokeRect(x - w / 2, y, w, 4);
    g.fillStyle(ratio > 0.35 ? 0x3cc88a : 0xaa3333, 1);
    g.fillRect(x - w / 2, y, w * ratio, 4);
  }

  addLabel(
    key: string,
    x: number,
    y: number,
    text: string,
    fontSize = "11px",
    seen?: Set<string>
  ) {
    seen?.add(key);
    let t = this.labels.get(key);
    if (!t) {
      t = this.add
        .text(x, y, text, {
          fontFamily: "Georgia, serif",
          fontSize,
          color: "#c8d4c4",
          stroke: "#0b0f0c",
          strokeThickness: 3,
        })
        .setOrigin(0.5);
      this.labels.set(key, t);
      this.labelGroup.add(t);
    } else {
      t.setPosition(x, y);
      if (t.text !== text) t.setText(text);
      if (t.style.fontSize !== fontSize) t.setFontSize(fontSize);
    }
  }

  pruneLabels(seen: Set<string>) {
    for (const [key, t] of this.labels) {
      if (!seen.has(key)) {
        t.destroy();
        this.labels.delete(key);
      }
    }
  }

  private clampToBounds(x: number, y: number): Vec2 {
    if (!this.room) return { x, y };
    const b = this.room.bounds;
    return {
      x: Math.max(1, Math.min(b.width - 1, x)),
      y: Math.max(1, Math.min(b.height - 1, y)),
    };
  }

  private sendMoveThrottled(x: number, y: number) {
    const now = Date.now();
    if (now - this.lastMoveSend < MOVE_SEND_MS) return;
    this.lastMoveSend = now;
    this.socket.move(x, y);
  }

  /**
   * Apply continuous intent immediately to renderYou, throttle server move.
   * dx/dy are iso world axes (same basis as WASD).
   */
  private applyContinuousMove(dx: number, dy: number, dtSec: number) {
    if (!this.room) return;
    if (dx === 0 && dy === 0) return;
    const len = Math.hypot(dx, dy) || 1;
    const step = PREDICT_SPEED * dtSec;
    const nx = this.renderYou.x + (dx / len) * step;
    const ny = this.renderYou.y + (dy / len) * step;
    this.renderYou = this.clampToBounds(nx, ny);
    this.moveTarget = null;
    this.predicting = true;
    this.sendMoveThrottled(this.renderYou.x, this.renderYou.y);
  }

  private advanceTapMove(dtSec: number) {
    if (!this.moveTarget || !this.room) return;
    const dx = this.moveTarget.x - this.renderYou.x;
    const dy = this.moveTarget.y - this.renderYou.y;
    const d = Math.hypot(dx, dy);
    if (d < TAP_ARRIVE) {
      this.moveTarget = null;
      this.predicting = false;
      return;
    }
    const step = Math.min(d, PREDICT_SPEED * dtSec);
    const nx = this.renderYou.x + (dx / d) * step;
    const ny = this.renderYou.y + (dy / d) * step;
    this.renderYou = this.clampToBounds(nx, ny);
    this.predicting = true;
    this.sendMoveThrottled(this.moveTarget.x, this.moveTarget.y);
  }

  update(_t: number, dtMs: number) {
    if (!this.room) return;
    const dtSec = Math.min(0.05, dtMs / 1000);
    this.animT += dtMs;
    const keys = this.keys;

    let dx = 0;
    let dy = 0;
    this.predicting = false;

    const stick = this.joystick?.getVector();
    if (stick && (stick.x !== 0 || stick.y !== 0)) {
      dx += stick.y + stick.x;
      dy += stick.y - stick.x;
    }

    if (keys) {
      if (keys.W.isDown) {
        dx -= 1;
        dy -= 1;
      }
      if (keys.S.isDown) {
        dx += 1;
        dy += 1;
      }
      if (keys.A.isDown) {
        dx -= 1;
        dy += 1;
      }
      if (keys.D.isDown) {
        dx += 1;
        dy -= 1;
      }
      if (Phaser.Input.Keyboard.JustDown(keys.E)) {
        this.interactNearest();
      }
    }

    if (dx !== 0 || dy !== 0) {
      this.applyContinuousMove(dx, dy, dtSec);
    } else if (this.moveTarget) {
      this.advanceTapMove(dtSec);
    }

    // Reconcile local render toward last server snapshot
    this.renderYou = reconcileLocal(
      this.renderYou,
      this.serverYou,
      dtSec,
      this.predicting
    );

    // Interpolate remotes / mobs toward latest snapshot coords
    const targets = new Map<string, Vec2>();
    for (const e of this.room.entities) {
      targets.set(e.id, { x: e.x, y: e.y });
    }
    for (const pl of this.room.players) {
      if (pl.id === this.room.you.id) continue;
      targets.set(`pl:${pl.id}`, { x: pl.x, y: pl.y });
    }
    this.remoteSmooth.tick(targets, dtSec);

    // Particles (sparse)
    const isHub = this.room.role === "hub";
    this.particleAcc += dtSec;
    if (this.particleAcc > 0.35) {
      this.particleAcc = 0;
      spawnParticles(this.particles, isHub, this.room.bounds, isHub ? 2 : 3);
    }
    tickParticles(this.particles, dtSec);

    this.redraw();
    this.centerOnYou(false);
  }
}
