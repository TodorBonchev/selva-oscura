import WebSocket from "ws";

const ws = new WebSocket("ws://127.0.0.1:8080/ws");
await new Promise((r) => ws.on("open", r));

let lastSnap = null;
const toasts = [];
ws.on("message", (d) => {
  const m = JSON.parse(String(d));
  if (m.type === "snapshot") lastSnap = m;
  if (m.type === "toast") toasts.push(m);
  if (m.type === "welcome") {
    /* handled below */
  }
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (pred, ms = 12000, label = "cond") => {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (lastSnap && pred(lastSnap)) return lastSnap;
    await sleep(40);
  }
  throw new Error("timeout " + label);
};

await sleep(150);
ws.send(JSON.stringify({ type: "hello", name: "Buyer" }));
await waitFor((m) => m.room?.cantoId === "inferno_01", 5000, "hub");
ws.send(JSON.stringify({ type: "travel", toCanto: "inferno_05" }));
await waitFor((m) => m.room?.cantoId === "inferno_05", 5000, "lust");
const boss = lastSnap.room.entities.find((e) => e.kind === "boss");
if (!boss) throw new Error("no boss — room may need respawn (leave and rejoin)");
console.log("boss", boss.name, "hp", boss.hp);

for (let i = 0; i < 28; i++) {
  ws.send(
    JSON.stringify({
      type: "move",
      x: 20 + ((boss.x - 20) * i) / 27,
      y: 60 + ((boss.y - 60) * i) / 27,
    })
  );
  await sleep(40);
}
for (let i = 0; i < 55; i++) {
  ws.send(JSON.stringify({ type: "attack", targetId: boss.id }));
  await sleep(90);
  if (lastSnap && !lastSnap.room.entities.some((e) => e.id === boss.id)) break;
}
await waitFor((m) => !m.room.entities.some((e) => e.id === boss.id), 3000, "bossdead");
const loots = lastSnap.room.entities.filter((e) => e.kind === "loot");
console.log("loots", loots.map((l) => `${l.item.rarity}:${l.item.name}`));
for (const L of loots) {
  ws.send(JSON.stringify({ type: "move", x: L.x, y: L.y }));
  await sleep(60);
  ws.send(JSON.stringify({ type: "pickup", lootId: L.id }));
}
await waitFor((m) => m.room.you.inventory.length > 0, 4000, "pickup");
console.log(
  "inv",
  lastSnap.room.you.inventory.map((i) => i.rarity),
  "pendingAsh",
  lastSnap.room.you.pendingAsh
);
const item =
  lastSnap.room.you.inventory.find((i) => !i.soulbound) || lastSnap.room.you.inventory[0];
ws.send(JSON.stringify({ type: "ah_list", itemId: item.id, priceAsh: 1000 }));
await sleep(400);
const ahRes = await fetch("http://127.0.0.1:8080/ah").then((r) => r.json());
console.log("AH", ahRes.listings.length, ahRes.listings[0]?.item?.name, ahRes.listings[0]?.priceAsh);
console.log(
  "emits",
  toasts.filter((t) => t.level === "emit").map((t) => t.text)
);
ws.close();
console.log("OK");
