import { ashToStelleDisplay } from "../util/ash";

let selectedItemId: string | null = null;

export function showToast(text: string, level = "info") {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = text;
  el.style.color =
    level === "loot" ? "#d4b84a" : level === "emit" ? "#c9a227" : level === "warn" ? "#c66" : "#cde";
}

export function updateStats(you: any, title: string) {
  const canto = document.getElementById("canto-title");
  const hp = document.getElementById("hp");
  const ash = document.getElementById("ash");
  const pending = document.getElementById("pending");
  if (canto) canto.textContent = `${title} (${you.cantoId})`;
  if (hp) hp.textContent = `HP ${you.hp}/${you.maxHp}`;
  if (ash) ash.textContent = `Ash ${you.ash} (${ashToStelleDisplay(you.ash)} STELLE)`;
  if (pending) pending.textContent = `Pending ${you.pendingAsh} Ash`;
}

export function renderInventory(items: any[], onSelect: (id: string) => void) {
  const list = document.getElementById("inv-list");
  if (!list) return;
  list.innerHTML = "";
  for (const it of items) {
    const li = document.createElement("li");
    li.className = `r-${it.rarity}`;
    li.textContent = `[${it.rarity}] ${it.name}`;
    if (it.id === selectedItemId) li.classList.add("selected");
    li.onclick = () => {
      selectedItemId = it.id;
      onSelect(it.id);
      renderInventory(items, onSelect);
    };
    list.appendChild(li);
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
    list.innerHTML = "<li>No listings</li>";
    return;
  }
  for (const L of listings) {
    const li = document.createElement("li");
    li.className = `r-${L.item.rarity}`;
    li.innerHTML = `<div>[${L.item.rarity}] ${L.item.name}</div>
      <div style="font-size:0.75rem;color:#8a9a88">ask ${L.priceAsh} Ash · bid ${L.highestBidAsh || "—"} · ${L.sellerName}</div>`;
    const row = document.createElement("div");
    row.className = "row";
    const buy = document.createElement("button");
    buy.textContent = "Buy";
    buy.onclick = (e) => {
      e.stopPropagation();
      onBuy(L.id);
    };
    const bid = document.createElement("button");
    bid.textContent = "Bid+";
    bid.onclick = (e) => {
      e.stopPropagation();
      onBid(L.id);
    };
    row.append(buy, bid);
    li.appendChild(row);
    list.appendChild(li);
  }
}

export function togglePanel(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.toggle("hidden");
}

export function setPanelOpen(id: string, open: boolean) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.toggle("hidden", !open);
}

/** Narrow / touch-first UI (phones and compact tablets). */
export function isCompactUi(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(max-width: 640px)").matches ||
    (window.matchMedia("(pointer: coarse)").matches && window.innerWidth < 900)
  );
}

export function wireHud(api: {
  listSelected: (price: number) => void;
  refreshAh: () => void;
  toggleInventory: () => void;
  toggleAh: () => void;
  interactNearest: () => void;
  attackNearest: () => void;
}) {
  document.getElementById("btn-list")?.addEventListener("click", () => {
    const price = Number((document.getElementById("list-price") as HTMLInputElement)?.value);
    api.listSelected(price);
  });
  document.getElementById("btn-ah-refresh")?.addEventListener("click", () => api.refreshAh());

  document.getElementById("btn-inv")?.addEventListener("click", (e) => {
    e.preventDefault();
    api.toggleInventory();
  });
  document.getElementById("btn-ah")?.addEventListener("click", (e) => {
    e.preventDefault();
    api.toggleAh();
  });
  document.getElementById("btn-interact")?.addEventListener("click", (e) => {
    e.preventDefault();
    api.interactNearest();
  });
  document.getElementById("btn-attack")?.addEventListener("click", (e) => {
    e.preventDefault();
    api.attackNearest();
  });

  document.querySelectorAll<HTMLButtonElement>("[data-close]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      const id = btn.getAttribute("data-close");
      if (id) setPanelOpen(id, false);
    });
  });
}
