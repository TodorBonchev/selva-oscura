/**
 * Canvas pointer handling (everything except attack timing, which WorldApp's
 * attackNearest owns):
 *   - tap / click on loot, a POI or a gate walks there and uses it on arrival
 *     (gates: the travel channel starts by itself; moving cancels it);
 *   - ground tap = click-to-move; holding the mouse keeps walking toward it;
 *   - desktop hover (≈15 Hz raycast): cursor + label highlight;
 *   - right button / context menu ignored.
 */
import type { WorldApp } from "./WorldApp";

const HOVER_EVERY_MS = 66;
const HOLD_MOVE_EVERY_MS = 110;

export class PointerInput {
  private app: WorldApp;
  private canvas: HTMLCanvasElement;
  private mouseX = 0;
  private mouseY = 0;
  private mouseIn = false;
  private hoverDirty = false;
  private lastHoverAt = 0;
  private hoverId = "";
  private cursor = "";
  private heldPointer: number | null = null;
  private lastHoldMoveAt = 0;

  constructor(app: WorldApp, canvas: HTMLCanvasElement) {
    this.app = app;
    this.canvas = canvas;
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    canvas.addEventListener("pointermove", (e) => {
      if (e.pointerType !== "mouse") return;
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
      this.mouseIn = true;
      this.hoverDirty = true;
    });
    canvas.addEventListener("pointerleave", (e) => {
      if (e.pointerType !== "mouse") return;
      this.mouseIn = false;
      this.hoverDirty = true;
    });
    // Held mouse keeps steering even when the cursor leaves the canvas (over HUD)
    window.addEventListener("pointermove", (e) => {
      if (this.heldPointer == null || e.pointerId !== this.heldPointer) return;
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
    });
    const release = (e: PointerEvent) => {
      if (this.heldPointer != null && e.pointerId === this.heldPointer) this.heldPointer = null;
    };
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    window.addEventListener("blur", () => {
      this.heldPointer = null;
    });
  }

  /** Canvas pointerdown (after HUD / stick filtering in WorldApp.bindInput). */
  down(ev: PointerEvent) {
    if (ev.pointerType === "mouse" && ev.button !== 0) return;
    const onGround = this.tapAt(ev.clientX, ev.clientY);
    if (onGround && ev.pointerType === "mouse") {
      this.heldPointer = ev.pointerId;
      this.mouseX = ev.clientX;
      this.mouseY = ev.clientY;
      this.lastHoldMoveAt = performance.now();
    }
  }

  /**
   * A tap at a screen point: foe → attack (WorldApp), interactable → walk in
   * and use, ground → walk. Returns true when it was a ground move.
   */
  tapAt(clientX: number, clientY: number): boolean {
    const app = this.app;
    if (!app.room) return false;
    const hit = app.pickEntity({ clientX, clientY });
    if (hit) {
      if (hit.kind === "mob" || hit.kind === "boss") {
        app.softSnapTargetId = null;
        app.lockedId = String(hit.id);
        app.attackNearest();
        return false;
      }
      if (hit.kind === "loot" || hit.kind === "poi" || hit.kind === "exit") {
        app.walkToInteract(hit);
        return false;
      }
    }
    if (app.joystick.isActive()) return false;
    const g = app.pickGroundClient(clientX, clientY);
    if (!g) return false;
    app.setClickMove(g);
    return true;
  }

  /** Per frame from WorldApp.tick — hover + hold-to-move are self-throttled. */
  tick() {
    const now = performance.now();
    if (this.heldPointer != null && now - this.lastHoldMoveAt >= HOLD_MOVE_EVERY_MS) {
      this.lastHoldMoveAt = now;
      const g = this.app.pickGroundClient(this.mouseX, this.mouseY);
      if (g) this.app.setClickMove(g);
    }
    if (!this.hoverDirty || now - this.lastHoverAt < HOVER_EVERY_MS) return;
    this.lastHoverAt = now;
    this.hoverDirty = false;
    const hit = this.mouseIn && this.heldPointer == null ? this.app.pickEntity({ clientX: this.mouseX, clientY: this.mouseY }) : null;
    const id = hit ? String(hit.id) : "";
    const foe = hit && (hit.kind === "mob" || hit.kind === "boss");
    const usable = hit && (hit.kind === "loot" || hit.kind === "poi" || hit.kind === "exit");
    const cursor = foe ? "crosshair" : usable ? "pointer" : "";
    if (cursor !== this.cursor) {
      this.cursor = cursor;
      this.canvas.style.cursor = cursor;
    }
    if (id !== this.hoverId) {
      this.app.nodes.get(this.hoverId)?.hpEl.classList.remove("is-hover");
      this.hoverId = id;
      if (id && (foe || usable)) this.app.nodes.get(id)?.hpEl.classList.add("is-hover");
    }
  }
}
