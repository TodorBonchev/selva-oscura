/**
 * First-run onboarding (≈60 s) for brand-new pilgrims in the Dark Wood hub:
 * move → slash → cast a starter skill → open the skill tree → learn & equip a skill →
 * walk to the Lust gate. Skippable. The server stores `prog.tut` so it shows only once
 * (0 = not started, 1 = starter-XP granted, ≥2 = done/skipped; missing = old server → never show).
 */
import { SKILLS, FREE_SKILLS } from "../skills";
import { isCompactUi } from "./hud";

export type OnboardingCtx = {
  canto: () => string | null;
  pos: () => { x: number; y: number } | null;
  prog: () => any;
  lustGate: () => { x: number; y: number } | null;
  send: (msg: object) => void;
  toast: (text: string) => void;
};

type Step = { id: string; title: string; text: () => string };

const touch = () => isCompactUi() || (typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches);

const STEPS: Step[] = [
  {
    id: "move",
    title: "Walk",
    text: () => (touch() ? "Drag the left stick to walk the Dark Wood." : "Move with WASD (or click the ground)."),
  },
  {
    id: "slash",
    title: "Strike",
    text: () => (touch() ? "Tap the Attack button to slash." : "Press F to slash (or click a foe). Space dashes."),
  },
  {
    id: "cast",
    title: "Cast",
    text: () => (touch() ? "Tap skill button 1 to cast Gale Bolt." : "Press 1 to cast Gale Bolt, your starter spell."),
  },
  {
    id: "tree",
    title: "Skill tree",
    text: () => (touch() ? "You earned a skill point. Tap the ★ Skills button at the top." : "You earned a skill point. Press K to open the skill tree."),
  },
  {
    id: "learn",
    title: "Learn & equip",
    text: () => "Tap any unlocked skill to read it, press Learn, then Equip it into slot 4 (passives work on their own).",
  },
  {
    id: "gate",
    title: "Descend",
    text: () => "Follow the glowing road to the Lust gate. The Inferno awaits.",
  },
];

export class Onboarding {
  private root: HTMLElement | null = null;
  private step = 0;
  private active = false;
  private decided = false;
  private start: { x: number; y: number } | null = null;
  private walked = 0;
  private last: { x: number; y: number } | null = null;
  private flags = { attack: false, cast: false };
  private xpAsked = false;
  private baseLearned = -1;
  private nextTick = 0;
  private glowId = "";

  constructor(private ctx: OnboardingCtx) {}

  /** Combat hooks from WorldApp. */
  note(kind: "attack" | "cast") {
    if (!this.active) return;
    this.flags[kind] = true;
  }

  private learnedCount(prog: any): number {
    const ranks = prog?.ranks || {};
    let n = 0;
    for (const id of Object.keys(ranks)) {
      if ((FREE_SKILLS as readonly string[]).includes(id)) continue;
      if ((Number(ranks[id]) || 0) >= 1) n++;
    }
    return n;
  }

  private equippedLearned(prog: any): boolean {
    const ranks = prog?.ranks || {};
    const loadout: any[] = Array.isArray(prog?.loadout) ? prog.loadout : [];
    for (const id of Object.keys(ranks)) {
      if ((FREE_SKILLS as readonly string[]).includes(id)) continue;
      if ((Number(ranks[id]) || 0) < 1) continue;
      const def = SKILLS[id];
      if (!def) continue;
      if (def.type === "passive") return true;
      if (loadout.map(String).includes(id)) return true;
    }
    return false;
  }

  private mount() {
    if (this.root) return;
    const r = document.createElement("div");
    r.id = "tut-card";
    r.className = "tut-card";
    r.setAttribute("role", "status");
    r.innerHTML = `<div class="tut-head"><span class="tut-kicker">First steps</span><span class="tut-count"></span>
      <button type="button" class="tut-skip" aria-label="Skip tutorial">Skip</button></div>
      <div class="tut-title"></div><div class="tut-text"></div><div class="tut-dots"></div>`;
    r.querySelector(".tut-skip")!.addEventListener("click", (ev) => {
      ev.stopPropagation();
      this.finish(true);
    });
    // On <body> (not #hud) so it stacks above open modals (#panels z=20), like toasts
    document.body.appendChild(r);
    this.root = r;
  }

  private render() {
    if (!this.root) return;
    const s = STEPS[this.step];
    this.root.querySelector(".tut-count")!.textContent = `${this.step + 1}/${STEPS.length}`;
    this.root.querySelector(".tut-title")!.textContent = s.title;
    this.root.querySelector(".tut-text")!.textContent = s.text();
    const dots = this.root.querySelector(".tut-dots")!;
    dots.innerHTML = STEPS.map((_, i) => `<i class="${i < this.step ? "on" : i === this.step ? "cur" : ""}"></i>`).join("");
    this.root.classList.remove("tut-pop");
    void this.root.offsetWidth;
    this.root.classList.add("tut-pop");
  }

  private advance() {
    this.step++;
    if (this.step >= STEPS.length) return this.finish(false);
    if (STEPS[this.step].id === "tree" && !this.xpAsked) {
      this.xpAsked = true;
      this.ctx.send({ type: "tutorial", step: "xp" });
    }
    this.render();
  }

  /** Pulse the HUD control the current step talks about (skills button, attack/skill 1 on phones). */
  private glow(id: string) {
    if (id === this.glowId) return;
    if (this.glowId) document.getElementById(this.glowId)?.classList.remove("tut-glow");
    this.glowId = id;
    if (id) document.getElementById(id)?.classList.add("tut-glow");
  }

  private glowFor(stepId: string): string {
    if (stepId === "tree") return "btn-skills";
    if (stepId === "slash" && touch()) return "btn-attack";
    return "";
  }

  private finish(skipped: boolean) {
    if (!this.active) return;
    this.active = false;
    this.glow("");
    this.ctx.send({ type: "tutorial", step: skipped ? "skip" : "done" });
    this.root?.remove();
    this.root = null;
    if (!skipped) this.ctx.toast("You're ready, pilgrim. Abandon all hope… or don't.");
  }

  private treeOpen(): boolean {
    const p = document.querySelector(".sk-panel");
    return !!p && !p.classList.contains("hidden");
  }

  /** ~5 Hz from the render loop. */
  tick(now: number) {
    if (now < this.nextTick) return;
    this.nextTick = now + 200;
    const prog = this.ctx.prog();
    if (!this.decided) {
      if (!prog || prog.tut == null) return;
      this.decided = true;
      const tut = Number(prog.tut) || 0;
      if (tut >= 2 || this.ctx.canto() !== "inferno_01") return;
      this.active = true;
      if (tut === 1) {
        this.xpAsked = true;
        this.step = 3; // already slashed & cast last time — resume at the tree
      }
      this.mount();
      this.render();
    }
    if (!this.active) return;
    const canto = this.ctx.canto();
    if (canto && canto !== "inferno_01") {
      // walked through the gate (or travelled) — onboarding served its purpose
      this.finish(false);
      return;
    }
    const pos = this.ctx.pos();
    if (pos) {
      if (this.last) {
        const d = Math.hypot(pos.x - this.last.x, pos.y - this.last.y);
        if (d < 3) this.walked += d;
      }
      this.last = { x: pos.x, y: pos.y };
      if (!this.start) this.start = { ...pos };
    }
    this.root?.classList.toggle("tut-over", this.treeOpen());
    const id = STEPS[this.step].id;
    this.glow(this.glowFor(id));
    if (id === "move" && this.walked >= 4) this.advance();
    else if (id === "slash" && this.flags.attack) this.advance();
    else if (id === "cast" && this.flags.cast) this.advance();
    else if (id === "tree") {
      if (this.baseLearned < 0 && prog) this.baseLearned = this.learnedCount(prog);
      if (this.treeOpen()) this.advance();
    } else if (id === "learn") {
      // Equipped (or a passive) → done; learned an active and closed the tree → also fine
      if (prog && (this.equippedLearned(prog) || (this.learnedCount(prog) > Math.max(0, this.baseLearned) && !this.treeOpen()))) {
        this.advance();
      }
    } else if (id === "gate") {
      const g = this.ctx.lustGate();
      if (g && pos && Math.hypot(g.x - pos.x, g.y - pos.y) < 7) this.finish(false);
    }
  }
}
