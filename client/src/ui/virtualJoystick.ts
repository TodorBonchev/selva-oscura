/**
 * DOM virtual joystick for touch / compact viewports.
 * Emits normalized screen-space vector (x right, y down); WorldScene maps to iso WASD axes.
 */

export type StickVector = { x: number; y: number };

const DEADZONE = 0.22;
const MAX_TRAVEL = 42; // px knob travel from center

export class VirtualJoystick {
  readonly root: HTMLElement;
  private base: HTMLElement;
  private knob: HTMLElement;
  private activeId: number | null = null;
  private originX = 0;
  private originY = 0;
  private vector: StickVector = { x: 0, y: 0 };
  private eased: StickVector = { x: 0, y: 0 };
  private visible = false;

  constructor() {
    this.root = document.createElement("div");
    this.root.id = "virtual-joystick";
    this.root.setAttribute("aria-label", "Movement stick");
    this.root.setAttribute("role", "application");
    this.root.classList.add("vj-hidden");

    // Etched bone ring: outer ring, tick marks, four gold cardinal finials, knob
    this.base = document.createElement("div");
    this.base.className = "vj-base";
    const ticks = document.createElement("div");
    ticks.className = "vj-ticks";
    const finials = document.createElement("div");
    finials.className = "vj-finials";
    for (const dir of ["n", "e", "s", "w"]) {
      const f = document.createElement("span");
      f.className = `vj-finial vj-finial-${dir}`;
      finials.appendChild(f);
    }
    const inner = document.createElement("div");
    inner.className = "vj-inner";
    this.knob = document.createElement("div");
    this.knob.className = "vj-knob";
    const gem = document.createElement("span");
    gem.className = "vj-gem";
    this.knob.appendChild(gem);
    this.base.append(ticks, finials, inner, this.knob);
    this.root.appendChild(this.base);

    document.body.appendChild(this.root);
    this.bind();
    this.syncVisibility();
    window.addEventListener("resize", () => this.syncVisibility());
    window.matchMedia("(pointer: coarse)").addEventListener?.("change", () => this.syncVisibility());
    window.matchMedia("(max-width: 640px)").addEventListener?.("change", () => this.syncVisibility());
  }

  /** Whether the stick should be shown (touch / narrow / coarse). */
  static shouldShow(): boolean {
    if (typeof window === "undefined") return false;
    const touch =
      "ontouchstart" in window ||
      (navigator.maxTouchPoints != null && navigator.maxTouchPoints > 0);
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    const narrow = window.matchMedia("(max-width: 640px)").matches;
    return touch || coarse || narrow;
  }

  syncVisibility() {
    const show = VirtualJoystick.shouldShow();
    this.visible = show;
    this.root.classList.toggle("vj-hidden", !show);
    this.root.setAttribute("aria-hidden", show ? "false" : "true");
    if (!show) this.reset();
  }

  isVisible(): boolean {
    return this.visible;
  }

  /** Normalized direction after deadzone + easing, magnitude 0..1. */
  getVector(): StickVector {
    const k = 0.28;
    this.eased = {
      x: this.eased.x + (this.vector.x - this.eased.x) * k,
      y: this.eased.y + (this.vector.y - this.eased.y) * k,
    };
    if (Math.hypot(this.eased.x, this.eased.y) < 0.02) this.eased = { x: 0, y: 0 };
    return this.eased;
  }

  isActive(): boolean {
    return this.activeId != null && (this.vector.x !== 0 || this.vector.y !== 0);
  }

  /** True if a client point falls inside the stick hit zone (including padding). */
  containsClientPoint(clientX: number, clientY: number): boolean {
    if (!this.visible) return false;
    const r = this.root.getBoundingClientRect();
    // Generous hit box so edge taps don't become world picks
    const pad = 12;
    return (
      clientX >= r.left - pad &&
      clientX <= r.right + pad &&
      clientY >= r.top - pad &&
      clientY <= r.bottom + pad
    );
  }

  destroy() {
    this.reset();
    this.root.remove();
  }

  private bind() {
    const onDown = (e: PointerEvent) => {
      if (!this.visible) return;
      if (this.activeId != null) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      this.activeId = e.pointerId;
      this.root.classList.add("vj-active");
      try {
        this.root.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      const rect = this.base.getBoundingClientRect();
      this.originX = rect.left + rect.width / 2;
      this.originY = rect.top + rect.height / 2;
      this.applyPointer(e.clientX, e.clientY);
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== this.activeId) return;
      e.preventDefault();
      e.stopPropagation();
      this.applyPointer(e.clientX, e.clientY);
    };

    const onUp = (e: PointerEvent) => {
      if (e.pointerId !== this.activeId) return;
      e.preventDefault();
      e.stopPropagation();
      try {
        this.root.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      this.reset();
    };

    this.root.addEventListener("pointerdown", onDown, { passive: false });
    this.root.addEventListener("pointermove", onMove, { passive: false });
    this.root.addEventListener("pointerup", onUp, { passive: false });
    this.root.addEventListener("pointercancel", onUp, { passive: false });
    // Block Phaser / canvas from seeing stick touches
    this.root.addEventListener("touchstart", (e) => e.stopPropagation(), { passive: false });
    this.root.addEventListener("touchmove", (e) => {
      e.preventDefault();
      e.stopPropagation();
    }, { passive: false });
  }

  private applyPointer(clientX: number, clientY: number) {
    let dx = clientX - this.originX;
    let dy = clientY - this.originY;
    const dist = Math.hypot(dx, dy) || 1;
    const clamped = Math.min(dist, MAX_TRAVEL);
    const nx = (dx / dist) * clamped;
    const ny = (dy / dist) * clamped;
    this.knob.style.transform = `translate(${nx}px, ${ny}px)`;

    let vx = nx / MAX_TRAVEL;
    let vy = ny / MAX_TRAVEL;
    const mag = Math.hypot(vx, vy);
    if (mag < DEADZONE) {
      this.vector = { x: 0, y: 0 };
      return;
    }
    // Rescale so deadzone → 0 and edge → 1
    const scale = (mag - DEADZONE) / (1 - DEADZONE);
    this.vector = { x: (vx / mag) * scale, y: (vy / mag) * scale };
    this.root.style.setProperty("--vj-angle", `${Math.atan2(vy, vx)}rad`);
    this.root.style.setProperty("--vj-mag", scale.toFixed(2));
  }

  private reset() {
    this.activeId = null;
    this.vector = { x: 0, y: 0 };
    this.knob.style.transform = "translate(0px, 0px)";
    this.root.classList.remove("vj-active");
    this.root.style.setProperty("--vj-mag", "0");
  }
}
