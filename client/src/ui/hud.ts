import { ashToStelleDisplay } from "../util/ash";
import {
  EQUIP_SLOTS,
  itemIconUrl,
  resolveEquipSlot,
  type EquipSlot,
} from "../items/icons";
import { formatItemStats, itemStatBonus, itemStatsHtml, slotLabelForItem } from "../items/stats";
import { SPELLS, SPELL_HOTBAR, type SpellId } from "../spells";

let selectedItemId: string | null = null;
let toastTimer: number | null = null;
let lastHpShown: number | null = null;
let lastManaShown: number | null = null;
let helpFadeTimer: number | null = null;

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

/** Toast with brief fade; level → gold (loot), bright gold (emit), crimson (warn), bone (info). */
export function showToast(text: string, level = "info") {
  const el = document.getElementById("toast");
  if (!el) return;
  placeToastLayer();
  el.textContent = text;
  el.className = "";
  // Restart CSS animation even if the same class is re-applied
  void el.offsetWidth;
  el.classList.add("toast-show", `toast-${level}`);
  if (toastTimer != null) window.clearTimeout(toastTimer);
  const hold = level === "warn" ? 2600 : level === "emit" ? 3600 : 3000;
  toastTimer = window.setTimeout(() => {
    el.classList.remove("toast-show");
    el.classList.add("toast-fade");
  }, hold);
}

/** #toast-layer is fixed (above modals).
 *  Desktop / wide: pin under HUD plates.
 *  Narrow / short phones: raise above the two-row action bar so combat toasts stay readable.
 */
function placeToastLayer() {
  const layer = document.getElementById("toast-layer");
  const top = document.getElementById("hud-top");
  if (!layer || !top) return;
  const narrow =
    window.matchMedia("(max-width: 400px)").matches ||
    window.matchMedia("(max-height: 520px) and (max-width: 900px)").matches;
  if (narrow) {
    layer.classList.add("toast-above-actions");
    layer.style.top = "";
    const bar = document.getElementById("action-bar");
    const barH = bar ? bar.getBoundingClientRect().height : 0;
    const gap = 10;
    layer.style.bottom = `${Math.round(barH + gap)}px`;
  } else {
    layer.classList.remove("toast-above-actions");
    layer.style.bottom = "";
    const r = top.getBoundingClientRect();
    layer.style.top = `${Math.round(r.bottom + 6)}px`;
  }
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

export function updateStats(you: any, title: string) {
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
  }
  const maxHp = Number(you.maxHp) || 1;
  const cur = Math.max(0, Number(you.hp) || 0);
  const ratio = Math.max(0, Math.min(1, cur / maxHp));
  if (hp) hp.textContent = `${cur} / ${maxHp}`;
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
    // Pulse the frame on damage
    if (lastHpShown != null && cur < lastHpShown) {
      hpPlate.classList.remove("hp-hurt");
      void hpPlate.offsetWidth;
      hpPlate.classList.add("hp-hurt");
    }
    lastHpShown = cur;
  }
  if (ash) {
    ash.innerHTML = `<b>${formatAsh(you.ash)}</b> <i>Ash</i> <em>${ashToStelleDisplay(you.ash)} STELLE</em>`;
  }
  const maxMp = Number(you.maxMana) || 100;
  const curMp = Math.max(0, Number(you.mana) || 0);
  const mpRatio = Math.max(0, Math.min(1, curMp / maxMp));
  const mp = document.getElementById("mp");
  const mpFill = document.getElementById("mp-fill");
  const mpPlate = document.getElementById("mp-plate");
  if (mp) mp.textContent = `${Math.floor(curMp)} / ${maxMp}`;
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
    pending.textContent = p > 0 ? `+${formatAsh(p)} pending` : "";
    pending.classList.toggle("hidden", p <= 0);
  }
}

function formatAsh(n: number): string {
  return (Number(n) || 0).toLocaleString("en-US");
}

/** Short glyph for an item slot — first letters of the name. */
function slotGlyph(name: string): string {
  const words = String(name || "?")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return String(name || "?").slice(0, 2).toUpperCase();
}

export function renderInventory(
  items: any[],
  onSelect: (id: string) => void,
  opts?: {
    equipped?: Record<string, any>;
    gearStats?: { dmg?: number; maxHp?: number; armor?: number };
    onEquipSlotClick?: (slot: string) => void;
  }
) {
  const grid = document.getElementById("inv-grid");
  if (!grid) return;
  grid.innerHTML = "";
  grid.style.setProperty("--inv-cols", String(INV_COLS));

  const equipped = opts?.equipped || {};
  const count = items.length;
  const slots = Math.min(
    INV_MAX_SLOTS,
    Math.max(INV_MIN_SLOTS, Math.ceil(count / INV_COLS) * INV_COLS)
  );

  if (selectedItemId && !items.some((it) => it.id === selectedItemId) &&
      !Object.values(equipped).some((it: any) => it?.id === selectedItemId)) {
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
      const st = itemStatBonus(it);
      const tipStats = formatItemStats(st);
      const wear = slotLabelForItem(it);
      slot.title = tipStats
        ? `${RARITY_LABEL[it.rarity] || it.rarity} · ${it.name} (${wear})\n${tipStats}`
        : `${RARITY_LABEL[it.rarity] || it.rarity} · ${it.name} (${wear})`;
      slot.setAttribute("aria-label", slot.title.replace("\n", ", "));
    }
    const icon = itemIconUrl(it);
    slot.innerHTML = `<img class="inv-icon" src="${icon}" alt="" draggable="false" /><span class="inv-tier" aria-hidden="true"></span>`;
    if (it.id === selectedItemId) slot.classList.add("selected");
    slot.onclick = (e) => {
      e.preventDefault();
      selectedItemId = it.id;
      onSelect(it.id);
      renderInventory(items, onSelect, opts);
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
        body.innerHTML = `<img class="inv-icon" src="${itemIconUrl(worn)}" alt="" draggable="false" />`;
        {
          const st = itemStatBonus(worn);
          const tip = formatItemStats(st);
          btn.title = tip ? `${es}: ${worn.name}\n${tip}` : `${es}: ${worn.name}`;
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
      renderInventory(items, onSelect, opts);
    };
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
      Object.values(equipped).find((it: any) => it?.id === selectedItemId);
    if (sel) {
      const wear = slotLabelForItem(sel);
      const st = itemStatBonus(sel);
      const worn = Object.values(equipped).some((it: any) => it?.id === sel.id);
      detail.className = `inv-detail ${rarityClass(sel.rarity)}`;
      detail.innerHTML =
        `<div class="inv-detail-head">` +
        `<span class="inv-detail-name">${escapeHtml(sel.name)}</span>` +
        `<span class="inv-detail-rarity">${RARITY_LABEL[sel.rarity] || escapeHtml(sel.rarity)} · ${escapeHtml(wear)}` +
        (worn ? `<b class="inv-detail-worn">Worn</b>` : "") +
        `</span>` +
        `</div>` +
        `<div class="inv-detail-stats">${itemStatsHtml(st)}</div>`;
    } else {
      detail.className = "inv-detail";
      detail.innerHTML = `<span class="inv-detail-name muted">${count ? "Select an item — Equip wears it; List AH sells it." : "Your satchel is empty — foes in Lust drop loot."}</span>`;
    }
  }
}

export function getSelectedItemId() {
  return selectedItemId;
}

export function renderAh(listings: any[], onBuy: (id: string) => void, onBid: (id: string) => void) {
  const list = document.getElementById("ah-list");
  if (!list) return;
  list.innerHTML = "";
  if (!listings.length) {
    list.innerHTML = `<li class="ah-empty">No listings — the hall is quiet.</li>`;
    return;
  }
  for (const L of listings) {
    const li = document.createElement("li");
    li.className = `ah-row ah-loot-pulse ${rarityClass(L.item?.rarity)}`;
    const rarity = RARITY_LABEL[L.item?.rarity] || L.item?.rarity || "";
    li.innerHTML = `
      <div class="ah-item">
        <span class="ah-seal" aria-hidden="true"></span>
        <div class="ah-text">
          <div class="ah-name">${escapeHtml(L.item?.name)}</div>
          <div class="ah-meta"><span class="ah-rarity">${escapeHtml(rarity)}</span> · ${escapeHtml(L.sellerName)}</div>
        </div>
      </div>
      <div class="ah-prices">
        <span class="ah-ask"><i>Ask</i> ${formatAsh(L.priceAsh)}</span>
        <span class="ah-bid"><i>Bid</i> ${L.highestBidAsh ? formatAsh(L.highestBidAsh) : "—"}</span>
      </div>`;
    const row = document.createElement("div");
    row.className = "row ah-actions";
    const buy = document.createElement("button");
    buy.className = "btn-gold";
    buy.textContent = "Buy";
    buy.onclick = (e) => {
      e.stopPropagation();
      onBuy(L.id);
    };
    const bid = document.createElement("button");
    bid.textContent = "Bid +";
    bid.onclick = (e) => {
      e.stopPropagation();
      onBid(L.id);
    };
    row.append(buy, bid);
    li.appendChild(row);
    list.appendChild(li);
  }
}

function syncModalState() {
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

/** Narrow / touch-first UI (phones and compact tablets). */
export function isCompactUi(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(max-width: 640px)").matches ||
    (window.matchMedia("(pointer: coarse)").matches && window.innerWidth < 900)
  );
}

function hapticLight() {
  try {
    (navigator as Navigator & { vibrate?: (n: number) => void }).vibrate?.(10);
  } catch {
    /* ignore */
  }
}

/** Pressed-state helper for the gothic action buttons (mouse + touch). */
function wirePressed(btn: HTMLElement) {
  const off = () => btn.classList.remove("pressed");
  btn.addEventListener("pointerdown", () => btn.classList.add("pressed"));
  btn.addEventListener("pointerup", off);
  btn.addEventListener("pointerleave", off);
  btn.addEventListener("pointercancel", off);
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

export function noteSpellCast(spellId: string, cooldownSec: number) {
  spellCdUntil.set(spellId, Date.now() + cooldownSec * 1000);
  kickSpellCdLoop();
}

/** Optimistic melee CD radial on the Attack button (matches spell-style sweep). */
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

export function resetCombo() {
  if (comboCount <= 0) return;
  const wasShown = comboCount >= 2;
  comboCount = 0;
  comboLastAt = 0;
  syncComboPip(false, wasShown);
}

function syncComboPip(bump = false, expire = false) {
  const pip = document.getElementById("combo-pip");
  if (!pip) return;
  const show = comboCount >= 2;
  if (expire && !show) {
    pip.classList.remove("hidden", "combo-bump");
    void (pip as HTMLElement).offsetWidth;
    pip.classList.add("combo-expire");
    pip.setAttribute("aria-hidden", "false");
    if (comboExpireTimer != null) window.clearTimeout(comboExpireTimer);
    comboExpireTimer = window.setTimeout(() => {
      comboExpireTimer = null;
      if (comboCount < 2) {
        pip.classList.add("hidden");
        pip.classList.remove("combo-expire", "combo-bump", "combo-fever", "combo-fever-max");
        pip.setAttribute("aria-hidden", "true");
      }
    }, 420);
    return;
  }
  if (show) {
    pip.classList.remove("hidden", "combo-expire");
    pip.textContent = comboCount > 99 ? "99" : String(comboCount);
    pip.title = `Hit streak ×${comboCount}`;
    pip.setAttribute("aria-hidden", "false");
    pip.classList.toggle("combo-fever", comboCount >= 15);
    pip.classList.toggle("combo-fever-max", comboCount >= 20);
    if (bump) {
      pip.classList.remove("combo-bump");
      void (pip as HTMLElement).offsetWidth;
      pip.classList.add("combo-bump");
    }
  } else if (!pip.classList.contains("combo-expire")) {
    pip.classList.add("hidden");
    pip.classList.remove("combo-bump", "combo-fever", "combo-fever-max");
    pip.setAttribute("aria-hidden", "true");
    pip.textContent = "1";
  }
}

/** Fullscreen etch flash + soft respawn veil (death is more than a toast). */
export function playDeathRevive() {
  const el = document.getElementById("death-flash");
  if (!el) return;
  document.body.classList.remove("respawn-fade");
  document.body.classList.add("death-flash");
  el.setAttribute("aria-hidden", "false");
  window.setTimeout(() => {
    document.body.classList.remove("death-flash");
    document.body.classList.add("respawn-fade");
    window.setTimeout(() => {
      document.body.classList.remove("respawn-fade");
      el.setAttribute("aria-hidden", "true");
    }, 740);
  }, 280);
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
  });
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

function updateSpellButtons(mana: number) {
  const now = Date.now();
  for (const id of SPELL_HOTBAR) {
    const def = SPELLS[id];
    const btn = document.querySelector<HTMLElement>(`.spell-btn[data-spell="${id}"]`);
    if (!btn) continue;
    const until = spellCdUntil.get(id) || 0;
    const onCd = until > now;
    const was = spellWasOnCd.get(id) === true;
    const lack = mana < def.manaCost;
    btn.classList.toggle("on-cooldown", onCd);
    btn.classList.toggle("no-mana", lack && !onCd);
    btn.setAttribute("aria-disabled", onCd || lack ? "true" : "false");
    const cdEl = btn.querySelector<HTMLElement>(".spell-cd");
    if (cdEl) {
      if (onCd) {
        const left = Math.max(0, (until - now) / 1000);
        cdEl.hidden = false;
        cdEl.textContent = left >= 1 ? String(Math.ceil(left)) : left.toFixed(1);
        const frac = Math.max(0, Math.min(1, (until - now) / (def.cooldown * 1000)));
        cdEl.style.setProperty("--cd-frac", String(frac));
        cdEl.style.setProperty("--cd-deg", `${(frac * 360).toFixed(1)}deg`);
      } else {
        cdEl.hidden = true;
        cdEl.textContent = "";
      }
    }
    if (was && !onCd) pingSpellReady(btn);
    spellWasOnCd.set(id, onCd);
  }
  updateAttackCdButton();
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
  castSpell?: (spellId: SpellId) => void;
  /** Spell hold-to-confirm (Gale aim / Ward+Burst telegraph). */
  onSpellHoldStart?: (spellId: SpellId, ev: PointerEvent) => void;
  onSpellHoldMove?: (spellId: SpellId, ev: PointerEvent) => void;
  onSpellHoldEnd?: (spellId: SpellId, ev: PointerEvent, cast: boolean) => void;
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
  document.getElementById("btn-unequip")?.addEventListener("click", () => {
    api.unequipSelected?.();
  });
  document.getElementById("btn-ah-refresh")?.addEventListener("click", () => api.refreshAh());

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
      holdArmed = true;
      attackBtn.classList.add("pressed");
      hapticLight();
      if (api.onAttackHoldStart) api.onAttackHoldStart();
      else api.attackNearest();
    });
    attackBtn.addEventListener("pointerup", endHold);
    attackBtn.addEventListener("pointerleave", endHold);
    attackBtn.addEventListener("pointercancel", endHold);
    // Avoid duplicate click after pointerup
    attackBtn.addEventListener("click", (e) => e.preventDefault());
  }

  document.querySelectorAll<HTMLButtonElement>(".spell-btn[data-spell]").forEach((btn) => {
    wirePressed(btn);
    const spellId = btn.getAttribute("data-spell") as SpellId | null;
    if (spellId && SPELLS[spellId] && api.onSpellHoldStart) {
      // Hold-to-confirm: Gale aims; Ward/Burst show telegraph; release casts; Esc/drag-off cancels.
      btn.addEventListener("pointerdown", (e) => {
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
        api.onSpellHoldMove?.(spellId, e);
      });
      const endHold = (e: PointerEvent, cast: boolean) => {
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
        api.onSpellHoldMove?.(spellId, e);
      });
      btn.addEventListener("click", (e) => e.preventDefault());
      return;
    }
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      const id = btn.getAttribute("data-spell") as SpellId | null;
      if (!id || !SPELLS[id]) return;
      hapticLight();
      api.castSpell?.(id);
    });
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

  armHelpFade();
}
