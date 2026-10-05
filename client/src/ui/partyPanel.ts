/**
 * Party UI (server/src/party.mjs): a small always-on frame while in a party, a modal
 * (menu → "Party", key P) to invite nearby pilgrims / leave / kick, and an invite card.
 */
import { togglePanel } from "./hud";

type Member = { id: string; name: string; online: boolean; canto: string | null; hp: number; maxHp: number; level?: number };
type Party = { id: string; leader: string; max: number; members: Member[] };

export type PartyCtx = {
  send: (msg: object) => void;
  youId: () => string;
  /** Other pilgrims in your room with distance, nearest first. */
  nearby: () => { id: string; name: string; lv?: number; dist: number }[];
  cantoName: (id: string | null) => string;
};

const INVITE_RANGE = 24;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (parent) parent.appendChild(e);
  return e;
}

export class PartyPanel {
  party: Party | null = null;
  private root: HTMLElement;
  private body: HTMLElement;
  private frame: HTMLElement;
  private inviteCard: HTMLElement | null = null;
  private inviteTimer = 0;
  private repaintAt = 0;
  /** Last painted state: the 1 Hz refresh only rebuilds when it changed (a rebuilt
   * button under a finger would swallow the tap). */
  private paintKey = "";
  /** Invites sent from this panel (target id → expiry ms): the button reads "Invited". */
  private invited = new Map<string, number>();

  constructor(private ctx: PartyCtx) {
    const panels = document.getElementById("panels") || document.body;
    this.root = el("aside", "panel modal hidden", panels);
    this.root.id = "party-panel";
    this.root.setAttribute("aria-label", "Party");
    const head = el("div", "panel-head", this.root);
    el("h2", "", head).textContent = "Party";
    const close = el("button", "btn-close", head);
    close.type = "button";
    close.setAttribute("aria-label", "Close party");
    close.textContent = "✕";
    close.addEventListener("click", (e) => {
      e.preventDefault();
      if (this.isOpen()) togglePanel("party-panel");
    });
    this.body = el("div", "party-scroll", this.root);
    this.frame = el("div", "party-frame hidden", document.getElementById("hud") || document.body);
    this.frame.addEventListener("click", () => this.toggle());
    window.addEventListener("keydown", (e) => {
      if (e.repeat || e.code !== "KeyP") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      this.toggle();
    });
  }

  isOpen() {
    return !this.root.classList.contains("hidden");
  }

  toggle() {
    const opening = !this.isOpen();
    togglePanel("party-panel");
    if (opening) {
      this.ctx.send({ type: "party_get" });
      this.paint(true);
    }
  }

  isMate(id: string): boolean {
    return !!this.party?.members.some((m) => m.id === id) && id !== this.ctx.youId();
  }

  onMessage(msg: any): boolean {
    if (msg?.type === "party") {
      this.party = msg.party || null;
      this.paintFrame();
      if (this.isOpen()) this.paint();
      return true;
    }
    if (msg?.type === "party_invite") {
      this.showInvite(String(msg.fromId), String(msg.fromName || "A pilgrim"));
      return true;
    }
    if (msg?.type === "party_invite_result") {
      const tid = String(msg.targetId || "");
      const status = String(msg.status || "");
      if (!tid) return true;
      if (status === "pending") {
        // Server confirmed the invite — keep the button locked for the invite window.
        this.invited.set(tid, performance.now() + 30_000);
      } else {
        this.invited.delete(tid);
      }
      if (this.isOpen()) this.paint(true);
      return true;
    }
    return false;
  }

  /** ~2 Hz: keep the "nearby" list fresh while the modal is open. */
  tick(now: number) {
    if (!this.isOpen() || now < this.repaintAt) return;
    this.repaintAt = now + 1000;
    this.paint();
  }

  private showInvite(fromId: string, fromName: string) {
    this.inviteCard?.remove();
    window.clearTimeout(this.inviteTimer);
    const c = el("div", "party-invite", document.body);
    el("div", "party-invite-t", c).textContent = `${fromName} invites you to a party`;
    el("div", "party-invite-s", c).textContent = "Kills near your party share XP.";
    const row = el("div", "party-invite-row", c);
    const yes = el("button", "party-btn party-yes", row);
    yes.type = "button";
    yes.textContent = "Join";
    const no = el("button", "party-btn", row);
    no.type = "button";
    no.textContent = "Decline";
    const done = (accept: boolean) => {
      this.ctx.send({ type: "party_respond", fromId, accept });
      c.remove();
      if (this.inviteCard === c) this.inviteCard = null;
    };
    yes.addEventListener("click", () => done(true));
    no.addEventListener("click", () => done(false));
    this.inviteCard = c;
    this.inviteTimer = window.setTimeout(() => {
      if (this.inviteCard === c) {
        c.remove();
        this.inviteCard = null;
      }
    }, 28_000);
  }

  private paintFrame() {
    const p = this.party;
    this.frame.classList.toggle("hidden", !p);
    if (!p) return;
    const you = this.ctx.youId();
    this.frame.textContent = "";
    for (const m of p.members) {
      if (m.id === you) continue;
      const row = el("div", `party-mem${m.online ? "" : " off"}`, this.frame);
      const name = el("span", "party-mem-n", row);
      name.textContent = `${m.id === p.leader ? "♛ " : ""}${m.name}${m.level ? ` · ${m.level}` : ""}`;
      const bar = el("span", "party-mem-hp", row);
      const fill = el("i", "", bar);
      fill.style.width = `${m.maxHp > 0 ? Math.round((100 * m.hp) / m.maxHp) : 0}%`;
      el("span", "party-mem-c", row).textContent = m.online ? this.ctx.cantoName(m.canto) : "offline";
    }
  }

  private paint(force = false) {
    const b = this.body;
    const p = this.party;
    const you = this.ctx.youId();
    const nearKey = this.ctx
      .nearby()
      .filter((n) => n.dist <= INVITE_RANGE)
      .map((n) => `${n.id}:${n.lv ?? ""}:${Math.round(n.dist / 4)}`)
      .join(",");
    const partyKey = p ? `${p.leader}|${p.members.map((m) => `${m.id}:${m.online ? 1 : 0}:${m.canto}:${m.level ?? ""}`).join(",")}` : "-";
    const now = performance.now();
    for (const [id, until] of this.invited) if (until <= now || p?.members.some((m) => m.id === id)) this.invited.delete(id);
    const key = `${you}#${partyKey}#${nearKey}#${[...this.invited.keys()].join(",")}`;
    if (!force && key === this.paintKey) return;
    this.paintKey = key;
    b.textContent = "";
    const sec = el("section", "party-sec", b);
    if (p) {
      el("h3", "", sec).textContent = `Your party (${p.members.length}/${p.max})`;
      for (const m of p.members) {
        const row = el("div", "party-row", sec);
        el("span", "party-row-n", row).textContent =
          `${m.id === p.leader ? "♛ " : ""}${m.name}${m.id === you ? " (you)" : ""}${m.level ? ` · Lv ${m.level}` : ""}`;
        el("span", "party-row-c", row).textContent = m.online ? this.ctx.cantoName(m.canto) : "offline";
        if (p.leader === you && m.id !== you) {
          const k = el("button", "party-btn", row);
          k.type = "button";
          k.textContent = "Remove";
          k.addEventListener("click", () => this.ctx.send({ type: "party_kick", targetId: m.id }));
        }
      }
      const leave = el("button", "party-btn party-leave", sec);
      leave.type = "button";
      leave.textContent = "Leave party";
      leave.addEventListener("click", () => this.ctx.send({ type: "party_leave" }));
    } else {
      el("h3", "", sec).textContent = "No party";
      el("p", "party-note", sec).textContent =
        "Invite up to 2 pilgrims. Party members within reach in the same canto share every kill's XP (+10% per extra member).";
    }
    const canInvite = !p || (p.leader === you && p.members.length < p.max);
    const near = el("section", "party-sec", b);
    el("h3", "", near).textContent = "Pilgrims nearby";
    const list = this.ctx.nearby().filter((n) => n.dist <= INVITE_RANGE && !p?.members.some((m) => m.id === n.id));
    if (!list.length) el("p", "party-note", near).textContent = "No one close by. Walk up to a pilgrim to invite them.";
    else if (p && p.leader !== you) el("p", "party-note", near).textContent = "Only the party leader (♛) can invite.";
    else if (p && p.members.length >= p.max) el("p", "party-note", near).textContent = `Your party is full (${p.max}/${p.max}).`;
    for (const n of list.slice(0, 8)) {
      const row = el("div", "party-row", near);
      el("span", "party-row-n", row).textContent = `${n.name}${n.lv ? ` · Lv ${n.lv}` : ""}`;
      el("span", "party-row-c", row).textContent = n.dist < 1 ? "beside you" : `${Math.round(n.dist)} m`;
      if (canInvite) {
        const pending = this.invited.has(n.id);
        const inv = el("button", `party-btn${pending ? "" : " party-yes"}`, row);
        inv.type = "button";
        inv.textContent = pending ? "Invited" : "Invite";
        inv.disabled = pending;
        if (!pending) {
          inv.addEventListener("click", () => {
            this.ctx.send({ type: "party_invite", targetId: n.id });
            // Optimistic lock until party_invite_result (declined / expired / failed / accepted).
            this.invited.set(n.id, performance.now() + 30_000);
            this.paint(true);
          });
        }
      }
    }
  }
}
