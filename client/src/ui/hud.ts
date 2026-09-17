import { ashToStelleDisplay } from "../util/ash";
import {
  EQUIP_SLOTS,
  itemIconUrl,
  resolveEquipSlot,
  type EquipSlot,
} from "../items/icons";

let selectedItemId: string | null = null;
let toastTimer: number | null = null;
let lastHpShown: number | null = null;

/** Server cap is 40; grid shows a fixed PoE-style slab of slots. */
const INV_COLS = 6;
const INV_MIN_SLOTS = 24;
const INV_MAX_SLOTS = 40;

const RARITY_LABEL: Record<string, string> = {
  normal: "Normal",
  magic: "Magic",
  rare: "Rare",
  set: "Set",
  unique: "Unique",
  canto_unique: "Canto Unique",
};

function rarityClass(r: string | undefined): string {
  const k = String(r || "normal");
  return `r-${k in RARITY_LABEL ? k : "normal"}`;
}

/** Toast with brief fade; level → gold (loot), bright gold (emit), crimson (warn), bone (info). */
export function showToast(text: string, level = "info") {
  const el = document.getElementById("toast");
  if (!el) return;
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
    slot.title = `${RARITY_LABEL[it.rarity] || it.rarity} · ${it.name}`;
    slot.setAttribute("aria-label", slot.title);
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
        btn.title = `${es}: ${worn.name}`;
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
    statsEl.textContent = `Gear  +${g.dmg || 0} dmg · +${g.maxHp || 0} HP · +${g.armor || 0} arm`;
  }

  const detail = document.getElementById("inv-detail");
  if (detail) {
    const sel =
      items.find((it) => it.id === selectedItemId) ||
      Object.values(equipped).find((it: any) => it?.id === selectedItemId);
    if (sel) {
      const wear = resolveEquipSlot(sel);
      detail.className = `inv-detail ${rarityClass(sel.rarity)}`;
      detail.innerHTML = `<span class="inv-detail-name">${escapeHtml(sel.name)}</span><span class="inv-detail-rarity">${RARITY_LABEL[sel.rarity] || escapeHtml(sel.rarity)}${wear ? " · " + wear : " · junk"}</span>`;
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
    li.className = `ah-row ${rarityClass(L.item?.rarity)}`;
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
  interact?.addEventListener("click", (e) => {
    e.preventDefault();
    hapticLight();
    api.interactNearest();
  });
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
}
