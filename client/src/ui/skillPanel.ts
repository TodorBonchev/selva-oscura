/**
 * Skill tree sheet. Server skill_result and the prog snapshot are the truth;
 * a loadout drop paints immediately and the next snapshot overwrites it.
 */
import {
  BRANCHES,
  SKILLS,
  canLearn,
  cooldownAtRank,
  effectAtRank,
  manaCostAtRank,
  pvpNote,
  requiredLevel,
  respecAsh,
  skillLabel,
  skillsByBranch,
  type BranchId,
  type SkillDef,
} from "../skills";
import { isCompactUi, setPanelOpen } from "./hud";
import { skillIcon } from "./skillIcons";

export type ProgView = {
  level: number;
  xp: number;
  xpToNext: number;
  xpIntoLevel: number;
  points: number;
  ranks: Record<string, number>;
  loadout: (string | null)[];
};

type Api = {
  learn: (skillId: string) => void;
  loadout: (slots: (string | null)[]) => void;
  respec: () => void;
};

const BRANCH_ORDER: BranchId[] = ["ira", "fede", "ombra", "fortezza"];
const TIER_LEVELS = [1, 6, 12, 18, 24, 30];

let panel: SkillPanel | null = null;

export function mountSkillPanel(api: Api): SkillPanel {
  panel = new SkillPanel(api);
  return panel;
}

export function skillPanel(): SkillPanel | null {
  return panel;
}

export function skillErrorText(error: string, skillId?: string, level = 1): string {
  const def = skillId ? SKILLS[skillId] : undefined;
  switch (error) {
    case "rate":
      return "Too many skill changes.";
    case "no_points":
      return "No skill points remaining.";
    case "level":
      return `Requires level ${def ? requiredLevel(def) : 1}.`;
    case "prereq":
      return "A linked skill is not ranked high enough.";
    case "max_rank":
      return `${def?.name || "That skill"} is already at max rank.`;
    case "unknown":
    case "bad_id":
      return "Unknown skill.";
    case "ash":
      return `Respec costs ${respecAsh(level)} Ash.`;
    case "busy":
      return "You cannot respec in the middle of a fight.";
    case "duplicate":
      return "A skill may only occupy one slot.";
    case "not_active":
      return "Only learned active skills can be equipped.";
    case "unlearned":
      return "That skill is not learned.";
    case "bad_slots":
      return "Loadout must be four slots.";
    default:
      return "Cannot learn that.";
  }
}

class SkillPanel {
  readonly root: HTMLElement;
  private api: Api;
  private server: ProgView = emptyProg();
  private viewLoadout: (string | null)[] = [null, null, null, null];
  private ash = 0;
  private sig = "";
  private selected = "gale_bolt";
  private branch: BranchId = "ira";
  private suppressClick = false;
  private learnLock = 0;
  private pointsEl: HTMLElement;
  private respecBtn: HTMLButtonElement;
  private tree: HTMLElement;
  private detail: HTMLElement;
  private loadoutEl: HTMLElement;
  private confirm: HTMLElement;
  private confirmText: HTMLElement;

  constructor(api: Api) {
    this.api = api;
    const root = document.createElement("aside");
    root.id = "skills";
    root.className = "panel modal sk-panel hidden";
    root.setAttribute("aria-label", "Skills");
    root.innerHTML = `
      <div class="panel-head sk-head">
        <h2>Skills</h2>
        <div class="sk-points">Points <b id="sk-points">0</b></div>
        <button id="sk-respec" type="button">Respec</button>
        <button type="button" class="btn-close" data-close="skills" aria-label="Close skills">✕</button>
      </div>
      <div class="sk-loadout" id="sk-loadout" aria-label="Loadout"></div>
      <div class="sk-tabs" id="sk-tabs" role="tablist"></div>
      <div class="sk-body">
        <div class="sk-tree" id="sk-tree"></div>
        <aside class="sk-detail" id="sk-detail"></aside>
      </div>
      <div class="sk-confirm hidden" id="sk-confirm" role="dialog" aria-label="Confirm respec">
        <p id="sk-confirm-text"></p>
        <div class="sk-confirm-row">
          <button id="sk-confirm-yes" type="button">Confirm</button>
          <button id="sk-confirm-no" type="button">Cancel</button>
        </div>
      </div>`;
    const host = document.getElementById("panels") || document.body;
    host.appendChild(root);
    this.root = root;
    this.pointsEl = root.querySelector("#sk-points")!;
    this.respecBtn = root.querySelector("#sk-respec")!;
    this.tree = root.querySelector("#sk-tree")!;
    this.detail = root.querySelector("#sk-detail")!;
    this.loadoutEl = root.querySelector("#sk-loadout")!;
    this.confirm = root.querySelector("#sk-confirm")!;
    this.confirmText = root.querySelector("#sk-confirm-text")!;

    const tabs = root.querySelector("#sk-tabs")!;
    for (const id of BRANCH_ORDER) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "sk-tab";
      b.dataset.branch = id;
      b.textContent = BRANCHES[id].name;
      b.title = BRANCHES[id].edge;
      b.addEventListener("click", () => {
        this.branch = id;
        this.paintTabs();
        this.applyBranchVisibility();
        this.drawWires();
      });
      tabs.appendChild(b);
    }
    this.respecBtn.addEventListener("click", () => this.openConfirm());
    root.querySelector("#sk-confirm-no")?.addEventListener("click", () => {
      this.confirm.classList.add("hidden");
    });
    root.querySelector("#sk-confirm-yes")?.addEventListener("click", () => {
      this.confirm.classList.add("hidden");
      this.api.respec();
    });
    window.addEventListener("resize", () => this.drawWires());
    this.paint();
  }

  sync(prog: ProgView, ash: number) {
    const next = normalize(prog);
    const sig = JSON.stringify([next.level, next.points, next.ranks, next.loadout, ash]);
    this.server = next;
    this.ash = ash;
    if (sig === this.sig) return;
    this.sig = sig;
    this.viewLoadout = next.loadout.slice();
    this.paint();
  }

  onResult(msg: { ok?: boolean; op?: string }) {
    this.learnLock = 0;
    if (!msg.ok) {
      this.viewLoadout = this.server.loadout.slice();
      this.sig = "";
      this.paint();
      return;
    }
    if (msg.op === "respec") this.confirm.classList.add("hidden");
  }

  private paint() {
    this.pointsEl.textContent = String(this.server.points);
    const cost = respecAsh(this.server.level);
    this.respecBtn.textContent = `Respec · ${cost.toLocaleString()} Ash`;
    this.respecBtn.disabled = this.ash < cost;
    this.paintTabs();
    this.paintLoadout();
    this.paintTree();
    this.paintDetail();
    requestAnimationFrame(() => this.drawWires());
  }

  private paintTabs() {
    this.root.querySelectorAll<HTMLButtonElement>(".sk-tab").forEach((b) => {
      const on = b.dataset.branch === this.branch;
      b.classList.toggle("on", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
  }

  private paintLoadout() {
    this.loadoutEl.replaceChildren();
    for (let i = 0; i < 4; i++) {
      const slot = document.createElement("button");
      slot.type = "button";
      slot.className = "sk-slot";
      slot.dataset.slot = String(i);
      const id = this.viewLoadout[i];
      const def = id ? SKILLS[id] : undefined;
      if (def) {
        slot.innerHTML = `<img alt="" draggable="false" src="${skillIcon(def.id)}" /><span>${skillLabel(def).title}</span><i>${i + 1}</i><b class="sk-slot-clear" title="Unequip">×</b>`;
        const clearBtn = slot.querySelector(".sk-slot-clear");
        clearBtn?.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.clearSlot(i);
        });
      } else {
        slot.innerHTML = `<span class="sk-slot-empty">Empty</span><i>${i + 1}</i>`;
      }
      slot.addEventListener("dragover", (e) => {
        e.preventDefault();
        slot.classList.add("drop");
      });
      slot.addEventListener("dragleave", () => slot.classList.remove("drop"));
      slot.addEventListener("drop", (e) => {
        e.preventDefault();
        slot.classList.remove("drop");
        const sid = e.dataTransfer?.getData("text/skill") || "";
        if (sid) this.assign(i, sid);
      });
      slot.addEventListener("click", () => {
        if (id) this.select(id);
      });
      slot.addEventListener("contextmenu", (e) => {
        // Long-press on phones fires contextmenu: never unequip by accident; × does that.
        e.preventDefault();
        if (id) this.select(id);
      });
      this.loadoutEl.appendChild(slot);
    }
  }

  private paintTree() {
    this.tree.replaceChildren();
    for (const branch of BRANCH_ORDER) {
      const col = document.createElement("section");
      col.className = "sk-col";
      col.dataset.branch = branch;
      const meta = BRANCHES[branch];
      const head = document.createElement("header");
      head.innerHTML = `<b>${meta.name}</b><span>${meta.subtitle}</span>`;
      head.title = meta.edge;
      col.appendChild(head);
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.classList.add("sk-wires");
      col.appendChild(svg);
      const list = skillsByBranch(branch);
      for (const lv of TIER_LEVELS) {
        const rowSkills = list.filter((s) => requiredLevel(s) === lv);
        if (!rowSkills.length) continue;
        const row = document.createElement("div");
        row.className = "sk-tier";
        const tag = document.createElement("div");
        tag.className = "sk-tier-lv";
        tag.textContent = String(lv);
        row.appendChild(tag);
        const nodes = document.createElement("div");
        nodes.className = "sk-nodes";
        for (const def of rowSkills) nodes.appendChild(this.node(def));
        row.appendChild(nodes);
        col.appendChild(row);
      }
      this.tree.appendChild(col);
    }
    this.applyBranchVisibility();
  }

  private node(def: SkillDef): HTMLButtonElement {
    const rank = Math.floor(Number(this.server.ranks[def.id]) || 0);
    const gate = canLearn(def, this.server);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "sk-node";
    btn.dataset.id = def.id;
    if (rank >= def.maxRank) btn.classList.add("maxed");
    else if (rank > 0) btn.classList.add("ranked");
    else if (gate.ok || gate.error === "no_points") btn.classList.add("available");
    else btn.classList.add("locked");
    if (def.id === this.selected) btn.classList.add("selected");
    const lab = skillLabel(def);
    btn.innerHTML = `<img alt="" draggable="false" src="${skillIcon(def.id)}" /><b>${lab.title}</b><small>${def.type === "active" ? "Active" : "Passive"}</small><em>${rank}/${def.maxRank}</em>`;
    if (def.type === "active" && rank > 0) btn.draggable = true;
    let longFired = false;
    let timer = 0;
    btn.addEventListener("pointerdown", () => {
      longFired = false;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        longFired = true;
        this.select(def.id);
      }, 420);
    });
    const clear = () => window.clearTimeout(timer);
    btn.addEventListener("pointerup", clear);
    btn.addEventListener("pointercancel", clear);
    btn.addEventListener("pointerleave", clear);
    btn.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      this.select(def.id);
    });
    btn.addEventListener("dragstart", (e) => {
      this.suppressClick = true;
      this.select(def.id);
      e.dataTransfer?.setData("text/skill", def.id);
      e.dataTransfer?.setData("text/plain", def.id);
    });
    btn.addEventListener("click", () => {
      if (this.suppressClick) {
        this.suppressClick = false;
        this.select(def.id);
        return;
      }
      if (longFired) {
        longFired = false;
        return;
      }
      this.select(def.id);
    });
    return btn;
  }

  private applyBranchVisibility() {
    const compact = isCompactUi();
    this.tree.querySelectorAll<HTMLElement>(".sk-col").forEach((col) => {
      const on = !compact || col.dataset.branch === this.branch;
      col.classList.toggle("on", on);
      col.hidden = compact && !on;
    });
  }

  private select(id: string) {
    this.selected = id;
    const def = SKILLS[id];
    if (def && def.branch !== this.branch) {
      this.branch = def.branch;
      this.paintTabs();
      this.applyBranchVisibility();
      requestAnimationFrame(() => this.drawWires());
    }
    this.tree.querySelectorAll<HTMLElement>(".sk-node").forEach((n) => {
      n.classList.toggle("selected", n.dataset.id === id);
    });
    this.paintDetail();
    if (isCompactUi()) this.detail.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  private learn(id: string) {
    if (performance.now() < this.learnLock) return;
    const def = SKILLS[id];
    if (!def || !canLearn(def, this.server).ok) return;
    this.learnLock = performance.now() + 220;
    this.api.learn(id);
  }

  private assign(slot: number, id: string) {
    const def = SKILLS[id];
    const rank = Math.floor(Number(this.server.ranks[id]) || 0);
    if (!def || def.type !== "active" || rank < 1) return;
    const next = this.viewLoadout.slice(0, 4);
    while (next.length < 4) next.push(null);
    for (let i = 0; i < 4; i++) if (next[i] === id) next[i] = null;
    next[slot] = id;
    this.viewLoadout = next;
    this.paintLoadout();
    this.api.loadout(next);
  }

  private clearSlot(slot: number) {
    const next = this.viewLoadout.slice(0, 4);
    while (next.length < 4) next.push(null);
    next[slot] = null;
    this.viewLoadout = next;
    this.paintLoadout();
    this.api.loadout(next);
  }

  private paintDetail() {
    const def = SKILLS[this.selected] || SKILLS.gale_bolt;
    if (!def) return;
    const rank = Math.floor(Number(this.server.ranks[def.id]) || 0);
    const lab = skillLabel(def);
    const branch = BRANCHES[def.branch];
    const gate = canLearn(def, this.server);
    const showRank = Math.max(1, rank);
    const mana = def.manaCost != null ? manaCostAtRank(def, showRank) : 0;
    const cd = def.cooldown != null ? cooldownAtRank(def, showRank, Number(this.server.ranks.silenzio) || 0) : 0;
    const nextMana = def.manaCost != null && rank < def.maxRank ? manaCostAtRank(def, rank + 1) : 0;
    const nextCd =
      def.cooldown != null && rank < def.maxRank
        ? cooldownAtRank(def, Math.max(1, rank + 1), Number(this.server.ranks.silenzio) || 0)
        : 0;
    const reqs: string[] = [];
    const needLv = requiredLevel(def);
    if (this.server.level < needLv) reqs.push(`<li class="bad">Requires level ${needLv}</li>`);
    for (const p of def.prereqs) {
      const have = Math.floor(Number(this.server.ranks[p.id]) || 0);
      const name = SKILLS[p.id] ? skillLabel(SKILLS[p.id]).title : p.id;
      reqs.push(`<li class="${have >= p.rank ? "" : "bad"}">${name} rank ${p.rank}</li>`);
    }
    if (this.server.points < 1 && rank < def.maxRank) reqs.push(`<li class="bad">No skill points remaining.</li>`);
    const note = pvpNote(def.id);
    const cur = rank > 0 ? effectAtRank(def.id, rank) : "Unlearned";
    const nxt = rank >= def.maxRank ? "Max rank" : effectAtRank(def.id, rank + 1);
    const costLine =
      def.type === "active"
        ? `<div class="sk-meta">${mana} mana · ${trimNum(cd)}s${rank < def.maxRank ? ` → ${nextMana} mana · ${trimNum(nextCd)}s` : ""}</div>`
        : `<div class="sk-meta">Passive</div>`;
    const why = !gate.ok ? skillErrorText(gate.error || "unknown", def.id, this.server.level) : "";
    const learnLabel =
      rank >= def.maxRank ? "Max rank" : rank > 0 ? `Learn rank ${rank + 1}` : "Learn";
    const equippedAt = this.viewLoadout.findIndex((s) => s === def.id);
    const canEquip = def.type === "active" && rank > 0;
    const slots = [0, 1, 2, 3]
      .map((i) => {
        const on = this.viewLoadout[i] === def.id ? " on" : "";
        return `<button type="button" class="sk-equip-slot${on}" data-slot="${i}" ${canEquip ? "" : "disabled"}>Slot ${i + 1}</button>`;
      })
      .join("");
    this.detail.innerHTML = `
      <img class="sk-detail-icon" alt="" src="${skillIcon(def.id)}" />
      <h3>${lab.title}</h3>
      <div class="sk-meta">${branch.name} · ${branch.subtitle} · ${def.type === "active" ? "Active" : "Passive"} · ${rank}/${def.maxRank}</div>
      ${costLine}
      <p class="sk-now"><b>Now.</b> ${cur}</p>
      <p class="sk-next"><b>Next.</b> ${nxt}</p>
      ${reqs.length ? `<ul class="sk-reqs">${reqs.join("")}</ul>` : ""}
      ${note ? `<p class="sk-pvp">${note}</p>` : ""}
      <button id="sk-learn" type="button" ${gate.ok ? "" : "disabled"}>${learnLabel}</button>
      ${why && !gate.ok ? `<p class="sk-learn-why" id="sk-learn-why">${why}</p>` : ""}
      ${
        canEquip
          ? `<div class="sk-equip"><span>Equip to slot</span><div class="sk-equip-row">${slots}</div>${
              equippedAt >= 0
                ? `<button type="button" id="sk-unequip" class="sk-unequip">Unequip from slot ${equippedAt + 1}</button>`
                : ""
            }</div>`
          : ""
      }`;
    this.detail.querySelector("#sk-learn")?.addEventListener("click", () => this.learn(def.id));
    this.detail.querySelectorAll<HTMLButtonElement>(".sk-equip-slot").forEach((b) => {
      b.addEventListener("click", () => this.assign(Number(b.dataset.slot), def.id));
    });
    this.detail.querySelector("#sk-unequip")?.addEventListener("click", () => {
      if (equippedAt >= 0) this.clearSlot(equippedAt);
    });
  }

  private openConfirm() {
    const cost = respecAsh(this.server.level);
    this.confirmText.textContent =
      this.ash < cost
        ? `Respec costs ${cost.toLocaleString()} Ash.`
        : `Respec costs ${cost.toLocaleString()} Ash. Ranks return to the three free skills.`;
    this.confirm.classList.remove("hidden");
    const yes = this.confirm.querySelector<HTMLButtonElement>("#sk-confirm-yes");
    if (yes) yes.disabled = this.ash < cost;
  }

  private drawWires() {
    const compact = isCompactUi();
    this.tree.querySelectorAll<HTMLElement>(".sk-col").forEach((col) => {
      const svg = col.querySelector("svg");
      if (!svg) return;
      svg.replaceChildren();
      if (compact && col.hidden) return;
      const w = col.clientWidth;
      const h = col.clientHeight;
      svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
      svg.setAttribute("width", String(w));
      svg.setAttribute("height", String(h));
      const byId = new Map<string, HTMLElement>();
      col.querySelectorAll<HTMLElement>(".sk-node").forEach((n) => {
        if (n.dataset.id) byId.set(n.dataset.id, n);
      });
      const cr = col.getBoundingClientRect();
      for (const [id, node] of byId) {
        const def = SKILLS[id];
        if (!def) continue;
        for (const p of def.prereqs) {
          const from = byId.get(p.id);
          if (!from) continue;
          const a = from.getBoundingClientRect();
          const b = node.getBoundingClientRect();
          const x1 = a.left + a.width / 2 - cr.left;
          const y1 = a.bottom - cr.top;
          const x2 = b.left + b.width / 2 - cr.left;
          const y2 = b.top - cr.top;
          const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
          const mid = (y1 + y2) / 2;
          path.setAttribute("d", `M ${x1} ${y1} C ${x1} ${mid}, ${x2} ${mid}, ${x2} ${y2}`);
          path.setAttribute("fill", "none");
          path.setAttribute("stroke", "#c9a227");
          path.setAttribute("stroke-width", "1.4");
          path.setAttribute("opacity", "0.75");
          svg.appendChild(path);
        }
      }
    });
  }
}

function emptyProg(): ProgView {
  return { level: 1, xp: 0, xpToNext: 100, xpIntoLevel: 0, points: 0, ranks: {}, loadout: [null, null, null, null] };
}

function normalize(prog: ProgView): ProgView {
  const loadout = Array.isArray(prog.loadout) ? prog.loadout.slice(0, 4) : [];
  while (loadout.length < 4) loadout.push(null);
  return {
    level: Number(prog.level) || 1,
    xp: Number(prog.xp) || 0,
    xpToNext: Number(prog.xpToNext) || 0,
    xpIntoLevel: Number(prog.xpIntoLevel) || 0,
    points: Number(prog.points) || 0,
    ranks: prog.ranks || {},
    loadout: loadout.map((s) => (s ? String(s) : null)),
  };
}

function trimNum(n: number): string {
  const v = Math.round(n * 10) / 10;
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

/** Open or close the sheet (K, the Skills button, Esc). */
export function toggleSkills() {
  const el = document.getElementById("skills");
  if (!el) return;
  setPanelOpen("skills", el.classList.contains("hidden"));
}
