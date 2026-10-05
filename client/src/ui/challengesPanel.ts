/**
 * Challenges panel: today's challenge (arena or circles), this week's boss race, and the cosmetic
 * titles / nameplate flair they unlock (server/src/challenges.mjs). Opened from the
 * top-right menu ("Challenges", key J). Cosmetic only — nothing here changes stats.
 */
import { togglePanel } from "./hud";

type Payload = {
  day: string;
  daily: { id: string; text: string; goal: number; progress: number; done: boolean; resetsInMs: number };
  week: string;
  weekly: {
    boss: string;
    canto: string;
    done: boolean;
    rank: number;
    finishers: number;
    resetsInMs: number;
    top: { rank: number; name: string; at: number }[];
  };
  totals: { dailies: number; weeklies: number };
  cosmetics: { id: string; kind: "title" | "flair"; label: string; desc: string; owned: boolean }[];
  wearing: { title: string | null; flair: string | null };
};

const CANTO_NAME: Record<string, string> = {
  inferno_05: "Lust",
  inferno_06: "Gluttony",
  inferno_07: "Avarice",
  inferno_08: "Wrath",
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (parent) parent.appendChild(e);
  return e;
}

function dur(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60000));
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  const mm = m % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${mm}m`;
  return `${mm}m`;
}

export class ChallengesPanel {
  private root: HTMLElement;
  private body: HTMLElement;
  private last: Payload | null = null;
  private gotAt = 0;
  private loadTimer = 0;

  constructor(private send: (msg: object) => void) {
    const panels = document.getElementById("panels") || document.body;
    this.root = el("aside", "panel modal hidden", panels);
    this.root.id = "chal-panel";
    this.root.setAttribute("aria-label", "Challenges");
    const head = el("div", "panel-head", this.root);
    el("h2", "", head).textContent = "Challenges";
    const close = el("button", "btn-close", head);
    close.type = "button";
    close.setAttribute("data-close", "chal-panel");
    close.setAttribute("aria-label", "Close challenges");
    close.textContent = "✕";
    close.addEventListener("click", (e) => {
      e.preventDefault();
      if (!this.root.classList.contains("hidden")) togglePanel("chal-panel");
    });
    this.body = el("div", "chal-scroll", this.root);
    this.body.textContent = "Loading…";
    window.addEventListener("keydown", (e) => {
      if (e.repeat || e.code !== "KeyJ") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      this.toggle();
    });
  }

  toggle() {
    const opening = this.root.classList.contains("hidden");
    togglePanel("chal-panel");
    if (opening) this.request();
    else window.clearTimeout(this.loadTimer);
  }

  private request() {
    this.last = null;
    this.body.textContent = "Loading…";
    this.send({ type: "challenges_get" });
    window.clearTimeout(this.loadTimer);
    this.loadTimer = window.setTimeout(() => {
      if (!this.isOpen()) return;
      // Still waiting on the board — offer a retry instead of hanging on Loading…
      if (this.body.textContent !== "Loading…") return;
      this.body.textContent = "";
      const note = el("p", "chal-note", this.body);
      note.textContent = "Couldn’t reach the challenge board. Check your connection and try again.";
      const btn = el("button", "chal-cos-item owned", this.body);
      btn.type = "button";
      btn.style.marginTop = "0.5rem";
      btn.textContent = "Retry";
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        this.last = null;
        this.request();
      });
    }, 6000);
  }

  isOpen(): boolean {
    return !this.root.classList.contains("hidden");
  }

  paint(msg: Payload) {
    this.last = msg;
    this.gotAt = performance.now();
    window.clearTimeout(this.loadTimer);
    const b = this.body;
    b.textContent = "";
    // — daily —
    const d = msg.daily;
    const ds = el("section", "chal-sec", b);
    el("h3", "", ds).textContent = "Daily challenge";
    el("p", "chal-task", ds).textContent = d.text;
    const track = el("div", "chal-track", ds);
    const fill = el("i", "", track);
    fill.style.width = `${Math.round((100 * Math.min(d.goal, d.progress)) / Math.max(1, d.goal))}%`;
    el("p", "chal-meta", ds).textContent = d.done
      ? `Complete ✓ · new challenge in ${dur(d.resetsInMs)}`
      : `${d.progress} / ${d.goal} · resets in ${dur(d.resetsInMs)} (UTC midnight)`;
    // — weekly —
    const w = msg.weekly;
    const ws = el("section", "chal-sec", b);
    el("h3", "", ws).textContent = "Weekly boss race";
    el("p", "chal-task", ws).textContent = `Defeat ${w.boss} in ${CANTO_NAME[w.canto] || "the Inferno"} — the first three earn a podium.`;
    el("p", "chal-meta", ws).textContent = w.done
      ? `Done ✓ — you finished #${w.rank} of ${w.finishers} · resets in ${dur(w.resetsInMs)}`
      : `${w.finishers ? `${w.finishers} finished so far` : "No one has finished yet — the podium is open"} · resets in ${dur(w.resetsInMs)} (Monday, UTC)`;
    if (w.top.length) {
      const ol = el("ol", "chal-race", ws);
      for (const r of w.top) {
        const li = el("li", r.rank <= 3 ? "podium" : "", ol);
        li.textContent = r.name;
      }
    }
    // — cosmetics —
    const cs = el("section", "chal-sec", b);
    el("h3", "", cs).textContent = "Titles & nameplate flair";
    el("p", "chal-note", cs).textContent = "Cosmetic only — no stats change. Choose an unlocked one to wear it.";
    const grid = el("div", "chal-cos", cs);
    for (const c of msg.cosmetics) {
      const wearing = (c.kind === "title" ? msg.wearing.title : msg.wearing.flair) === c.id;
      const btn = el("button", `chal-cos-item${c.owned ? " owned" : ""}${wearing ? " worn" : ""}`, grid);
      btn.type = "button";
      btn.disabled = !c.owned;
      const name = el("b", "", btn);
      name.textContent = `${c.kind === "flair" ? "◆ " : ""}${c.label}`;
      el("span", "", btn).textContent = wearing ? "Wearing — choose again to remove" : c.owned ? "Choose to wear" : c.desc;
      if (c.owned) {
        btn.addEventListener("click", (e) => {
          e.preventDefault();
          this.send({ type: "flair_set", kind: c.kind, id: wearing ? null : c.id });
        });
      }
    }
    const tot = msg.totals;
    el("p", "chal-meta", cs).textContent =
      tot.dailies || tot.weeklies
        ? `Lifetime: ${tot.dailies} daily · ${tot.weeklies} weekly`
        : "Finish a daily challenge or a weekly race to unlock your first title.";
  }
}
