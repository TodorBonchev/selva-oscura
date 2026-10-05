import { ashToStelleDisplay } from "../util/ash";
import {
  EQUIP_SLOTS,
  itemIconUrl,
  resolveEquipSlot,
  type EquipSlot,
} from "../items/icons";
import { formatItemStats, itemStatBonus, itemStatsHtml, slotLabelForItem, vendorAsh } from "../items/stats";
import {
  compareByScore,
  formatDelta,
  itemScore,
  planEquipBest,
  rarityRank,
  scoreDelta,
  wearSlotFor,
} from "../items/score";
import { SPELLS, type SpellId } from "../spells";
import { SKILLS } from "../skills";
import { placeToastLayer, pushToast } from "./toasts";

let selectedItemId: string | null = null;
let lastBagItems: any[] = [];
/** Stash mode: the bag opened from the Dark Wood stash shows the bank grid too. */
let stashMode = false;
let lastStashItems: any[] = [];
const STASH_MAX_SLOTS = 60;
let invWeighedOnly = false;
let meltArmTimer: number | null = null;
let lastHpShown: number | null = null;
let lastManaShown: number | null = null;
let lastPendingAsh = 0;
let pendingPulseTimer: number | null = null;
let helpFadeTimer: number | null = null;
let lastAshHtml = "";
let inventoryWasOpen = false;
let panelOpenHook: ((id: string) => void) | null = null;

/** Instructional overlay fades out after this long (any input re-arms nothing; it's a one-shot). */
const HELP_FADE_MS = 10_000;

/** Server cap is 40; grid shows a fixed PoE-style slab of slots. */
const INV_COLS = 6;
const INV_MIN_SLOTS = 18;
const INV_MAX_SLOTS = 40;

const RARITY_LABEL: Record<string, string> = {
  normal: "Normal",
  magic: "Magic",
  rare: "Rare",
  set: "Set",
  unique: "Unique",
  canto_unique: "Canto Unique",
};

/** Bag order: "score" (gear score ↓) or "rarity" (the older rarity ↓ / weighed / name order). */
type InvSort = "score" | "rarity";
const INV_SORT_KEY = "selva.invSort";
let invSort: InvSort = (() => {
  try {
    return localStorage.getItem(INV_SORT_KEY) === "rarity" ? "rarity" : "score";
  } catch {
    return "score";
  }
})();

function sortInventoryItems(items: any[]): any[] {
  if (invSort === "score") return [...items].sort(compareByScore);
  return [...items].sort((a, b) => {
    const rr = rarityRank(b?.rarity) - rarityRank(a?.rarity);
    if (rr) return rr;
    const sb = Number(Boolean(b?.soulbound)) - Number(Boolean(a?.soulbound));
    if (sb) return sb;
    return String(a?.name || "").localeCompare(String(b?.name || ""));
  });
}

/** Tooltip / aria line: "Score 60 (+12 vs worn)". */
function scoreLine(it: any, equipped: Record<string, any>): string {
  if (!wearSlotFor(it)) return "Score — (not wearable)";
  const d = scoreDelta(it, equipped);
  const sc = itemScore(it);
  if (d == null) return `Score ${sc} (worn)`;
  const worn = equipped?.[wearSlotFor(it) as string];
  return worn ? `Score ${sc} (${formatDelta(d)} vs worn)` : `Score ${sc} (slot empty)`;
}

function scoreBadgeHtml(it: any, equipped: Record<string, any>): string {
  if (!wearSlotFor(it)) return "";
  const d = scoreDelta(it, equipped);
  const cls = d == null ? "" : d > 0 ? " up" : d < 0 ? " down" : "";
  return `<span class="inv-score${cls}" aria-hidden="true">${itemScore(it)}</span>`;
}

function escapeHtml(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function rarityClass(r: string | undefined): string {
  const k = String(r || "normal");
  return `r-${k in RARITY_LABEL ? k : "normal"}`;
}

/**
 * Toast: level → gold (loot), bright gold (emit), crimson (warn), bone (info).
 * Queued with priorities and family collapse — see ui/toasts.ts.
 */
export function showToast(text: string, level = "info") {
  pushToast(text, level);
}

/** Fade the "how to play" tip overlay after a short grace period; call once on boot. */
export function armHelpFade(ms = HELP_FADE_MS) {
  if (helpFadeTimer != null) window.clearTimeout(helpFadeTimer);
  helpFadeTimer = window.setTimeout(() => {
    helpFadeTimer = null;
    for (const id of ["help", "help-mobile"]) {
      document.getElementById(id)?.classList.add("help-fade");
    }
  }, ms);
}

/**
 * Replay the HP-plate hurt pulse. The class comes off on `animationend`, so a hit after
 * the pulse finished starts it fresh; a hit during the pulse rewinds the running
 * animation. (Removing and re-adding the class in one task, or across a rAF, is
 * coalesced into no change unless something forces a style flush in between.)
 */
function pulseHurt(el: HTMLElement) {
  if (!el.dataset.hurtBound) {
    el.dataset.hurtBound = "1";
    el.addEventListener("animationend", (e) => {
      if (e.target === el && e.animationName === "hp-hurt") el.classList.remove("hp-hurt");
    });
  }
  if (el.classList.contains("hp-hurt")) {
    for (const a of el.getAnimations()) {
      if ((a as CSSAnimation).animationName === "hp-hurt") {
        a.currentTime = 0;
        a.play();
        return;
      }
    }
    // Class stuck on without a running pulse (e.g. reduced motion): nothing to replay
    return;
  }
  el.classList.add("hp-hurt");
}

export function updateStats(you: any, title: string, subtitleIt?: string | null) {
  const canto = document.getElementById("canto-title");
  const hp = document.getElementById("hp");
  const hpFill = document.getElementById("hp-fill");
  const hpPlate = document.getElementById("hp-plate");
  const ash = document.getElementById("ash");
  const pending = document.getElementById("pending");
  if (canto) {
    const txt = `${title}`;
    if (canto.textContent !== txt) canto.textContent = txt;
    canto.setAttribute("data-canto", String(you.cantoId ?? ""));
    const epi = subtitleIt ? String(subtitleIt) : "";
    if (canto.getAttribute("data-epigraph") !== epi) canto.setAttribute("data-epigraph", epi);
  }
  const maxHp = Math.round(Number(you.maxHp) || 1);
  // Heal-over-time and lifesteal leave fractional hp on the server; show whole numbers.
  const cur = Math.max(0, Math.ceil(Number(you.hp) || 0));
  const ratio = Math.max(0, Math.min(1, cur / maxHp));
  const hpTxt = `${cur} / ${maxHp}`;
  if (hp && hp.textContent !== hpTxt) hp.textContent = hpTxt;
  if (hpFill) {
    hpFill.style.width = `${(ratio * 100).toFixed(1)}%`;
    hpFill.classList.toggle("low", ratio <= 0.3);
  }
  // Low-HP screen vignette pulse (~30% and below)
  document.body.classList.toggle("low-hp", ratio <= 0.3 && cur > 0);
  document.getElementById("danger-vignette")?.setAttribute(
    "aria-hidden",
    ratio <= 0.3 && cur > 0 ? "false" : "true"
  );
  if (hpPlate) {
    hpPlate.setAttribute("aria-valuenow", String(cur));
    hpPlate.setAttribute("aria-valuemax", String(maxHp));
    // Pulse the frame on damage (restarted without forcing a reflow)
    if (lastHpShown != null && cur < lastHpShown) pulseHurt(hpPlate);
    lastHpShown = cur;
  }
  if (ash) {
    // Snapshots arrive ~12Hz: only touch the DOM when the balance changed
    const html = `<b>${formatAsh(you.ash)}</b> <i>Ash</i> <em>${ashToStelleDisplay(you.ash)} STELLE</em>`;
    if (html !== lastAshHtml || !ash.firstChild) {
      lastAshHtml = html;
      ash.innerHTML = html;
    }
  }
  const maxMp = Number(you.maxMana) || 100;
  const curMp = Math.max(0, Number(you.mana) || 0);
  const mpRatio = Math.max(0, Math.min(1, curMp / maxMp));
  const mp = document.getElementById("mp");
  const mpFill = document.getElementById("mp-fill");
  const mpPlate = document.getElementById("mp-plate");
  const mpTxt = `${Math.floor(curMp)} / ${maxMp}`;
  if (mp && mp.textContent !== mpTxt) mp.textContent = mpTxt;
  if (mpFill) {
    mpFill.style.width = `${(mpRatio * 100).toFixed(1)}%`;
    mpFill.classList.toggle("low", mpRatio <= 0.25);
  }
  if (mpPlate) {
    mpPlate.setAttribute("aria-valuenow", String(Math.floor(curMp)));
    mpPlate.setAttribute("aria-valuemax", String(maxMp));
  }
  // Low-mana vignette: intensity scales from full at 25% MP → 0 at empty (not binary)
  const manaVig =
    curMp > 0 && cur > 0 && mpRatio <= 0.25
      ? Math.max(0, Math.min(1, (0.25 - mpRatio) / 0.25))
      : 0;
  const lowMana = manaVig > 0.02;
  document.body.classList.toggle("low-mana", lowMana);
  const manaEl = document.getElementById("mana-vignette");
  if (manaEl) {
    manaEl.style.setProperty("--mana-vig", manaVig.toFixed(3));
    manaEl.setAttribute("aria-hidden", lowMana ? "false" : "true");
  }
  lastManaShown = curMp;
  syncWardPip(you);
  updateSpellButtons(curMp);

  if (pending) {
    const p = Number(you.pendingAsh) || 0;
    const full = p > 0 ? `+${formatAsh(p)} Ash (${ashToStelleDisplay(p)} Stelle) pending` : "";
    // Phones: the long form ran off the right edge beside the purse — the figure is enough
    const txt = p > 0 && isCompactUi() ? `+${shortAsh(p)}` : full;
    if (pending.textContent !== txt) pending.textContent = txt;
    if (pending.title !== full) pending.title = full;
    pending.classList.toggle("hidden", p <= 0);
    // Stella pending pulse: credit ticks (Crush FirstClear etc.) read on the ash ledger
    if (p > lastPendingAsh && p > 0) {
      pending.classList.remove("stella-pulse");
      void pending.offsetWidth;
      pending.classList.add("stella-pulse");
      // Stronger after Ava first-clear revel while the fringe still hangs
      pending.classList.toggle(
        "stella-pulse-crush",
        document.body.classList.contains("ava-first-clear")
      );
      if (pendingPulseTimer != null) window.clearTimeout(pendingPulseTimer);
      pendingPulseTimer = window.setTimeout(() => {
        pending.classList.remove("stella-pulse", "stella-pulse-crush");
        pendingPulseTimer = null;
      }, 1600);
    }
    lastPendingAsh = p;
  }
}

function formatAsh(n: number): string {
  return (Number(n) || 0).toLocaleString("en-US");
}

/** Phone chips: 12,400 stays exact; 1,019,996 reads "1.02M" (full figure in the title). */
function shortAsh(n: number): string {
  const v = Number(n) || 0;
  if (v < 100_000) return formatAsh(v);
  if (v < 1_000_000) return `${Math.floor(v / 1000)}k`;
  return `${(Math.floor(v / 10_000) / 100).toFixed(2).replace(/\.?0+$/, "")}M`;
}

/** Short glyph for an item slot — first letters of the name. */
function slotGlyph(name: string): string {
  const words = String(name || "?")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return String(name || "?").slice(0, 2).toUpperCase();
}

type RenderInvOpts = Parameters<typeof renderInventory>[2];
let lastRenderOnSelect: (id: string) => void = () => {};
let lastRenderOpts: RenderInvOpts;

export function renderInventory(
  items: any[],
  onSelect: (id: string) => void,
  opts?: {
    equipped?: Record<string, any>;
    gearStats?: { dmg?: number; maxHp?: number; armor?: number };
    onEquipSlotClick?: (slot: string) => void;
    stash?: any[];
  }
) {
  const grid = document.getElementById("inv-grid");
  if (!grid) return;
  // Weighed / richer drops float up so Avarice loot is not buried under normals
  items = sortInventoryItems(items);
  lastBagItems = items;
  lastRenderOnSelect = onSelect;
  lastRenderOpts = opts;
  const filterBtn = document.getElementById("btn-inv-weighed");
  if (filterBtn && filterBtn.dataset.wired !== "1") {
    filterBtn.dataset.wired = "1";
    filterBtn.addEventListener("click", () => {
      invWeighedOnly = !invWeighedOnly;
      filterBtn.setAttribute("aria-pressed", invWeighedOnly ? "true" : "false");
      // Re-render with the latest snapshot args (not the ones captured when first wired)
      renderInventory(lastBagItems, lastRenderOnSelect, lastRenderOpts);
    });
  }
  filterBtn?.setAttribute("aria-pressed", invWeighedOnly ? "true" : "false");
  const sortBtn = document.getElementById("btn-inv-sort");
  if (sortBtn && sortBtn.dataset.wired !== "1") {
    sortBtn.dataset.wired = "1";
    sortBtn.addEventListener("click", () => {
      invSort = invSort === "score" ? "rarity" : "score";
      try {
        localStorage.setItem(INV_SORT_KEY, invSort);
      } catch {
        /* private mode */
      }
      renderInventory(lastBagItems, lastRenderOnSelect, lastRenderOpts);
    });
  }
  if (sortBtn) {
    sortBtn.textContent = invSort === "score" ? "Sort: Score" : "Sort: Rarity";
    sortBtn.setAttribute("aria-pressed", invSort === "score" ? "true" : "false");
    sortBtn.title =
      invSort === "score"
        ? "Bag sorted by gear score (best first). Tap for rarity order."
        : "Bag sorted by rarity. Tap to sort by gear score (best first).";
  }
  const bestBtn = document.getElementById("btn-equip-best") as HTMLButtonElement | null;
  if (bestBtn) {
    const plan = planEquipBest(lastBagItems, opts?.equipped || {});
    bestBtn.disabled = plan.length === 0;
    bestBtn.textContent = plan.length ? `Equip best · ${plan.length}` : "Best equipped";
    bestBtn.title = plan.length
      ? `Wear the highest-score bag item for each slot: ${plan
          .map((p) => `${p.slot} ${formatDelta(p.gain)}`)
          .join(", ")}`
      : "Every slot already wears your highest-score gear.";
  }
  if (invWeighedOnly) {
    items = items.filter((it) => Boolean(it?.soulbound));
  }
  const countEl = document.getElementById("inv-count");
  if (countEl) {
    const total = lastBagItems.length;
    countEl.textContent = invWeighedOnly
      ? `${items.length}/${total} weighed`
      : `${total}/${INV_MAX_SLOTS}`;
  }
  const melt = document.getElementById("btn-melt") as HTMLButtonElement | null;
  if (melt && melt.dataset.armed !== "1") {
    const bagAll = lastBagItems;
    const ash = bagAll.reduce((sum, it) => sum + vendorAsh(it), 0);
    melt.disabled = bagAll.length === 0;
    melt.textContent = bagAll.length ? `Melt all · ${ash.toLocaleString()} Ash` : "Nothing to melt";
    melt.title = bagAll.length
      ? "Turns every bag item into Ash. Worn gear is kept."
      : "Bag is empty. Equipped gear is not melted.";
  }
  document.getElementById("btn-inv")?.classList.toggle("bag-crowded", items.length >= 32);
  grid.innerHTML = "";
  grid.style.setProperty("--inv-cols", String(INV_COLS));

  const equipped = opts?.equipped || {};
  const count = items.length;
  const slots = Math.min(
    INV_MAX_SLOTS,
    Math.max(INV_MIN_SLOTS, Math.ceil(count / INV_COLS) * INV_COLS)
  );

  if (selectedItemId && !items.some((it) => it.id === selectedItemId) &&
      !Object.values(equipped).some((it: any) => it?.id === selectedItemId) &&
      !(stashMode && (opts?.stash || []).some((it: any) => it?.id === selectedItemId))) {
    selectedItemId = null;
  }

  for (let i = 0; i < slots; i++) {
    const it = items[i];
    const slot = document.createElement("button");
    slot.type = "button";
    slot.className = "inv-slot";
    if (!it) {
      slot.classList.add("empty");
      slot.disabled = true;
      slot.setAttribute("aria-hidden", "true");
      grid.appendChild(slot);
      continue;
    }
    slot.classList.add(rarityClass(it.rarity));
    {
      // Unwearable trinkets never reach computeGearStats, so show no phantom bonus
      const st = wearSlotFor(it) ? itemStatBonus(it) : { dmg: 0, maxHp: 0, armor: 0 };
      const tipStats = formatItemStats(st);
      const wear = slotLabelForItem(it);
      const head =
        `${RARITY_LABEL[it.rarity] || it.rarity} · ${it.name} (${wear})` +
        (it.soulbound ? " · Weighed (no AH)" : "");
      slot.title = [head, tipStats, scoreLine(it, equipped)].filter(Boolean).join("\n");
      slot.setAttribute("aria-label", slot.title.replace(/\n/g, ", "));
    }
    const icon = itemIconUrl(it);
    slot.innerHTML = `<img class="inv-icon" src="${icon}" alt="" draggable="false" /><span class="inv-tier" aria-hidden="true"></span>${scoreBadgeHtml(it, equipped)}`;
    if (it.id === selectedItemId) slot.classList.add("selected");
    slot.onclick = (e) => {
      e.preventDefault();
      selectedItemId = it.id;
      onSelect(it.id);
      renderInventory(lastBagItems, onSelect, opts);
    };
    grid.appendChild(slot);
  }

  // Paper-doll
  for (const es of EQUIP_SLOTS) {
    const btn = document.querySelector<HTMLButtonElement>(`.equip-slot[data-slot="${es}"]`);
    if (!btn) continue;
    const body = btn.querySelector(".equip-slot-body");
    const worn = equipped[es];
    btn.classList.toggle("filled", Boolean(worn));
    btn.classList.toggle("selected", Boolean(worn && worn.id === selectedItemId));
    if (body) {
      if (worn) {
        body.innerHTML = `<img class="inv-icon" src="${itemIconUrl(worn)}" alt="" draggable="false" />${scoreBadgeHtml(worn, equipped)}`;
        {
          const st = itemStatBonus(worn);
          const tip = formatItemStats(st);
          btn.title = [`${es}: ${worn.name}`, tip, `Score ${itemScore(worn)}`]
            .filter(Boolean)
            .join("\n");
        }
      } else {
        body.innerHTML = "";
        btn.title = es;
      }
    }
    btn.onclick = (e) => {
      e.preventDefault();
      if (worn) {
        selectedItemId = worn.id;
        onSelect(worn.id);
      }
      opts?.onEquipSlotClick?.(es);
      renderInventory(lastBagItems, onSelect, opts);
    };
  }

  // Stash grid (only while opened at the Dark Wood stash)
  const stashItems: any[] = opts?.stash || [];
  lastStashItems = stashItems;
  const stashWrap = document.getElementById("stash-wrap");
  stashWrap?.classList.toggle("hidden", !stashMode);
  document.body.classList.toggle("stash-mode", stashMode);
  const stashGrid = document.getElementById("stash-grid");
  if (stashGrid && stashMode) {
    const sc = document.getElementById("stash-count");
    if (sc) sc.textContent = `${stashItems.length}/${STASH_MAX_SLOTS}`;
    stashGrid.innerHTML = "";
    stashGrid.style.setProperty("--inv-cols", String(INV_COLS));
    const sorted = sortInventoryItems(stashItems);
    const n = Math.min(STASH_MAX_SLOTS, Math.max(INV_COLS * 2, Math.ceil(sorted.length / INV_COLS) * INV_COLS));
    for (let i = 0; i < n; i++) {
      const it = sorted[i];
      const slot = document.createElement("button");
      slot.type = "button";
      slot.className = "inv-slot";
      if (!it) {
        slot.classList.add("empty");
        slot.disabled = true;
        slot.setAttribute("aria-hidden", "true");
        stashGrid.appendChild(slot);
        continue;
      }
      slot.classList.add(rarityClass(it.rarity));
      slot.title = `${RARITY_LABEL[it.rarity] || it.rarity} · ${it.name} (stashed)\n${scoreLine(it, equipped)}`;
      slot.setAttribute("aria-label", slot.title.replace(/\n/g, ", "));
      slot.innerHTML = `<img class="inv-icon" src="${itemIconUrl(it)}" alt="" draggable="false" /><span class="inv-tier" aria-hidden="true"></span>${scoreBadgeHtml(it, equipped)}`;
      if (it.id === selectedItemId) slot.classList.add("selected");
      slot.onclick = (e) => {
        e.preventDefault();
        selectedItemId = it.id;
        onSelect(it.id);
        renderInventory(lastBagItems, onSelect, opts);
      };
      stashGrid.appendChild(slot);
    }
  }
  const stashBtn = document.getElementById("btn-stash") as HTMLButtonElement | null;
  if (stashBtn) {
    const src = getSelectedItemSource();
    stashBtn.classList.toggle("hidden", !stashMode);
    stashBtn.disabled = src !== "bag" && src !== "stash";
    stashBtn.textContent = src === "stash" ? "Withdraw" : "Bank";
  }

  const statsEl = document.getElementById("equip-stats");
  if (statsEl) {
    const g = opts?.gearStats || {};
    statsEl.innerHTML =
      `<i>Gear</i>` +
      `<span class="stat-dmg">+${g.dmg || 0} dmg</span>` +
      `<span class="stat-hp">+${g.maxHp || 0} HP</span>` +
      `<span class="stat-armor">+${g.armor || 0} armor</span>`;
  }

  const detail = document.getElementById("inv-detail");
  if (detail) {
    const sel =
      items.find((it) => it.id === selectedItemId) ||
      Object.values(equipped).find((it: any) => it?.id === selectedItemId) ||
      (stashMode ? stashItems.find((it) => it.id === selectedItemId) : undefined);
    if (sel) {
      const wear = slotLabelForItem(sel);
      const st = wearSlotFor(sel) ? itemStatBonus(sel) : { dmg: 0, maxHp: 0, armor: 0 };
      const worn = Object.values(equipped).some((it: any) => it?.id === sel.id);
      detail.className = `inv-detail ${rarityClass(sel.rarity)}`;
      detail.innerHTML =
        `<div class="inv-detail-head">` +
        `<span class="inv-detail-name">${escapeHtml(sel.name)}</span>` +
        `<span class="inv-detail-rarity">${RARITY_LABEL[sel.rarity] || escapeHtml(sel.rarity)} · ${escapeHtml(wear)}` +
        (worn ? `<b class="inv-detail-worn">Worn</b>` : "") +
        `</span>` +
        `</div>` +
        `<div class="inv-detail-stats">${itemStatsHtml(st)}${detailScoreHtml(sel, equipped)}</div>`;
    } else {
      detail.className = "inv-detail";
      detail.innerHTML = `<span class="inv-detail-name muted">${count ? "Select an item to equip or list. Melt all turns the bag into Ash — worn gear stays." : "Your satchel is empty — foes in Lust drop loot."}</span>`;
    }
  }
}

/** Score pill for the detail panel, with the delta against the worn piece in that slot. */
function detailScoreHtml(it: any, equipped: Record<string, any>): string {
  if (!wearSlotFor(it)) return "";
  const d = scoreDelta(it, equipped);
  const hasWorn = Boolean(equipped?.[wearSlotFor(it) as string]);
  let cmp = "";
  if (d != null) {
    const cls = d > 0 ? "up" : d < 0 ? "down" : "even";
    cmp = hasWorn
      ? ` <b class="score-delta ${cls}">${formatDelta(d)}</b><small>vs worn</small>`
      : ` <b class="score-delta up">new</b><small>slot empty</small>`;
  }
  return `<span class="stat-score" title="Gear score: 10×dmg + 2×HP + 5×armor">Score ${itemScore(it)}${cmp}</span>`;
}

export function getSelectedItemId() {
  return selectedItemId;
}

/** Where the selected item lives, so one button can Bank or Withdraw. */
export function getSelectedItemSource(): "bag" | "stash" | "worn" | null {
  if (!selectedItemId) return null;
  if (lastBagItems.some((it) => it?.id === selectedItemId)) return "bag";
  if (stashMode && lastStashItems.some((it) => it?.id === selectedItemId)) return "stash";
  return "worn";
}

export function isStashMode() {
  return stashMode;
}

/** Enter/leave stash mode (entering also opens the bag). Caller re-renders. */
export function setStashMode(on: boolean) {
  if (stashMode === on) return;
  stashMode = on;
  document.body.classList.toggle("stash-mode", on);
  document.getElementById("stash-wrap")?.classList.toggle("hidden", !on);
  document.getElementById("btn-stash")?.classList.toggle("hidden", !on);
  if (on) setPanelOpen("inventory", true);
}

let questMain: HTMLElement | null = null;
let questSub: HTMLElement | null = null;

/** Objective line + an optional secondary hint beneath it (never replaces it). */
let questRo: ResizeObserver | null = null;
let questBottom = "";

export function setQuestLine(text: string, sub = "") {
  const el = document.getElementById("quest-track");
  if (!el) return;
  if (!questMain || !el.contains(questMain)) {
    el.textContent = "";
    questMain = document.createElement("span");
    questMain.className = "qt-main";
    questSub = document.createElement("span");
    questSub.className = "qt-sub";
    el.append(questMain, questSub);
    // Portrait stacks the target plate under this block (styles.css --qt-bottom): follow
    // its height as the objective wraps (a ResizeObserver: no layout read per text change)
    if (!questRo && typeof ResizeObserver !== "undefined") {
      questRo = new ResizeObserver(() => {
        const r = el.getBoundingClientRect();
        const v = r.height > 0 ? `${Math.round(r.bottom)}px` : "0px";
        if (v !== questBottom) {
          questBottom = v;
          document.documentElement.style.setProperty("--qt-bottom", v);
        }
      });
      questRo.observe(el);
    }
  }
  if (questMain.textContent !== text) questMain.textContent = text;
  if (questSub && questSub.textContent !== sub) {
    questSub.textContent = sub;
    questSub.hidden = !sub;
  }
}

/** Last painted target plate — the plate is rewritten only when this changes. */
let plateKey = "";

export function setTargetPlate(
  name: string | null,
  ratio: number,
  opts?: { boss?: boolean; avarice?: boolean }
) {
  const pctNum = Math.max(0, Math.min(100, Math.round(ratio * 100)));
  const key = name ? `${name}|${pctNum}|${opts?.boss ? 1 : 0}|${opts?.avarice ? 1 : 0}` : "";
  if (key === plateKey) return;
  plateKey = key;
  const el = document.getElementById("target-plate");
  if (!el) return;
  if (!name) {
    if (!el.classList.contains("hidden")) el.classList.add("hidden");
    el.classList.remove("tp-boss", "tp-avarice");
    return;
  }
  el.classList.remove("hidden");
  el.classList.toggle("tp-boss", Boolean(opts?.boss));
  el.classList.toggle("tp-avarice", Boolean(opts?.avarice));
  const n = el.querySelector("#target-name");
  if (n && n.textContent !== name) n.textContent = name;
  const bar = el.querySelector("#target-hp") as HTMLElement | null;
  if (bar) bar.style.width = `${pctNum}%`;
  const pct = el.querySelector("#target-hp-pct") as HTMLElement | null;
  if (pct) {
    const show = Boolean(opts?.boss);
    pct.hidden = !show;
    if (show) pct.textContent = `${pctNum}%`;
  }
}

/** Last AH payload. Filter changes repaint #ah-list only — the toolbar stays put. */
let ahListings: any[] = [];
let ahOnBuy: (id: string) => void = () => {};
let ahOnBid: (id: string) => void = () => {};
let ahOnCancel: (id: string) => void = () => {};
let ahAsh = 0;
let ahMyId: string | null = null;
let ahFiltersWired = false;

const AH_SLOT_LABEL: Record<string, string> = {
  Head: "Head",
  Chest: "Chest",
  Hands: "Hands",
  Feet: "Feet",
  MainHand: "Main hand",
  OffHand: "Off hand",
  Other: "Other",
};

function ahSlotKey(item: any): string {
  if (!item) return "Other";
  return wearSlotFor(item) || "Other";
}

/** Primary key, then price, name, id. */
function compareAhListings(a: any, b: any, mode: string): number {
  const pa = Number(a?.priceAsh) || 0;
  const pb = Number(b?.priceAsh) || 0;
  const sa = itemScore(a?.item);
  const sb = itemScore(b?.item);
  let primary = 0;
  if (mode === "price_desc") primary = pb - pa;
  else if (mode === "score_desc") primary = sb - sa;
  else if (mode === "score_asc") primary = sa - sb;
  else primary = pa - pb;
  if (primary) return primary;
  if (pa !== pb) return pa - pb;
  const name = String(a?.item?.name || "").localeCompare(String(b?.item?.name || ""));
  if (name) return name;
  return String(a?.id || "").localeCompare(String(b?.id || ""));
}

function readAhFilters(): { q: string; slot: string; sort: string } {
  const q =
    (document.getElementById("ah-search") as HTMLInputElement | null)?.value.trim().toLowerCase() ||
    "";
  const slot = (document.getElementById("ah-slot") as HTMLSelectElement | null)?.value || "";
  const sort = (document.getElementById("ah-sort") as HTMLSelectElement | null)?.value || "price_asc";
  return { q, slot, sort };
}

function ensureAhFilters() {
  if (ahFiltersWired) return;
  const search = document.getElementById("ah-search");
  const slot = document.getElementById("ah-slot");
  const sort = document.getElementById("ah-sort");
  if (!search || !slot || !sort) return;
  const rerender = () => paintAhList(false);
  search.addEventListener("input", rerender);
  search.addEventListener("search", rerender);
  slot.addEventListener("change", rerender);
  sort.addEventListener("change", rerender);
  ahFiltersWired = true;
}

function paintAhList(pulse: boolean) {
  const list = document.getElementById("ah-list");
  if (!list) return;
  const { q, slot, sort } = readAhFilters();
  list.replaceChildren();
  const purse = document.createElement("li");
  purse.className = "ah-purse";
  purse.textContent = `Your purse · ${ahAsh.toLocaleString()} Ash`;
  list.appendChild(purse);

  const total = ahListings.length;
  if (!total) {
    const empty = document.createElement("li");
    empty.className = "ah-empty";
    empty.textContent = "No listings. Melt trash for Ash, or list a bag item with a price.";
    list.appendChild(empty);
    return;
  }

  const shown = ahListings.filter((L) => {
    if (slot && ahSlotKey(L.item) !== slot) return false;
    if (q && !String(L.item?.name || "").toLowerCase().includes(q)) return false;
    return true;
  });
  shown.sort((a, b) => compareAhListings(a, b, sort));

  const count = document.createElement("li");
  count.className = "ah-count";
  count.textContent = `${shown.length} of ${total} lots`;
  list.appendChild(count);

  if (!shown.length) {
    const empty = document.createElement("li");
    empty.className = "ah-empty";
    empty.textContent = "No lots match your search.";
    list.appendChild(empty);
    return;
  }

  for (const L of shown) {
    const li = document.createElement("li");
    li.className = `ah-row${pulse ? " ah-loot-pulse" : ""} ${rarityClass(L.item?.rarity)}`;
    const rarity = RARITY_LABEL[L.item?.rarity] || L.item?.rarity || "";
    const stats = L.item ? formatItemStats(itemStatBonus(L.item)) : "";
    const weighed = Boolean(L.item?.soulbound);
    const price = Number(L.priceAsh) || 0;
    const canBuy = ahAsh >= price;
    const slotKey = ahSlotKey(L.item);
    const slotLabel = AH_SLOT_LABEL[slotKey] || "Other";
    const wearable = Boolean(L.item && wearSlotFor(L.item));
    const scoreText = wearable ? `Score ${itemScore(L.item)}` : "\u2014";
    if (weighed) li.classList.add("ah-weighed");
    li.innerHTML = `
      <div class="ah-item">
        <span class="ah-seal" aria-hidden="true"></span>
        <div class="ah-text">
          <div class="ah-title">
            <div class="ah-name">${escapeHtml(L.item?.name)}${weighed ? `<span class="ah-weighed-tag" title="Soulbound — bank at stash, not transferable">Weighed</span>` : ""}</div>
            <span class="ah-score${wearable ? "" : " is-empty"}" title="${wearable ? "Gear score" : "Not wearable"}">${scoreText}</span>
          </div>
          <div class="ah-meta"><span class="ah-rarity">${escapeHtml(rarity)}</span> · <span class="ah-slot">${escapeHtml(slotLabel)}</span>${weighed ? ` · <span class="ah-weighed-meta">soulbound</span>` : ""} · ${escapeHtml(L.sellerName)}${stats ? ` · ${escapeHtml(stats)}` : ""}</div>
        </div>
      </div>
      <div class="ah-prices">
        <span class="ah-ask"><i>Ask</i> ${formatAsh(price)}</span>
        <span class="ah-bid"><i>Bid</i> ${L.highestBidAsh ? formatAsh(L.highestBidAsh) : "—"}</span>
      </div>`;
    const row = document.createElement("div");
    row.className = "row ah-actions";
    const mine = ahMyId != null && String(L.sellerId) === String(ahMyId);
    if (mine) {
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.textContent = "Cancel";
      cancel.onclick = (e) => {
        e.stopPropagation();
        ahOnCancel(L.id);
      };
      row.append(cancel);
    } else {
      const buy = document.createElement("button");
      buy.type = "button";
      buy.className = "btn-gold";
      buy.textContent = canBuy ? "Buy" : "Need Ash";
      buy.disabled = !canBuy;
      buy.onclick = (e) => {
        e.stopPropagation();
        ahOnBuy(L.id);
      };
      const floor = Math.max(Number(L.highestBidAsh) || 0, price);
      const next = floor + Math.max(50, Math.round(floor * 0.1));
      const bid = document.createElement("button");
      bid.type = "button";
      bid.textContent = `Bid ${next.toLocaleString()}`;
      bid.disabled = ahAsh < next;
      bid.title = "Raises the bid by about 10%";
      bid.onclick = (e) => {
        e.stopPropagation();
        ahOnBid(L.id);
      };
      row.append(buy, bid);
    }
    li.appendChild(row);
    list.appendChild(li);
  }
}

export function renderAh(
  listings: any[],
  onBuy: (id: string) => void,
  onBid: (id: string) => void,
  ash = 0,
  myId: string | null = null,
  onCancel: (id: string) => void = () => {}
) {
  ahListings = Array.isArray(listings) ? listings : [];
  ahOnBuy = onBuy;
  ahOnBid = onBid;
  ahOnCancel = onCancel;
  ahAsh = ash;
  ahMyId = myId ?? null;
  ensureAhFilters();
  paintAhList(true);
}

/**
 * Snapshot purse → AH. `ah_listings` lands before the post-trade snapshot, so the
 * purse line and Buy/Bid gating would otherwise show the pre-trade balance.
 */
export function setAhPurse(ash: number) {
  const next = Number(ash) || 0;
  if (next === ahAsh) return;
  ahAsh = next;
  if (ahFiltersWired && isPanelOpen("ah")) paintAhList(false);
}

/** Is a panel (e.g. "inventory") currently shown? */
export function isPanelOpen(id: string): boolean {
  const el = document.getElementById(id);
  return Boolean(el && !el.classList.contains("hidden"));
}

/** Called when a panel opens (WorldApp renders a deferred inventory change then). */
export function onPanelOpen(cb: (id: string) => void) {
  panelOpenHook = cb;
}

function syncModalState() {
  // Any path that hides the bag (✕, backdrop, opening AH) also leaves stash mode
  if (stashMode && document.getElementById("inventory")?.classList.contains("hidden")) {
    setStashMode(false);
  }
  const invOpen = isPanelOpen("inventory");
  if (invOpen && !inventoryWasOpen) {
    inventoryWasOpen = true;
    panelOpenHook?.("inventory");
  } else if (!invOpen) inventoryWasOpen = false;
  const anyOpen = !!document.querySelector(".panel.modal:not(.hidden)");
  document.getElementById("modal-backdrop")?.classList.toggle("hidden", !anyOpen);
  document.body.classList.toggle("has-modal", anyOpen);
}

export function togglePanel(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  const opening = el.classList.contains("hidden");
  // One modal at a time — closing the other keeps the sheet readable on phones
  if (opening) {
    document.querySelectorAll<HTMLElement>(".panel.modal").forEach((p) => {
      if (p !== el) p.classList.add("hidden");
    });
  }
  el.classList.toggle("hidden");
  syncModalState();
}

export function setPanelOpen(id: string, open: boolean) {
  const el = document.getElementById(id);
  if (!el) return;
  if (open) {
    document.querySelectorAll<HTMLElement>(".panel.modal").forEach((p) => {
      if (p !== el) p.classList.add("hidden");
    });
  }
  el.classList.toggle("hidden", !open);
  syncModalState();
}

/**
 * Layout heuristics are read dozens of times per frame (world, radar, labels) and each
 * matchMedia() call is a style query, so cache them until the viewport or pointer
 * changes. The listeners register at module load, before WorldApp's own resize handler
 * reads the fresh values.
 */
let compactCache: boolean | null = null;
let landscapeCache: boolean | null = null;
const dropLayoutCache = () => {
  compactCache = null;
  landscapeCache = null;
};
if (typeof window !== "undefined") {
  window.addEventListener("resize", dropLayoutCache);
  window.addEventListener("orientationchange", dropLayoutCache);
  window.visualViewport?.addEventListener("resize", dropLayoutCache);
  for (const q of ["(pointer: coarse)", "(max-width: 640px)", "(orientation: landscape)"]) {
    window.matchMedia(q).addEventListener?.("change", dropLayoutCache);
  }
}

/** Narrow / touch-first UI (phones and compact tablets). */
export function isCompactUi(): boolean {
  if (typeof window === "undefined") return false;
  if (compactCache != null) return compactCache;
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (h <= 520 && w <= 1100) return (compactCache = true);
  compactCache =
    window.matchMedia("(max-width: 640px)").matches ||
    (window.matchMedia("(pointer: coarse)").matches && Math.min(w, h) < 900);
  return compactCache;
}

/** Phone/tablet held sideways — HUD must stay a single short row. */
export function isLandscapeCompact(): boolean {
  if (typeof window === "undefined") return false;
  if (landscapeCache != null) return landscapeCache;
  landscapeCache = isCompactUi() && window.matchMedia("(orientation: landscape)").matches;
  return landscapeCache;
}

/** Optional device vibrate — no-op when Vibration API is missing. */
function hapticLight(pattern: number | number[] = 10) {
  try {
    const vib = (navigator as Navigator & { vibrate?: (n: number | number[]) => boolean }).vibrate;
    if (typeof vib !== "function") return;
    vib.call(navigator, pattern);
  } catch {
    /* ignore — skip real haptics if API unavailable */
  }
}

/** Distinct patterns: soak (soft double), slam (heavy thud), mana deny (stutter). */
export type HapticKind = "tap" | "soak" | "slam" | "mana" | "ready" | "portal" | "sticky" | "kill" | "heavy" | "hurt";
function haptic(kind: HapticKind = "tap") {
  switch (kind) {
    case "soak":
      // Soft double tick — armor caught a hit
      hapticLight([10, 36, 14]);
      break;
    case "slam":
      // Heavy thud-pause-thud — Judge impact
      hapticLight([28, 45, 55]);
      break;
    case "mana":
      // Quick deny stutter
      hapticLight([8, 32, 8, 32, 12]);
      break;
    case "ready":
      // Light single tick — interact / target ready
      hapticLight(12);
      break;
    case "portal":
      // Soft confirm double — portal charge complete
      hapticLight([14, 40, 18]);
      break;
    case "sticky":
      // Soft triple micro-pulse — sticky retarget / threat cycle (distinct from interact-ready)
      hapticLight([5, 22, 5, 22, 8]);
      break;
    case "kill":
      // Firm tick + short tail — a foe falls to your blow
      hapticLight([18, 30, 8]);
      break;
    case "heavy":
      // One solid knock — your finisher / a heavy blow lands
      hapticLight(22);
      break;
    case "hurt":
      // Short dull buzz — a blow lands on you
      hapticLight(14);
      break;
    default:
      hapticLight(10);
  }
}

/** Combat haptics (phones): a kill, a heavy blow of yours, a blow on you. */
export function hapticCombat(kind: "kill" | "heavy" | "hurt") {
  haptic(kind);
}

/** Light haptic when Interact becomes ready (no-op if vibrate unavailable). */
export function hapticInteractReady() {
  haptic("ready");
}

/** Soft distinct haptic when sticky chip retargets / cycles a threat. */
export function hapticStickyRetarget() {
  haptic("sticky");
}

/** Light haptic when portal hold-to-travel charge completes. */
export function hapticPortalComplete() {
  haptic("portal");
}

/** D4-style hold-to-travel: radial fill on Interact + bottom prompt. `frac` null hides. */
export function setPortalHoldUi(frac: number | null, dest = "portal", title = "Hold to enter") {
  const btn = document.getElementById("btn-interact");
  const cd = btn?.querySelector<HTMLElement>(".interact-cd");
  const label = btn?.querySelector<HTMLElement>(".action-label");
  const prompt = document.getElementById("portal-hold-prompt");
  const bar = prompt?.querySelector<HTMLElement>(".php-bar i");
  const destEl = prompt?.querySelector<HTMLElement>(".php-dest");
  const titleEl = prompt?.querySelector<HTMLElement>(".php-title");
  if (titleEl && frac != null && titleEl.textContent !== title) titleEl.textContent = title;
  if (frac == null) {
    btn?.classList.remove("charging");
    btn?.style.removeProperty("--portal-charge-deg");
    if (cd) {
      cd.hidden = true;
      cd.style.removeProperty("--portal-charge-deg");
    }
    if (label && label.dataset.charging === "1") {
      label.textContent = label.dataset.idleLabel || "Interact";
      delete label.dataset.charging;
    }
    prompt?.classList.add("hidden");
    prompt?.setAttribute("aria-hidden", "true");
    if (bar) bar.style.width = "0%";
    return;
  }
  const u = Math.max(0, Math.min(1, frac));
  const deg = `${(u * 360).toFixed(1)}deg`;
  btn?.classList.add("charging");
  btn?.style.setProperty("--portal-charge-deg", deg);
  if (cd) {
    cd.hidden = false;
    cd.style.setProperty("--portal-charge-deg", deg);
  }
  if (label) {
    if (!label.dataset.idleLabel) label.dataset.idleLabel = label.textContent || "Interact";
    label.dataset.charging = "1";
    label.textContent = "Enter";
  }
  if (destEl) destEl.textContent = dest;
  if (bar) bar.style.width = `${(u * 100).toFixed(1)}%`;
  prompt?.classList.remove("hidden");
  prompt?.setAttribute("aria-hidden", "false");
}

/** Pressed-state helper for the gothic action buttons (mouse + touch). */
function wirePressed(btn: HTMLElement) {
  const off = () => btn.classList.remove("pressed");
  btn.addEventListener("pointerdown", () => btn.classList.add("pressed"));
  btn.addEventListener("pointerup", off);
  btn.addEventListener("pointerleave", off);
  btn.addEventListener("pointercancel", off);
}

function barTipFinePointer() {
  return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

function actionBarTipCopy(btn: HTMLElement): { key: string; name: string; meta: string; blurb: string } {
  const spellId = btn.getAttribute("data-spell");
  if (spellId && SKILLS[spellId]) {
    const s = SKILLS[spellId];
    const mana = btn.getAttribute("data-mana") || "";
    const cd = btn.getAttribute("data-cd") || "";
    const rank = btn.querySelector(".spell-rank")?.textContent?.trim();
    const key = btn.querySelector(".action-hint")?.textContent?.trim() || "";
    return {
      key,
      name: s.name,
      meta: `${mana} mana · ${cd}s${rank ? ` · rank ${rank}` : ""}`,
      blurb: s.blurb,
    };
  }
  if (spellId && SPELLS[spellId as SpellId]) {
    const s = SPELLS[spellId as SpellId];
    return {
      key: s.hotkey,
      name: s.name,
      meta: `${s.manaCost} mana · ${s.cooldown.toFixed(s.cooldown % 1 ? 1 : 0)}s`,
      blurb: s.blurb,
    };
  }
  if (btn.id === "btn-skills") return { key: "K", name: "Skills", meta: "", blurb: "Skill tree and the four active slots." };
  if (btn.id === "btn-menu") return { key: "", name: "Menu", meta: "", blurb: "Leaderboard, scoreboard, challenges, ranked queue, and sound." };
  const id = btn.id;
  const hint = btn.querySelector(".action-hint")?.textContent?.trim() || "";
  const label = btn.querySelector(".action-label")?.textContent?.trim() || "";
  if (id === "btn-inv") return { key: hint || "I", name: "Inventory", meta: "", blurb: "The pilgrim's pack and worn kit." };
  if (id === "btn-ah") return { key: hint || "H", name: "Auction House", meta: "", blurb: "Browse and bid in Ash." };
  if (id === "btn-attack") return { key: "", name: "Attack", meta: "Hold to keep swinging", blurb: "Strike the nearest shade." };
  if (id === "btn-interact") {
    const ready = btn.classList.contains("interact-ready");
    const hold = label.toLowerCase() === "hold" || label.toLowerCase() === "enter";
    if (hold) return { key: "E", name: "Hold to enter", meta: "", blurb: "Channel to step through the portal." };
    if (ready) return { key: "E", name: label || "Interact", meta: "", blurb: "Use the nearest shrine, stash, or portal." };
    return { key: "E", name: "Interact", meta: "", blurb: "Approach a shrine, stash, or portal." };
  }
  return { key: hint, name: label || btn.dataset.tipTitle || "Action", meta: "", blurb: "" };
}

/** D4 skill-bar hover plate. Native `title` is stripped so the OS tip does not stack. */
function wireActionBarTips() {
  const tip = document.getElementById("bar-tip");
  if (!tip) return;
  const keyEl = tip.querySelector<HTMLElement>(".bt-key");
  const nameEl = tip.querySelector<HTMLElement>(".bt-name");
  const metaEl = tip.querySelector<HTMLElement>(".bt-meta");
  const blurbEl = tip.querySelector<HTMLElement>(".bt-blurb");

  const hide = () => {
    tip.classList.add("hidden");
    tip.setAttribute("aria-hidden", "true");
  };

  const place = (btn: HTMLElement) => {
    const r = btn.getBoundingClientRect();
    const pad = 10;
    tip.style.left = `${Math.round(r.left + r.width / 2)}px`;
    tip.style.bottom = `${Math.round(window.innerHeight - r.top + pad)}px`;
    tip.style.top = "";
    const tr = tip.getBoundingClientRect();
    const overflowR = tr.right - (window.innerWidth - 8);
    const overflowL = 8 - tr.left;
    if (overflowR > 0) {
      tip.style.left = `${Math.round(r.left + r.width / 2 - overflowR)}px`;
    } else if (overflowL > 0) {
      tip.style.left = `${Math.round(r.left + r.width / 2 + overflowL)}px`;
    }
  };

  const show = (btn: HTMLElement) => {
    if (!barTipFinePointer()) {
      hide();
      return;
    }
    if (
      btn.classList.contains("pressed") ||
      btn.classList.contains("aiming") ||
      btn.classList.contains("charging")
    ) {
      hide();
      return;
    }
    const copy = actionBarTipCopy(btn);
    if (keyEl) keyEl.textContent = copy.key;
    if (nameEl) nameEl.textContent = copy.name;
    if (metaEl) metaEl.textContent = copy.meta;
    if (blurbEl) blurbEl.textContent = copy.blurb;
    tip.classList.remove("hidden");
    tip.setAttribute("aria-hidden", "false");
    place(btn);
  };

  document.querySelectorAll<HTMLElement>("#action-bar .action-btn").forEach((btn) => {
    if (btn.title) {
      btn.dataset.tipTitle = btn.title;
      if (!btn.getAttribute("aria-label")) btn.setAttribute("aria-label", btn.title);
      btn.removeAttribute("title");
    }
    btn.addEventListener("pointerenter", (e) => {
      if (e.pointerType && e.pointerType !== "mouse") return;
      show(btn);
    });
    btn.addEventListener("pointerleave", hide);
    btn.addEventListener("pointerdown", hide);
    btn.addEventListener("focus", () => {
      if (barTipFinePointer()) show(btn);
    });
    btn.addEventListener("blur", hide);
  });
  window.addEventListener("resize", hide);
  window.addEventListener("blur", hide);
}



/** Local optimistic ward buff end (ms). Server `armorBuff`/`wardUntil` overrides when present. */
let wardBuffUntilMs = 0;
/** True while the pip was showing last frame — used to fire expiry flash. */
let wardPipWasActive = false;

/** Call when Whirl Ward fx starts so the HUD pip lights immediately. */
export function noteWardBuff(durationSec: number) {
  const ms = Math.max(0, Number(durationSec) || 0) * 1000;
  wardBuffUntilMs = Date.now() + ms;
  syncWardPip(null);
  kickSpellCdLoop();
}

/** Brief gold flash on the Ward pip when armor soaked part of a hit. */
export function flashWardSoak() {
  haptic("soak");
  const pip = document.getElementById("ward-pip");
  if (!pip) return;
  pip.classList.remove("hidden", "ward-soak");
  void (pip as HTMLElement).offsetWidth;
  pip.classList.add("ward-soak");
  pip.setAttribute("aria-hidden", "false");
  window.setTimeout(() => {
    pip.classList.remove("ward-soak");
  }, 380);
}

function syncWardPip(you: any | null) {
  const pip = document.getElementById("ward-pip");
  if (!pip) return;
  let active = false;
  if (you) {
    const armor = Number(you.armorBuff) || 0;
    const until = Number(you.wardUntil) || 0;
    if (armor > 0 && until > 0) {
      active = true;
      wardBuffUntilMs = Math.max(wardBuffUntilMs, Date.now() + until * 1000);
    } else if (armor > 0) {
      active = true;
    }
  }
  if (!active && wardBuffUntilMs > Date.now()) active = true;
  if (wardBuffUntilMs > 0 && wardBuffUntilMs <= Date.now()) wardBuffUntilMs = 0;

  // Expiry flash when pip drops
  if (wardPipWasActive && !active) {
    pip.classList.remove("hidden", "ward-expire");
    void (pip as HTMLElement).offsetWidth;
    pip.classList.add("ward-expire");
    pip.textContent = "W";
    pip.setAttribute("aria-hidden", "false");
    window.setTimeout(() => {
      if (wardBuffUntilMs <= Date.now()) {
        pip.classList.add("hidden");
        pip.classList.remove("ward-expire");
        pip.setAttribute("aria-hidden", "true");
        pip.textContent = "W";
      }
    }, 420);
  } else if (active) {
    pip.classList.remove("hidden", "ward-expire");
    const left = Math.max(0, (wardBuffUntilMs - Date.now()) / 1000);
    // Tiny remaining time; keep "W" glyph when >9s so the pip stays compact
    if (left > 0 && left < 9.95) {
      pip.textContent = left >= 1 ? String(Math.ceil(left)) : left.toFixed(1);
    } else {
      pip.textContent = "W";
    }
    pip.title = left > 0 ? `Whirl Ward — +armor (${left.toFixed(1)}s)` : "Whirl Ward — +armor";
    pip.setAttribute("aria-hidden", "false");
  } else if (!pip.classList.contains("ward-expire")) {
    pip.classList.add("hidden");
    pip.setAttribute("aria-hidden", "true");
    pip.textContent = "W";
  }
  wardPipWasActive = active;
}

/** Client-side cooldown deadlines (ms epoch) keyed by spell id — optimistic UI. */
const spellCdUntil = new Map<string, number>();
let spellCdRaf = 0;
/** Attack button radial CD deadline (ms epoch). */
let attackCdUntil = 0;
let attackCdTotalMs = 560;
/** Track which spells were on CD so we can fire a ready ping when they clear. */
const spellWasOnCd = new Map<string, boolean>();

const spellCdTotal = new Map<string, number>();

export type HotSlot = {
  id: string;
  name: string;
  short: string;
  icon: string;
  mana: number;
  cd: number;
  rank: number;
  blurb: string;
} | null;

const hotbar: HotSlot[] = [null, null, null, null];

export function noteSpellCast(spellId: string, cooldownSec: number) {
  const ms = Math.max(50, cooldownSec * 1000);
  spellCdUntil.set(spellId, Date.now() + ms);
  spellCdTotal.set(spellId, ms);
  kickSpellCdLoop();
}

/** Server cds are milliseconds remaining. Adopt them when they outlast the local sweep. */
export function noteServerCds(cds: Record<string, number> | undefined) {
  if (!cds) return;
  const now = Date.now();
  let any = false;
  for (const id of Object.keys(cds)) {
    const left = Number(cds[id]) || 0;
    if (left <= 0) continue;
    const until = now + left;
    if (until > (spellCdUntil.get(id) || 0) + 50) {
      spellCdUntil.set(id, until);
      const prev = spellCdTotal.get(id) || 0;
      if (left > prev) spellCdTotal.set(id, left);
      any = true;
    }
  }
  if (any) kickSpellCdLoop();
}

export function applyHotbar(slots: HotSlot[]) {
  for (let i = 0; i < 4; i++) hotbar[i] = slots[i] || null;
  for (let i = 0; i < 4; i++) {
    const btn = document.getElementById(`btn-spell-slot-${i}`);
    if (!btn) continue;
    const s = hotbar[i];
    const img = btn.querySelector<HTMLImageElement>(".spell-icon");
    const label = btn.querySelector<HTMLElement>(".action-label");
    const cost = btn.querySelector<HTMLElement>(".spell-cost");
    const rank = btn.querySelector<HTMLElement>(".spell-rank");
    if (!s) {
      btn.removeAttribute("data-spell");
      btn.removeAttribute("data-mana");
      btn.removeAttribute("data-cd");
      btn.classList.add("spell-empty");
      btn.setAttribute("aria-disabled", "true");
      btn.setAttribute("aria-label", `Spell ${i + 1} empty`);
      if (img) {
        img.removeAttribute("src");
        img.hidden = true;
      }
      if (label) label.textContent = "";
      if (cost) cost.textContent = "";
      if (rank) rank.textContent = "";
      continue;
    }
    btn.classList.remove("spell-empty");
    btn.setAttribute("data-spell", s.id);
    btn.setAttribute("data-mana", String(s.mana));
    btn.setAttribute("data-cd", String(s.cd));
    btn.setAttribute("aria-label", `${s.name}, slot ${i + 1}`);
    if (img) {
      img.hidden = false;
      if (img.src !== s.icon && !img.src.endsWith(s.icon)) img.src = s.icon;
      else if (!img.getAttribute("src")) img.src = s.icon;
    }
    if (label) {
      label.textContent = s.short;
      label.dataset.short = s.short;
    }
    if (cost) cost.textContent = String(s.mana);
    if (rank) rank.textContent = s.rank > 1 ? String(s.rank) : "";
  }
  kickSpellCdLoop();
}

export function setXpHud(prog: { level?: number; xpIntoLevel?: number; xpToNext?: number }) {
  const lv = document.getElementById("xp-lv");
  const fill = document.getElementById("xp-fill");
  const read = document.getElementById("xp-read");
  const plate = document.getElementById("xp-plate");
  const level = Number(prog.level) || 1;
  const into = Math.max(0, Math.floor(Number(prog.xpIntoLevel) || 0));
  const next = Math.max(0, Math.floor(Number(prog.xpToNext) || 0));
  if (lv) lv.textContent = `Lv ${level}`;
  const pct = next > 0 ? Math.max(0, Math.min(1, into / next)) : 1;
  if (fill) fill.style.width = `${(pct * 100).toFixed(1)}%`;
  const label = next > 0 ? `${into}/${next}` : `${into}`;
  if (read) read.textContent = label;
  if (plate) plate.title = `Level ${level} — ${label}`;
}

const xpPops: HTMLElement[] = [];
export function floatXp(amount: number) {
  const n = Math.floor(Number(amount) || 0);
  if (n <= 0) return;
  const host = document.getElementById("xp-float");
  if (!host) return;
  let el = xpPops.find((e) => !e.classList.contains("on"));
  if (!el) {
    el = document.createElement("span");
    el.className = "xp-pop";
    host.appendChild(el);
    xpPops.push(el);
  }
  el.textContent = `+${n} XP`;
  el.classList.remove("on");
  void el.offsetWidth;
  el.classList.add("on");
  const node = el;
  window.setTimeout(() => node.classList.remove("on"), 900);
}

export function flashVitals() {
  for (const id of ["hp-plate", "mp-plate"]) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.classList.remove("vitals-refill");
    void el.offsetWidth;
    el.classList.add("vitals-refill");
  }
  document.body.classList.remove("level-flash");
  void document.body.offsetWidth;
  document.body.classList.add("level-flash");
  window.setTimeout(() => document.body.classList.remove("level-flash"), 720);
}

export function setSkillPoints(n: number) {
  const b = document.getElementById("skill-badge");
  if (!b) return;
  const v = Math.max(0, Math.floor(Number(n) || 0));
  b.textContent = v > 0 ? String(v) : "";
  b.classList.toggle("hidden", v <= 0);
  b.classList.toggle("pulse", v > 0);
}

/** Optimistic melee CD radial on the Attack button (matches spell-style sweep). */
const utilCd = new Map<string, { until: number; total: number }>();

/** Radial cooldown on Dash / Flask. */
export function noteUtilityCd(btnId: string, cooldownSec: number) {
  const total = Math.max(0.05, Number(cooldownSec) || 0) * 1000;
  utilCd.set(btnId, { until: Date.now() + total, total });
  kickSpellCdLoop();
}

export function noteAttackCd(cooldownSec: number) {
  const ms = Math.max(0.05, Number(cooldownSec) || 0) * 1000;
  attackCdTotalMs = ms;
  attackCdUntil = Date.now() + ms;
  kickSpellCdLoop();
}

/** Consecutive-hit streak pip on the HP plate (shows at 2+; resets on miss/gap). */
const COMBO_GAP_MS = 1800;
let comboCount = 0;
let comboLastAt = 0;
let comboExpireTimer: number | null = null;

/** Returns the new streak count (milestones ×5 / ×10 are for camera punch, no toast). */
export function noteComboHit(): number {
  const now = Date.now();
  if (comboLastAt && now - comboLastAt > COMBO_GAP_MS) comboCount = 0;
  comboCount += 1;
  comboLastAt = now;
  syncComboPip(true);
  kickSpellCdLoop();
  return comboCount;
}

/** True when streak just landed on a camera-punch milestone. */
export function isComboMilestone(n: number): boolean {
  return n === 5 || n === 10;
}

/** ×15 / ×20 fever tint on the combo pip (no toast). */
export function isComboFever(n: number): boolean {
  return n >= 15;
}

/** ×75+ inferno fringe / heat haze threshold (no toast). */
export function isComboInfernoFringe(n: number): boolean {
  return n >= 75;
}

/** ×100+ eclipse pip + world ember drift threshold (no toast). */
export function isComboEclipse(n: number): boolean {
  return n >= 100;
}

/** ×150+ void corona — brief screen desat pulse (no toast). */
export function isComboVoidCorona(n: number): boolean {
  return n >= 150 && n < 200;
}

/** ×200+ abyss — brief chroma fringe + camera breathe (no toast). */
export function isComboAbyss(n: number): boolean {
  return n >= 200;
}

/** ×250+ rift shear — brief screen tear / foe pad desync (no toast). */
export function isComboRiftShear(n: number): boolean {
  return n >= 250;
}

/** ×300+ rift shear escalate (stronger tear, same language). */
export function isComboRiftShearMax(n: number): boolean {
  return n >= 300;
}

/** ×350+ horizon fold — brief letterbox + depth-sort flicker (no toast). */
export function isComboHorizonFold(n: number): boolean {
  return n >= 350;
}

export function getComboCount(): number {
  return comboCount;
}

export function resetCombo() {
  if (comboCount <= 0) return;
  const wasShown = comboCount >= 2;
  const wasAbyss = comboCount >= 200;
  const lastN = comboCount;
  comboCount = 0;
  comboLastAt = 0;
  syncComboPip(false, wasShown);
  if (wasAbyss) {
    pulseAbyssAfterimage();
    pulseComboVoidGhost(lastN);
  }
}

function syncComboPip(bump = false, expire = false) {
  const pip = document.getElementById("combo-pip");
  if (!pip) return;
  const show = comboCount >= 2;
  const heat = document.getElementById("heat-haze");
  if (expire && !show) {
    // Soft decay fade (not a hard pip drop)
    pip.classList.remove("hidden", "combo-bump", "combo-expire");
    void (pip as HTMLElement).offsetWidth;
    pip.classList.add("combo-decay");
    pip.setAttribute("aria-hidden", "false");
    document.body.classList.remove("combo-heat", "combo-eclipse-heat", "combo-void-heat", "combo-abyss-heat");
    if (heat) {
      heat.setAttribute("aria-hidden", "true");
      heat.classList.remove("heat-eclipse", "heat-void", "heat-abyss");
    }
    if (comboExpireTimer != null) window.clearTimeout(comboExpireTimer);
    comboExpireTimer = window.setTimeout(() => {
      comboExpireTimer = null;
      if (comboCount < 2) {
        pip.classList.add("hidden");
        pip.classList.remove(
          "combo-decay",
          "combo-expire",
          "combo-bump",
          "combo-fever",
          "combo-fever-max",
          "combo-inferno",
          "combo-inferno-fringe",
          "combo-eclipse",
          "combo-void",
          "combo-abyss"
        );
        pip.setAttribute("aria-hidden", "true");
      }
    }, 560);
    return;
  }
  if (show) {
    pip.classList.remove("hidden", "combo-expire", "combo-decay");
    pip.textContent = comboCount > 99 ? "99" : String(comboCount);
    pip.title = `Hit streak ×${comboCount}`;
    pip.setAttribute("aria-hidden", "false");
    pip.classList.toggle("combo-fever", comboCount >= 15 && comboCount < 50);
    pip.classList.toggle("combo-fever-max", comboCount >= 20 && comboCount < 50);
    pip.classList.toggle("combo-inferno", comboCount >= 50 && comboCount < 100);
    pip.classList.toggle("combo-inferno-fringe", comboCount >= 75 && comboCount < 100);
    pip.classList.toggle("combo-eclipse", comboCount >= 100 && comboCount < 150);
    pip.classList.toggle("combo-void", comboCount >= 150 && comboCount < 200);
    pip.classList.toggle("combo-abyss", comboCount >= 200);
    document.body.classList.toggle("combo-heat", comboCount >= 75 && comboCount < 100);
    document.body.classList.toggle("combo-eclipse-heat", comboCount >= 100 && comboCount < 150);
    document.body.classList.toggle("combo-void-heat", comboCount >= 150 && comboCount < 200);
    document.body.classList.toggle("combo-abyss-heat", comboCount >= 200);
    if (heat) heat.setAttribute("aria-hidden", comboCount >= 75 ? "false" : "true");
    if (heat) {
      heat.classList.toggle("heat-eclipse", comboCount >= 100 && comboCount < 150);
      heat.classList.toggle("heat-void", comboCount >= 150 && comboCount < 200);
      heat.classList.toggle("heat-abyss", comboCount >= 200);
    }
    if (bump) {
      pip.classList.remove("combo-bump");
      void (pip as HTMLElement).offsetWidth;
      pip.classList.add("combo-bump");
    }
  } else if (!pip.classList.contains("combo-expire") && !pip.classList.contains("combo-decay")) {
    pip.classList.add("hidden");
    pip.classList.remove(
      "combo-bump",
      "combo-fever",
      "combo-fever-max",
      "combo-inferno",
      "combo-inferno-fringe",
      "combo-eclipse",
      "combo-void",
      "combo-abyss"
    );
    pip.setAttribute("aria-hidden", "true");
    pip.textContent = "1";
    document.body.classList.remove("combo-heat", "combo-eclipse-heat", "combo-void-heat", "combo-abyss-heat");
    if (heat) {
      heat.setAttribute("aria-hidden", "true");
      heat.classList.remove("heat-eclipse", "heat-void", "heat-abyss");
    }
  }
}

/** Fullscreen etch flash + soft respawn veil (death is more than a toast). */
export function playDeathRevive() {
  const el = document.getElementById("death-flash");
  if (!el) return;
  document.body.classList.remove("respawn-fade");
  document.body.classList.add("death-flash");
  el.setAttribute("aria-hidden", "false");
  // (the veil darkens over the held fall and is darkest when the hero is moved to the
  // entrance, ~720 ms in — heroMotor DEATH_POSE_MS — so the cut happens under it)
  window.setTimeout(() => {
    document.body.classList.remove("death-flash");
    document.body.classList.add("respawn-fade");
    window.setTimeout(() => {
      document.body.classList.remove("respawn-fade");
      el.setAttribute("aria-hidden", "true");
    }, 940);
  }, 440);
}

/** Brief Inv bag glow matching loot rarity when a new item lands. */
export function pulseInvBag(rarity?: string) {
  const btn = document.getElementById("btn-inv");
  if (!btn) return;
  const r = String(rarity || "normal");
  btn.classList.remove(
    "inv-loot-glow",
    "r-normal",
    "r-magic",
    "r-rare",
    "r-set",
    "r-unique",
    "r-canto_unique"
  );
  void (btn as HTMLElement).offsetWidth;
  btn.classList.add("inv-loot-glow", `r-${r in RARITY_LABEL ? r : "normal"}`);
  window.setTimeout(() => {
    btn.classList.remove("inv-loot-glow", `r-${r in RARITY_LABEL ? r : "normal"}`);
  }, 2200);
}

export function flashManaDeny(spellId?: string) {
  haptic("mana");
  const plate = document.getElementById("mp-plate");
  if (plate) {
    plate.classList.remove("mp-deny");
    void (plate as HTMLElement).offsetWidth;
    plate.classList.add("mp-deny");
  }
  const sel = spellId
    ? `.spell-btn[data-spell="${spellId}"]`
    : ".spell-btn";
  document.querySelectorAll<HTMLElement>(sel).forEach((btn) => {
    btn.classList.remove("mana-flash");
    void btn.offsetWidth;
    btn.classList.add("mana-flash");
    const cost = btn.querySelector<HTMLElement>(".spell-cost");
    if (cost) {
      cost.classList.remove("cost-deny-flash");
      void cost.offsetWidth;
      cost.classList.add("cost-deny-flash");
    }
  });
}

/** Brief screen-edge crimson sting when Judge slam hits the player. */
export function flashSlamSting() {
  haptic("slam");
  const el = document.getElementById("slam-sting");
  if (!el) return;
  document.body.classList.remove("slam-sting", "slam-safe");
  void document.body.offsetWidth;
  document.body.classList.add("slam-sting");
  el.setAttribute("aria-hidden", "false");
  window.setTimeout(() => {
    document.body.classList.remove("slam-sting");
    el.setAttribute("aria-hidden", "true");
  }, 420);
}

/** Gold “just safe” rim flash when barely outside Judge slam radius at resolve. */
export function flashSlamSafeRim() {
  const el = document.getElementById("slam-safe");
  if (!el) return;
  document.body.classList.remove("slam-safe", "slam-sting");
  void document.body.offsetWidth;
  document.body.classList.add("slam-safe");
  el.setAttribute("aria-hidden", "false");
  window.setTimeout(() => {
    document.body.classList.remove("slam-safe");
    el.setAttribute("aria-hidden", "true");
  }, 480);
}

/** Brief fullscreen desat pulse at combo ×150 void corona (no toast). */
export function pulseVoidCorona() {
  const el = document.getElementById("void-corona");
  document.body.classList.remove("void-corona-pulse");
  void document.body.offsetWidth;
  document.body.classList.add("void-corona-pulse");
  if (el) el.setAttribute("aria-hidden", "false");
  window.setTimeout(() => {
    document.body.classList.remove("void-corona-pulse");
    if (el) el.setAttribute("aria-hidden", "true");
  }, 520);
}

/** Brief chroma fringe at combo ×200 abyss (no toast). */
export function pulseAbyssChroma() {
  const el = document.getElementById("abyss-chroma");
  document.body.classList.remove("abyss-chroma-pulse");
  void document.body.offsetWidth;
  document.body.classList.add("abyss-chroma-pulse");
  if (el) el.setAttribute("aria-hidden", "false");
  window.setTimeout(() => {
    document.body.classList.remove("abyss-chroma-pulse");
    if (el) el.setAttribute("aria-hidden", "true");
  }, 580);
}

/** Brief screen tear / rift shear at combo ×250 (+ escalate at ×300). No toast. */
export function pulseRiftShear(escalate = false) {
  const el = document.getElementById("rift-shear");
  document.body.classList.remove("rift-shear-pulse", "rift-shear-max");
  void document.body.offsetWidth;
  document.body.classList.add("rift-shear-pulse");
  if (escalate) document.body.classList.add("rift-shear-max");
  if (el) el.setAttribute("aria-hidden", "false");
  window.setTimeout(() => {
    document.body.classList.remove("rift-shear-pulse", "rift-shear-max");
    if (el) el.setAttribute("aria-hidden", "true");
  }, escalate ? 720 : 520);
}

/** Soft abyss afterimage when a ×200+ streak dies (decay, no toast). */
export function pulseAbyssAfterimage() {
  const el = document.getElementById("abyss-afterimage");
  document.body.classList.remove("abyss-afterimage-pulse");
  void document.body.offsetWidth;
  document.body.classList.add("abyss-afterimage-pulse");
  if (el) el.setAttribute("aria-hidden", "false");
  window.setTimeout(() => {
    document.body.classList.remove("abyss-afterimage-pulse");
    if (el) el.setAttribute("aria-hidden", "true");
  }, 640);
}

/** Brief letterbox horizon fold at combo ×350 (no toast). */
export function pulseHorizonFold() {
  const el = document.getElementById("horizon-fold");
  document.body.classList.remove("horizon-fold-pulse");
  void document.body.offsetWidth;
  document.body.classList.add("horizon-fold-pulse");
  if (el) el.setAttribute("aria-hidden", "false");
  window.setTimeout(() => {
    document.body.classList.remove("horizon-fold-pulse");
    if (el) el.setAttribute("aria-hidden", "true");
  }, 580);
}

/** 1-frame void ghost numeral of the last × count when a ×200+ streak dies. */
export function pulseComboVoidGhost(n: number) {
  const el = document.getElementById("combo-void-ghost");
  if (!el) return;
  const shown = Math.min(99, Math.max(1, Math.floor(n)));
  el.textContent = `×${shown}`;
  document.body.classList.remove("combo-void-ghost-pulse");
  void document.body.offsetWidth;
  document.body.classList.add("combo-void-ghost-pulse");
  el.setAttribute("aria-hidden", "false");
  // Intentionally ~1 display frame then clear (plus tiny fade for readability)
  window.setTimeout(() => {
    document.body.classList.remove("combo-void-ghost-pulse");
    el.setAttribute("aria-hidden", "true");
    el.textContent = "";
  }, 48);
}

/** Esc / drag-off cancel: brief red-rim flash then restore idle chrome. */
export function flashSpellCancel(spellId?: string) {
  const btn = spellId
    ? document.querySelector<HTMLElement>(`.spell-btn[data-spell="${spellId}"]`)
    : document.querySelector<HTMLElement>(".spell-btn.aiming");
  if (!btn) return;
  btn.classList.remove("aiming", "pressed", "spell-cancel-flash");
  void (btn as HTMLElement).offsetWidth;
  btn.classList.add("spell-cancel-flash");
  window.setTimeout(() => {
    btn.classList.remove("spell-cancel-flash");
  }, 220);
}

function pingSpellReady(btn: HTMLElement) {
  btn.classList.remove("spell-ready");
  void btn.offsetWidth;
  btn.classList.add("spell-ready");
}

function updateAttackCdButton() {
  const btn = document.getElementById("btn-attack");
  if (!btn) return;
  const now = Date.now();
  const onCd = attackCdUntil > now;
  const was = btn.classList.contains("on-cooldown");
  btn.classList.toggle("on-cooldown", onCd);
  const cdEl = btn.querySelector<HTMLElement>(".spell-cd, .attack-cd");
  if (cdEl) {
    if (onCd) {
      const left = Math.max(0, (attackCdUntil - now) / 1000);
      cdEl.hidden = false;
      cdEl.textContent = left >= 1 ? String(Math.ceil(left)) : left.toFixed(1);
      const frac = Math.max(0, Math.min(1, (attackCdUntil - now) / Math.max(1, attackCdTotalMs)));
      cdEl.style.setProperty("--cd-frac", String(frac));
      cdEl.style.setProperty("--cd-deg", `${(frac * 360).toFixed(1)}deg`);
    } else {
      cdEl.hidden = true;
      cdEl.textContent = "";
      cdEl.style.removeProperty("--cd-frac");
      cdEl.style.removeProperty("--cd-deg");
    }
  }
  if (was && !onCd) pingSpellReady(btn);
}

function updateUtilityCds() {
  const now = Date.now();
  for (const [id, cd] of utilCd) {
    const btn = document.getElementById(id);
    if (!btn) continue;
    const onCd = cd.until > now;
    btn.classList.toggle("on-cooldown", onCd);
    const cdEl = btn.querySelector<HTMLElement>(".spell-cd");
    if (!cdEl) continue;
    if (onCd) {
      const left = Math.max(0, (cd.until - now) / 1000);
      cdEl.hidden = false;
      cdEl.textContent = left >= 1 ? String(Math.ceil(left)) : left.toFixed(1);
      const frac = Math.max(0, Math.min(1, (cd.until - now) / cd.total));
      cdEl.style.setProperty("--cd-deg", `${(frac * 360).toFixed(1)}deg`);
    } else {
      cdEl.hidden = true;
      cdEl.textContent = "";
    }
  }
}

function updateSpellButtons(mana: number) {
  const now = Date.now();
  for (let i = 0; i < 4; i++) {
    const slot = hotbar[i];
    const btn = document.getElementById(`btn-spell-slot-${i}`);
    if (!btn || !slot) continue;
    const until = spellCdUntil.get(slot.id) || 0;
    const onCd = until > now;
    const was = spellWasOnCd.get(slot.id) === true;
    const lack = mana < slot.mana;
    btn.classList.toggle("on-cooldown", onCd);
    btn.classList.toggle("no-mana", lack && !onCd);
    btn.setAttribute("aria-disabled", onCd || lack ? "true" : "false");
    const cdEl = btn.querySelector<HTMLElement>(".spell-cd");
    if (cdEl) {
      if (onCd) {
        const left = Math.max(0, (until - now) / 1000);
        cdEl.hidden = false;
        cdEl.textContent = left >= 1 ? String(Math.ceil(left)) : left.toFixed(1);
        const total = spellCdTotal.get(slot.id) || slot.cd * 1000;
        const frac = Math.max(0, Math.min(1, (until - now) / Math.max(1, total)));
        cdEl.style.setProperty("--cd-frac", String(frac));
        cdEl.style.setProperty("--cd-deg", `${(frac * 360).toFixed(1)}deg`);
      } else {
        cdEl.hidden = true;
        cdEl.textContent = "";
      }
    }
    if (was && !onCd) pingSpellReady(btn);
    spellWasOnCd.set(slot.id, onCd);
  }
  updateAttackCdButton();
  updateUtilityCds();
}

function kickSpellCdLoop() {
  if (spellCdRaf) return;
  const tick = () => {
    spellCdRaf = 0;
    const manaTxt = document.getElementById("mp")?.textContent || "";
    const m = manaTxt.match(/^(\d+)/);
    const mana = m ? Number(m[1]) : 0;
    updateSpellButtons(mana);
    syncWardPip(null);
    const now = Date.now();
    if (comboCount >= 2 && comboLastAt && now - comboLastAt > COMBO_GAP_MS) {
      resetCombo();
    }
    let any = false;
    for (const until of spellCdUntil.values()) {
      if (until > now) {
        any = true;
        break;
      }
    }
    if (!any && wardBuffUntilMs > now) any = true;
    if (!any && attackCdUntil > now) any = true;
    if (!any && comboCount >= 2) any = true;
    if (any) {
      spellCdRaf = window.requestAnimationFrame(tick);
    }
  };
  spellCdRaf = window.requestAnimationFrame(tick);
}

export function wireHud(api: {
  listSelected: (price: number) => void;
  refreshAh: () => void;
  toggleInventory: () => void;
  toggleAh: () => void;
  interactNearest: () => void;
  attackNearest: () => void;
  onAttackHoldStart?: () => void;
  onAttackHoldEnd?: () => void;
  equipSelected?: () => void;
  unequipSelected?: () => void;
  stashSelected?: () => void;
  meltBag?: () => void;
  equipBest?: () => void;
  sip?: () => void;
  dash?: () => void;
  castSpell?: (spellId: string) => void;
  toggleSkills?: () => void;
  /** Spell hold-to-confirm (Gale aim / Ward+Burst telegraph). */
  onSpellHoldStart?: (spellId: string, ev: PointerEvent) => void;
  onSpellHoldMove?: (spellId: string, ev: PointerEvent) => void;
  onSpellHoldEnd?: (spellId: string, ev: PointerEvent, cast: boolean) => void;
  /** Portal travel: hold Interact to charge; release early cancels. Non-portal = tap. */
  onInteractHoldStart?: (ev: PointerEvent) => void;
  onInteractHoldEnd?: (ev: PointerEvent, completed: boolean) => void;
}) {
  document.getElementById("btn-list")?.addEventListener("click", () => {
    const price = Number((document.getElementById("list-price") as HTMLInputElement)?.value);
    api.listSelected(price);
  });
  document.getElementById("btn-equip")?.addEventListener("click", () => {
    api.equipSelected?.();
  });
  document.getElementById("btn-equip-best")?.addEventListener("click", () => {
    hapticLight();
    api.equipBest?.();
  });
  document.getElementById("btn-unequip")?.addEventListener("click", () => {
    api.unequipSelected?.();
  });
  document.getElementById("btn-stash")?.addEventListener("click", () => {
    api.stashSelected?.();
  });
  const meltBtn = document.getElementById("btn-melt") as HTMLButtonElement | null;
  meltBtn?.addEventListener("click", () => {
    if (!meltBtn || meltBtn.disabled) return;
    hapticLight();
    if (meltBtn.dataset.armed !== "1") {
      meltBtn.dataset.armed = "1";
      meltBtn.classList.add("armed");
      meltBtn.textContent = "Press again to melt";
      if (meltArmTimer != null) window.clearTimeout(meltArmTimer);
      meltArmTimer = window.setTimeout(() => {
        meltBtn.dataset.armed = "0";
        meltBtn.classList.remove("armed");
        const ash = lastBagItems.reduce((sum, it) => sum + vendorAsh(it), 0);
        meltBtn.disabled = lastBagItems.length === 0;
        meltBtn.textContent = lastBagItems.length
          ? `Melt all · ${ash.toLocaleString()} Ash`
          : "Nothing to melt";
      }, 2400);
      return;
    }
    meltBtn.dataset.armed = "0";
    meltBtn.classList.remove("armed");
    if (meltArmTimer != null) window.clearTimeout(meltArmTimer);
    api.meltBag?.();
  });
  document.getElementById("btn-ah-refresh")?.addEventListener("click", () => api.refreshAh());
  document.getElementById("btn-sip")?.addEventListener("click", (e) => {
    e.preventDefault();
    hapticLight();
    api.sip?.();
  });
  document.getElementById("btn-dash")?.addEventListener("click", (e) => {
    e.preventDefault();
    hapticLight();
    api.dash?.();
  });

  const inv = document.getElementById("btn-inv");
  inv?.addEventListener("click", (e) => {
    e.preventDefault();
    hapticLight();
    api.toggleInventory();
  });
  const ahBtn = document.getElementById("btn-ah");
  ahBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    hapticLight();
    api.toggleAh();
  });
  const interact = document.getElementById("btn-interact");
  if (interact && api.onInteractHoldStart) {
    let interactArmed = false;
    interact.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      interactArmed = true;
      try {
        interact.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      interact.classList.add("pressed", "charging");
      hapticLight();
      api.onInteractHoldStart?.(e);
    });
    const endInteract = (e: PointerEvent, completed: boolean) => {
      if (!interactArmed) return;
      interactArmed = false;
      interact.classList.remove("pressed", "charging");
      try {
        interact.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      api.onInteractHoldEnd?.(e, completed);
    };
    interact.addEventListener("pointerup", (e) => {
      e.preventDefault();
      endInteract(e, true);
    });
    interact.addEventListener("pointercancel", (e) => {
      e.preventDefault();
      endInteract(e, false);
    });
    interact.addEventListener("pointerleave", (e) => {
      // Drag-off cancels portal charge (scene ignores if already travelling / non-portal)
      if (interactArmed) endInteract(e, false);
    });
    interact.addEventListener("click", (e) => e.preventDefault());
  } else {
    interact?.addEventListener("click", (e) => {
      e.preventDefault();
      hapticLight();
      api.interactNearest();
    });
  }
  for (const b of [inv, ahBtn, interact]) if (b) wirePressed(b);

  const attackBtn = document.getElementById("btn-attack");
  if (attackBtn) {
    let holdArmed = false;
    const endHold = (e: Event) => {
      if (!holdArmed) return;
      holdArmed = false;
      e.preventDefault();
      attackBtn.classList.remove("pressed");
      api.onAttackHoldEnd?.();
    };
    attackBtn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      // Capture: a thumb sliding off the button keeps the hold (ends on lift only)
      try {
        attackBtn.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      holdArmed = true;
      attackBtn.classList.add("pressed");
      hapticLight();
      if (api.onAttackHoldStart) api.onAttackHoldStart();
      else api.attackNearest();
    });
    attackBtn.addEventListener("pointerup", endHold);
    attackBtn.addEventListener("pointercancel", endHold);
    attackBtn.addEventListener("lostpointercapture", endHold);
    // Avoid duplicate click after pointerup
    attackBtn.addEventListener("click", (e) => e.preventDefault());
  }

  document.getElementById("btn-skills")?.addEventListener("click", (e) => {
    e.preventDefault();
    hapticLight();
    api.toggleSkills?.();
  });
  document.getElementById("xp-plate")?.addEventListener("click", () => {
    document.getElementById("xp-plate")?.classList.toggle("show-read");
  });

  document.querySelectorAll<HTMLButtonElement>(".spell-btn").forEach((btn) => {
    wirePressed(btn);
    // Read data-spell at event time: loadout rewrites the attribute after this bind.
    btn.addEventListener("pointerdown", (e) => {
      const spellId = btn.getAttribute("data-spell");
      if (!spellId) return;
      e.preventDefault();
      e.stopPropagation();
      try {
        btn.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      btn.classList.add("pressed", "aiming");
      hapticLight();
      api.onSpellHoldStart?.(spellId, e);
    });
    btn.addEventListener("pointermove", (e) => {
      if (!btn.classList.contains("aiming")) return;
      const spellId = btn.getAttribute("data-spell");
      if (spellId) api.onSpellHoldMove?.(spellId, e);
    });
    const endHold = (e: PointerEvent, cast: boolean) => {
      const spellId = btn.getAttribute("data-spell");
      if (!spellId) return;
      if (!btn.classList.contains("aiming") && !cast) return;
      btn.classList.remove("pressed", "aiming");
      try {
        btn.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      api.onSpellHoldEnd?.(spellId, e, cast);
    };
    btn.addEventListener("pointerup", (e) => {
      e.preventDefault();
      endHold(e, true);
    });
    btn.addEventListener("pointercancel", (e) => {
      e.preventDefault();
      endHold(e, false);
    });
    btn.addEventListener("pointerleave", (e) => {
      const spellId = btn.getAttribute("data-spell");
      if (spellId) api.onSpellHoldMove?.(spellId, e);
    });
    btn.addEventListener("click", (e) => e.preventDefault());
  });

  document.querySelectorAll<HTMLButtonElement>("[data-close]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      const id = btn.getAttribute("data-close");
      if (id) setPanelOpen(id, false);
    });
  });

  // Tap the dimmed backdrop to dismiss whichever modal is open
  document.getElementById("modal-backdrop")?.addEventListener("click", (e) => {
    e.preventDefault();
    document.querySelectorAll<HTMLElement>(".panel.modal").forEach((p) => p.classList.add("hidden"));
    syncModalState();
  });

  // Keep the toast anchored under the HUD as plates wrap/resize
  placeToastLayer();
  window.addEventListener("resize", placeToastLayer);

  wireActionBarTips();
  armHelpFade();
}
