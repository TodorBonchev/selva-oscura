import { ashToStelleDisplay } from "@game-core/types";

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

export function wireHud(api: {
  listSelected: (price: number) => void;
  refreshAh: () => void;
}) {
  document.getElementById("btn-list")?.addEventListener("click", () => {
    const price = Number((document.getElementById("list-price") as HTMLInputElement)?.value);
    api.listSelected(price);
  });
  document.getElementById("btn-ah-refresh")?.addEventListener("click", () => api.refreshAh());
}
