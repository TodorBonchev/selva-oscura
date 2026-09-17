import Phaser from "phaser";
import { GameSocket } from "../net/GameSocket";
import { worldToScreen, screenToWorld, TILE_W, TILE_H } from "../util/iso";
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

type RoomSnap = any;

const RARITY_COLOR: Record<string, number> = {
  normal: 0xb0b0b0,
  magic: 0x4a7fd4,
  rare: 0xd4b84a,
  set: 0x33cc88,
  unique: 0xcc8800,
  canto_unique: 0xee66cc,
};

const DESKTOP_HIT_RADIUS = 28;
const MOBILE_HIT_RADIUS = 48;
const INTERACT_RANGE = 3.5;
const ATTACK_RANGE = 5.5;
const MOBILE_ZOOM = 0.7;
const DESKTOP_ZOOM = 1;

export class WorldScene extends Phaser.Scene {
  socket!: GameSocket;
  room: RoomSnap | null = null;
  graphics!: Phaser.GameObjects.Graphics;
  labelGroup!: Phaser.GameObjects.Group;
  keys: Record<string, Phaser.Input.Keyboard.Key> | null = null;
  moveTarget: { x: number; y: number } | null = null;
  lastMoveSend = 0;
  lastSnapAt = 0;

  constructor() {
    super("world");
  }

  init(data: { socket: GameSocket }) {
    this.socket = data.socket;
  }

  create() {
    this.cameras.main.setBackgroundColor("#0b0f0c");
    this.graphics = this.add.graphics();
    this.labelGroup = this.add.group();
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
      // Ignore taps that land on DOM chrome (action bar / panels handle their own events).
      if (pointer.event && (pointer.event.target as HTMLElement | null)?.closest?.("#action-bar, #panels, #hud button")) {
        return;
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
      const w = screenToWorld(sx, sy);
      this.moveTarget = { x: w.x, y: w.y };
      this.socket.move(w.x, w.y);
    });

    this.scale.on("resize", () => {
      this.applyViewportZoom();
      this.centerOnYou();
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
    });
  }

  applyViewportZoom() {
    const zoom = isCompactUi() ? MOBILE_ZOOM : DESKTOP_ZOOM;
    this.cameras.main.setZoom(zoom);
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

  interactNearest() {
    if (!this.room) return;
    const you = this.room.you;
    let best: any = null;
    let bestD = INTERACT_RANGE;
    for (const e of this.room.entities) {
      if (e.kind !== "poi" && e.kind !== "exit" && e.kind !== "loot") continue;
      const d = Math.hypot(e.x - you.x, e.y - you.y);
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

  attackNearest() {
    if (!this.room) return;
    const you = this.room.you;
    let best: any = null;
    let bestD = ATTACK_RANGE;
    for (const e of this.room.entities) {
      if (e.kind !== "mob" && e.kind !== "boss") continue;
      const d = Math.hypot(e.x - you.x, e.y - you.y);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    if (!best) {
      showToast("No foe in range", "warn");
      return;
    }
    this.socket.attack(best.id);
  }

  onNet(msg: any) {
    switch (msg.type) {
      case "snapshot":
        this.room = msg.room;
        this.lastSnapAt = Date.now();
        updateStats(msg.room.you, msg.room.title);
        renderInventory(msg.room.you.inventory || [], () => {});
        this.redraw();
        this.centerOnYou();
        break;
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
        // flash handled by next snapshot
        break;
    }
  }

  pickEntity(sx: number, sy: number): any | null {
    if (!this.room) return null;
    let best: any = null;
    let bestD = this.hitRadius();
    const consider = (e: any) => {
      const p = worldToScreen(e.x, e.y);
      // Account for visual offset of circles drawn above feet
      const cy = p.sy - (e.kind === "boss" ? 12 : e.kind === "poi" ? 10 : 6);
      const d = Phaser.Math.Distance.Between(sx, sy, p.sx, cy);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    };
    for (const e of this.room.entities) consider(e);
    return best;
  }

  centerOnYou() {
    if (!this.room) return;
    const you = this.room.you;
    const p = worldToScreen(you.x, you.y);
    this.cameras.main.centerOn(p.sx, p.sy);
  }

  redraw() {
    if (!this.room) return;
    const g = this.graphics;
    g.clear();
    this.labelGroup.clear(true, true);

    const { width, height } = this.room.bounds;
    const isHub = this.room.role === "hub";
    const ground = isHub ? 0x1a241c : 0x1a1010;
    const grid = isHub ? 0x2a3a2e : 0x3a2020;
    const compact = isCompactUi();
    const labelSize = compact ? "13px" : "11px";

    // Ground diamond grid (sparse)
    const step = 4;
    for (let x = 0; x <= width; x += step) {
      for (let y = 0; y <= height; y += step) {
        const p = worldToScreen(x, y);
        g.fillStyle(ground, 1);
        g.fillTriangle(
          p.sx,
          p.sy - TILE_H / 2,
          p.sx + TILE_W / 2,
          p.sy,
          p.sx,
          p.sy + TILE_H / 2
        );
        g.fillTriangle(
          p.sx,
          p.sy - TILE_H / 2,
          p.sx,
          p.sy + TILE_H / 2,
          p.sx - TILE_W / 2,
          p.sy
        );
        g.lineStyle(1, grid, 0.25);
        g.strokeCircle(p.sx, p.sy, 2);
      }
    }

    // Sort draw by depth (x+y)
    const ents = [...this.room.entities].sort((a, b) => a.x + a.y - (b.x + b.y));
    for (const e of ents) {
      const p = worldToScreen(e.x, e.y);
      if (e.kind === "poi") {
        const col =
          e.poiKind === "ah"
            ? 0xc9a227
            : e.poiKind === "stash"
              ? 0x6a7a68
              : e.poiKind === "quest"
                ? 0x4a7fd4
                : 0xd7e0d4;
        g.fillStyle(col, 1);
        g.fillCircle(p.sx, p.sy - 10, compact ? 10 : 8);
        this.addLabel(p.sx, p.sy - 28, e.label || e.name, labelSize);
      } else if (e.kind === "exit") {
        g.fillStyle(0x88aaff, 0.9);
        g.fillTriangle(p.sx, p.sy - 16, p.sx + 10, p.sy, p.sx - 10, p.sy);
        this.addLabel(p.sx, p.sy - 28, e.label || "Exit", labelSize);
      } else if (e.kind === "mob") {
        const col = e.champion ? 0xdd4444 : 0x884444;
        g.fillStyle(col, 1);
        g.fillCircle(p.sx, p.sy - 6, e.champion ? 10 : 7);
        this.drawHp(g, p.sx, p.sy - 22, e.hp, e.maxHp, 24);
      } else if (e.kind === "boss") {
        g.fillStyle(0xaa2222, 1);
        g.fillCircle(p.sx, p.sy - 12, 16);
        g.lineStyle(2, 0xffcc00, 1);
        g.strokeCircle(p.sx, p.sy - 12, 16);
        this.addLabel(p.sx, p.sy - 40, e.name, labelSize);
        this.drawHp(g, p.sx, p.sy - 48, e.hp, e.maxHp, 40);
      } else if (e.kind === "loot") {
        const col = RARITY_COLOR[e.item?.rarity] || 0xffffff;
        g.fillStyle(col, 1);
        const s = compact ? 10 : 8;
        g.fillRect(p.sx - s / 2, p.sy - 10, s, s);
      }
    }

    // Other players + you
    for (const pl of this.room.players) {
      const p = worldToScreen(pl.x, pl.y);
      const isYou = pl.id === this.room.you.id;
      g.fillStyle(isYou ? 0xe8f0e4 : 0x7a9a88, 1);
      g.fillCircle(p.sx, p.sy - 8, 9);
      if (isYou) {
        g.lineStyle(2, 0xc9a227, 1);
        g.strokeCircle(p.sx, p.sy - 8, 11);
      }
      this.addLabel(p.sx, p.sy - 28, isYou ? "You" : pl.name, labelSize);
      this.drawHp(g, p.sx, p.sy - 36, pl.hp, pl.maxHp, 28);
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
    g.fillStyle(0x222, 0.8);
    g.fillRect(x - w / 2, y, w, 4);
    g.fillStyle(ratio > 0.35 ? 0x3c8 : 0xa33, 1);
    g.fillRect(x - w / 2, y, w * ratio, 4);
  }

  addLabel(x: number, y: number, text: string, fontSize = "11px") {
    const t = this.add
      .text(x, y, text, {
        fontFamily: "Georgia, serif",
        fontSize,
        color: "#c8d4c4",
      })
      .setOrigin(0.5);
    this.labelGroup.add(t);
  }

  update(_t: number, dt: number) {
    if (!this.room) return;
    const you = this.room.you;
    const keys = this.keys;
    if (keys) {
      let dx = 0;
      let dy = 0;
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
      if (dx !== 0 || dy !== 0) {
        const len = Math.hypot(dx, dy) || 1;
        const speed = 0.012 * dt;
        const nx = you.x + (dx / len) * speed * 8;
        const ny = you.y + (dy / len) * speed * 8;
        const now = Date.now();
        if (now - this.lastMoveSend > 50) {
          this.lastMoveSend = now;
          this.socket.move(nx, ny);
        }
      }

      if (Phaser.Input.Keyboard.JustDown(keys.E)) {
        this.interactNearest();
      }
    }

    // Keep camera on the player (follow) after move / snap
    this.centerOnYou();
  }
}
