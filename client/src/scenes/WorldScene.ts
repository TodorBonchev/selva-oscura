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
  drawHatchOverlay,
  drawPoi,
  drawExit,
  drawMob,
  drawBoss,
  drawLoot,
  drawPlayer,
  spawnParticles,
  tickParticles,
  drawParticles,
  preloadDoreKit,
  hasTexture,
  entityDoreKey,
  DORE_KEYS,
  DORE_DISPLAY,
  RARITY_COLOR,
  doreDisplaySize,
  drawEntityPad,
  drawHubDecor,
  drawExitSpotlight,
  spawnHitBurst,
  spawnLootSparkle,
  type Particle,
} from "../render/art";

type RoomSnap = any;

const DESKTOP_HIT_RADIUS = 28;
const MOBILE_HIT_RADIUS = 48;
const INTERACT_RANGE = 4.2;
const EXIT_HINT_RANGE = 7;
const EXIT_TRAVEL_RANGE = 4.8;
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
  /** Doré texture keys that failed to load — procedural fallback. */
  doreFailed = new Set<string>();
  doreLoadAttempted = false;
  groundImage: Phaser.GameObjects.Image | null = null;
  entitySprites = new Map<string, Phaser.GameObjects.Image>();
  shadowSprites = new Map<string, Phaser.GameObjects.Image>();
  /** Brief combat punch / flash keyed by entity sprite id. */
  hitFx = new Map<string, { until: number; ox: number; oy: number }>();
  hubTipShown = false;
  nearExitToastAt = 0;
  seenLootIds = new Set<string>();
  decorDrawnFor: string | null = null;

  constructor() {
    super("world");
  }

  init(data: { socket: GameSocket }) {
    this.socket = data.socket;
  }

  preload() {
    this.doreLoadAttempted = true;
    preloadDoreKit(this);
    this.load.on("loaderror", (file: Phaser.Loader.File) => {
      if (file?.key && String(file.key).startsWith("dore_")) {
        this.doreFailed.add(file.key);
        console.warn("[Doré] failed to load", file.key, file.url);
      }
    });
  }

  create() {
    this.cameras.main.setBackgroundColor("#0b0f0c");
    ensureArtTextures(this);
    // Mark any missing Doré textures as failed (e.g. 404 still registered oddly)
    for (const key of Object.values(DORE_KEYS)) {
      if (!hasTexture(this, key)) this.doreFailed.add(key);
    }
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

    // Prefer exits/portals in a slightly larger travel radius
    for (const e of this.room.entities) {
      if (e.kind !== "exit" && !(e.kind === "poi" && e.poiKind === "portal")) continue;
      const pos = this.entityRenderPos(e);
      const d = Math.hypot(pos.x - you.x, pos.y - you.y);
      if (d < EXIT_TRAVEL_RANGE && d < bestD) {
        bestD = d;
        best = e;
      }
    }
    if (!best) {
      bestD = INTERACT_RANGE;
      for (const e of this.room.entities) {
        if (e.kind !== "poi" && e.kind !== "exit" && e.kind !== "loot") continue;
        const pos = this.entityRenderPos(e);
        const d = Math.hypot(pos.x - you.x, pos.y - you.y);
        if (d < bestD) {
          bestD = d;
          best = e;
        }
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
          this.pruneSprites(new Set());
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

        // First-time Dark Wood tip
        const isHub =
          msg.room.role === "hub" || msg.room.cantoId === "inferno_01";
        if (isHub && !this.hubTipShown) {
          this.hubTipShown = true;
          showToast("No foes here — take the portal Toward Lust.", "info");
        }

        // Loot sparkle when new drops appear
        const lootIds = new Set<string>();
        for (const e of msg.room.entities) {
          if (e.kind !== "loot") continue;
          lootIds.add(e.id);
          if (!this.seenLootIds.has(e.id)) {
            spawnLootSparkle(this.particles, e.x, e.y);
          }
        }
        this.seenLootIds = lootIds;
        if (cantoChanged) this.seenLootIds = lootIds;

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
      case "combat": {
        const tid = msg.targetId as string;
        const ent = this.room?.entities?.find((e: any) => e.id === tid);
        if (ent) {
          const sid = `${ent.kind}:${ent.id}`;
          this.hitFx.set(sid, {
            until: this.animT + 180,
            ox: (Math.random() - 0.5) * 10,
            oy: -4 - Math.random() * 6,
          });
          spawnHitBurst(this.particles, ent.x, ent.y);
          const img = this.entitySprites.get(sid);
          if (img) {
            img.setTint(0xffeeaa);
            this.tweens.add({
              targets: img,
              scaleX: img.scaleX * 1.18,
              scaleY: img.scaleY * 1.18,
              duration: 70,
              yoyo: true,
              ease: "Quad.easeOut",
            });
          }
        }
        break;
      }
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

  doreOk(key: string | null | undefined): key is string {
    return !!key && !this.doreFailed.has(key) && hasTexture(this, key);
  }

  /** Stamp hub/lust Doré ground; fall back to full procedural ground. */
  refreshGround() {
    if (!this.room) return;
    const isHub =
      this.room.role === "hub" || this.room.cantoId === "inferno_01";
    const groundKey = isHub ? DORE_KEYS.hub_ground : DORE_KEYS.lust_ground;
    this.groundGraphics.clear();
    this.groundGraphics.setDepth(1);

    if (this.groundImage) {
      this.groundImage.destroy();
      this.groundImage = null;
    }

    if (this.doreOk(groundKey)) {
      const b = this.room.bounds;
      const cx = b.width / 2;
      const cy = b.height / 2;
      const center = worldToScreen(cx, cy);
      // Iso diamond footprint of the room
      const isoW = (b.width + b.height) * 18; // TILE_W/2 * 2 equiv via (w+h)*(TILE_W/2)
      const isoH = (b.width + b.height) * 9;
      const img = this.add.image(center.sx, center.sy, groundKey);
      img.setDisplaySize(isoW * 1.05, isoH * 1.15);
      img.setAlpha(isHub ? 0.92 : 0.88);
      img.setDepth(0);
      this.groundImage = img;
      // Soften busy hatch so sprites read on mobile
      img.setTint(isHub ? 0xb8c4b8 : 0xc4a8a8);
      drawHatchOverlay(this.groundGraphics, b, isHub);
      if (isHub) {
        drawHubDecor(this.groundGraphics, b, this.animT);
      }
    } else {
      drawGround(this.groundGraphics, this.room.bounds, isHub);
      if (isHub) drawHubDecor(this.groundGraphics, this.room.bounds, this.animT);
    }

    this.groundCantoId = this.room.cantoId;
    const bg = isHub ? "#0b0f0c" : "#0a0606";
    this.cameras.main.setBackgroundColor(bg);
  }

  placeSprite(
    id: string,
    texKey: string,
    sx: number,
    sy: number,
    depth: number,
    opts?: { tint?: number; bob?: number }
  ): boolean {
    if (!this.doreOk(texKey)) {
      this.hideSprite(id);
      return false;
    }
    let img = this.entitySprites.get(id);
    if (!img) {
      img = this.add.image(sx, sy, texKey);
      img.setOrigin(0.5, 0.85);
      const sz = doreDisplaySize(texKey, isCompactUi());
      img.setDisplaySize(sz.w, sz.h);
      // Ensure no debug / bounds stroke leftover from textures
      img.clearTint();
      img.setAlpha(1);
      this.entitySprites.set(id, img);
    } else if (img.texture.key !== texKey) {
      img.setTexture(texKey);
      const sz = doreDisplaySize(texKey, isCompactUi());
      img.setDisplaySize(sz.w, sz.h);
    } else {
      // Keep mobile/desktop size in sync on resize
      const sz = doreDisplaySize(texKey, isCompactUi());
      if (Math.abs(img.displayWidth - sz.w) > 1) img.setDisplaySize(sz.w, sz.h);
    }
    const bob = opts?.bob ?? 0;
    const fx = this.hitFx.get(id);
    let ox = 0;
    let oy = 0;
    if (fx) {
      if (this.animT > fx.until) this.hitFx.delete(id);
      else {
        ox = fx.ox;
        oy = fx.oy;
        img.setTint(0xffe0a0);
      }
    }
    img.setPosition(sx + ox, sy - 4 + bob + oy);
    img.setDepth(depth);
    img.setVisible(true);
    if (opts?.tint != null && !(fx && this.animT <= fx.until)) img.setTint(opts.tint);
    else if (!(fx && this.animT <= fx.until)) img.clearTint();

    // Soft shadow under sprite
    let sh = this.shadowSprites.get(id);
    if (!sh) {
      if (hasTexture(this, "tex_shadow")) {
        sh = this.add.image(sx, sy + 2, "tex_shadow");
        sh.setAlpha(0.45);
        this.shadowSprites.set(id, sh);
      }
    }
    if (sh) {
      const sz = doreDisplaySize(texKey, isCompactUi());
      sh.setPosition(sx, sy + 2);
      sh.setDisplaySize(Math.max(22, sz.w * 0.55), 12);
      sh.setDepth(depth - 0.1);
      sh.setVisible(true);
    }
    return true;
  }

  hideSprite(id: string) {
    const img = this.entitySprites.get(id);
    if (img) img.setVisible(false);
    const sh = this.shadowSprites.get(id);
    if (sh) sh.setVisible(false);
  }

  pruneSprites(seen: Set<string>) {
    for (const [id, img] of this.entitySprites) {
      if (!seen.has(id)) {
        img.destroy();
        this.entitySprites.delete(id);
      }
    }
    for (const [id, sh] of this.shadowSprites) {
      if (!seen.has(id)) {
        sh.destroy();
        this.shadowSprites.delete(id);
      }
    }
  }

  redraw() {
    if (!this.room) return;
    const g = this.graphics;
    g.clear();
    g.setDepth(8000);

    const isHub =
      this.room.role === "hub" || this.room.cantoId === "inferno_01";
    const compact = isCompactUi();
    const labelSize = compact ? "13px" : "11px";
    const seenLabels = new Set<string>();
    const seenSprites = new Set<string>();

    if (this.groundCantoId !== this.room.cantoId) {
      this.refreshGround();
    }
    drawParticles(g, this.particles);

    // Live hub decor pulse (lightweight vignette trees already stamped on ground)
    if (isHub) {
      // Soft center darkening under playable clearing each frame for sprite pop
      const b = this.room.bounds;
      const c = worldToScreen(b.width * 0.5, b.height * 0.55);
      g.fillStyle(0x000000, 0.08);
      g.fillEllipse(c.sx, c.sy, 180, 80);
    }

    const ents = [...this.room.entities].sort((a, b) => {
      const pa = this.entityRenderPos(a);
      const pb = this.entityRenderPos(b);
      return pa.x + pa.y - (pb.x + pb.y);
    });

    for (const e of ents) {
      const pos = this.entityRenderPos(e);
      const p = worldToScreen(pos.x, pos.y);
      const depth = 100 + pos.x + pos.y;
      const tex = entityDoreKey(e);
      const sid = `${e.kind}:${e.id}`;

      if (e.kind === "poi") {
        drawEntityPad(g, p.sx, p.sy, compact ? 1.25 : 1.05);
        if (this.placeSprite(sid, tex!, p.sx, p.sy, depth)) {
          seenSprites.add(sid);
        } else {
          drawPoi(g, p.sx, p.sy, e.poiKind, compact);
        }
        this.addLabel(`poi:${e.id}`, p.sx, p.sy - 34, e.label || e.name, labelSize, seenLabels);
      } else if (e.kind === "exit") {
        drawEntityPad(g, p.sx, p.sy, compact ? 1.6 : 1.35);
        drawExitSpotlight(g, p.sx, p.sy, this.animT, compact);
        if (this.placeSprite(sid, DORE_KEYS.exit_portal, p.sx, p.sy, depth)) {
          seenSprites.add(sid);
        } else {
          drawExit(g, p.sx, p.sy);
        }
        const exitLabel =
          e.toCanto === "inferno_05"
            ? "Toward Lust →"
            : e.label || "Exit";
        this.addLabel(
          `exit:${e.id}`,
          p.sx,
          p.sy - (compact ? 72 : 58),
          exitLabel,
          compact ? "15px" : "13px",
          seenLabels
        );
        // Gold-ish label for Lust exit
        const lab = this.labels.get(`exit:${e.id}`);
        if (lab && e.toCanto === "inferno_05") lab.setColor("#e8c86a");
      } else if (e.kind === "mob") {
        drawEntityPad(g, p.sx, p.sy, e.champion ? 1.3 : 1.1);
        if (this.placeSprite(sid, tex!, p.sx, p.sy, depth)) {
          seenSprites.add(sid);
        } else {
          drawMob(g, p.sx, p.sy, Boolean(e.champion));
        }
        this.drawHp(g, p.sx, p.sy - 26, e.hp, e.maxHp, 24);
      } else if (e.kind === "boss") {
        drawEntityPad(g, p.sx, p.sy, 1.8);
        if (this.placeSprite(sid, DORE_KEYS.boss_judge, p.sx, p.sy, depth)) {
          seenSprites.add(sid);
        } else {
          drawBoss(g, p.sx, p.sy);
        }
        this.addLabel(`boss:${e.id}`, p.sx, p.sy - 52, e.name, labelSize, seenLabels);
        this.drawHp(g, p.sx, p.sy - 60, e.hp, e.maxHp, 40);
      } else if (e.kind === "loot") {
        drawEntityPad(g, p.sx, p.sy, 0.7);
        const bob = Math.sin(this.animT * 0.004 + p.sx * 0.01) * 2;
        const rarity = e.item?.rarity || "normal";
        const tint = RARITY_COLOR[rarity] || 0xffffff;
        if (
          this.placeSprite(sid, DORE_KEYS.loot_gem, p.sx, p.sy, depth, {
            tint,
            bob,
          })
        ) {
          seenSprites.add(sid);
        } else {
          drawLoot(g, p.sx, p.sy, e.item?.rarity, compact, this.animT);
        }
      }
    }

    // Other players (smoothed) then local (predicted)
    const others = this.room.players.filter((pl: any) => pl.id !== this.room!.you.id);
    for (const pl of others) {
      const pos = this.remoteSmooth.pos(`pl:${pl.id}`, { x: pl.x, y: pl.y });
      const p = worldToScreen(pos.x, pos.y);
      const depth = 100 + pos.x + pos.y;
      const sid = `pl:${pl.id}`;
      if (this.placeSprite(sid, DORE_KEYS.player, p.sx, p.sy, depth)) {
        seenSprites.add(sid);
        // Mute remote players slightly
        this.entitySprites.get(sid)?.setTint(0x9ab0a0);
      } else {
        drawPlayer(g, p.sx, p.sy, false);
      }
      this.addLabel(`pl:${pl.id}`, p.sx, p.sy - 34, pl.name, labelSize, seenLabels);
      this.drawHp(g, p.sx, p.sy - 42, pl.hp, pl.maxHp, 28);
    }

    {
      const p = worldToScreen(this.renderYou.x, this.renderYou.y);
      const depth = 100 + this.renderYou.x + this.renderYou.y;
      const sid = "you";
      drawEntityPad(g, p.sx, p.sy, compact ? 1.35 : 1.15);
      if (this.placeSprite(sid, DORE_KEYS.player, p.sx, p.sy, depth)) {
        seenSprites.add(sid);
      } else {
        drawPlayer(g, p.sx, p.sy, true);
      }
      this.addLabel("you", p.sx, p.sy - 34, "You", labelSize, seenLabels);
      const you = this.room.you;
      this.drawHp(g, p.sx, p.sy - 42, you.hp, you.maxHp, 28);
    }

    this.pruneLabels(seenLabels);
    this.pruneSprites(seenSprites);
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
    const ratio = Math.max(0, Math.min(1, hp / maxHp));
    const compact = isCompactUi();
    const barW = compact ? w * 1.25 : w;
    const barH = compact ? 6 : 5;
    g.fillStyle(0x000000, 0.55);
    g.fillRect(x - barW / 2 - 1, y - 1, barW + 2, barH + 2);
    g.fillStyle(0x1a1a1a, 0.95);
    g.fillRect(x - barW / 2, y, barW, barH);
    g.lineStyle(1, 0xc9a227, 0.55);
    g.strokeRect(x - barW / 2, y, barW, barH);
    g.fillStyle(ratio > 0.35 ? 0x3cc88a : 0xcc3333, 1);
    g.fillRect(x - barW / 2, y, Math.max(0, barW * ratio), barH);
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
        .setOrigin(0.5)
        .setDepth(9000);
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

    // Lust exit proximity hint + reliable travel nudge
    if (this.room) {
      const isHub =
        this.room.role === "hub" || this.room.cantoId === "inferno_01";
      if (isHub) {
        let nearExit: any = null;
        let nearD = EXIT_HINT_RANGE;
        for (const e of this.room.entities) {
          if (e.kind !== "exit" && !(e.kind === "poi" && e.poiKind === "portal"))
            continue;
          const pos = this.entityRenderPos(e);
          const d = Math.hypot(pos.x - this.renderYou.x, pos.y - this.renderYou.y);
          if (d < nearD) {
            nearD = d;
            nearExit = e;
          }
        }
        if (nearExit && nearD < EXIT_HINT_RANGE) {
          const now = Date.now();
          if (now - this.nearExitToastAt > 8000) {
            this.nearExitToastAt = now;
            showToast("Portal near — press Interact to enter Lust", "info");
          }
        }
      }
    }

    this.redraw();
    this.centerOnYou(false);
  }
}
