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
export type HapticKind = "tap" | "soak" | "slam" | "mana" | "ready" | "portal" | "sticky";
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
    default:
      hapticLight(10);
  }
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
export function setPortalHoldUi(frac: number | null, dest = "portal") {
  const btn = document.getElementById("btn-interact");
  const cd = btn?.querySelector<HTMLElement>(".interact-cd");
  const label = btn?.querySelector<HTMLElement>(".action-label");
  const prompt = document.getElementById("portal-hold-prompt");
  const bar = prompt?.querySelector<HTMLElement>(".php-bar i");
  const destEl = prompt?.querySelector<HTMLElement>(".php-dest");
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
  const spellId = btn.getAttribute("data-spell") as SpellId | null;
  if (spellId && SPELLS[spellId]) {
    const s = SPELLS[spellId];
    return {
      key: s.hotkey,
      name: s.name,
      meta: `${s.manaCost} mana · ${s.cooldown.toFixed(s.cooldown % 1 ? 1 : 0)}s`,
      blurb: s.blurb,
    };
  }
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
    ? document.getElementById(`btn-spell-${spellId}`)
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

  wireActionBarTips();
  armHelpFade();
}
