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

// Gate check: Lust→Gluttony should fail before Lust clear
// Dev jump from hub spawn (travel otherwise requires standing at the road)
ws.send(JSON.stringify({ type: "travel", toCanto: "inferno_05", bypassGates: true }));
await waitFor((m) => m.room?.cantoId === "inferno_05", 5000, "lust");
ws.send(JSON.stringify({ type: "travel", toCanto: "inferno_06" }));
await sleep(400);
if (lastSnap.room.cantoId === "inferno_06") {
  throw new Error("Gluttony should be gated until Lust first clear");
}
console.log("gate ok — still in Lust before clear");

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
// Boss pools are sized for a real fight (Judge 520 HP): stay on it, sip when low.
for (let i = 0; i < 600; i++) {
  const live = lastSnap?.room.entities.find((e) => e.id === boss.id);
  if (!live) break;
  const me = lastSnap.room.you;
  const d = Math.hypot(live.x - me.x, live.y - me.y);
  if (d > 2.8) ws.send(JSON.stringify({ type: "move", x: live.x, y: live.y }));
  else ws.send(JSON.stringify({ type: "attack", targetId: boss.id }));
  if (me.hp < me.maxHp * 0.4 && i % 20 === 0) ws.send(JSON.stringify({ type: "sip" }));
  await sleep(100);
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
  lastSnap.room.you.pendingAsh,
  "firstClears",
  lastSnap.room.you.firstClears
);
const item =
  lastSnap.room.you.inventory.find((i) => !i.soulbound) || lastSnap.room.you.inventory[0];
ws.send(JSON.stringify({ type: "ah_list", itemId: item.id, priceAsh: 1000 }));
await sleep(400);
const ahRes = await fetch("http://127.0.0.1:8080/ah").then((r) => r.json());
console.log("AH", ahRes.listings.length, ahRes.listings[0]?.item?.name, ahRes.listings[0]?.priceAsh);

// After Lust clear → Gluttony (travel is only accepted standing at the road)
const road = lastSnap.room.entities.find(
  (e) => (e.kind === "exit" || e.poiKind === "portal") && e.toCanto === "inferno_06"
);
for (let i = 0; i < 40; i++) {
  const me = lastSnap.room.you;
  if (Math.hypot(road.x - me.x, road.y - me.y) < 2) break;
  ws.send(JSON.stringify({ type: "move", x: road.x, y: road.y }));
  await sleep(120);
}
ws.send(JSON.stringify({ type: "travel", toCanto: "inferno_06" }));
await waitFor((m) => m.room?.cantoId === "inferno_06", 5000, "gluttony");
const glutBoss = lastSnap.room.entities.find((e) => e.kind === "boss");
const glutMobs = lastSnap.room.entities.filter((e) => e.kind === "mob");
if (!glutBoss) throw new Error("no Gluttony boss");
if (glutMobs.length < 5) throw new Error("Gluttony packs missing");
console.log(
  "gluttony",
  lastSnap.room.title,
  "boss",
  glutBoss.name,
  "mobs",
  glutMobs.length,
  "exits",
  lastSnap.room.entities.filter((e) => e.kind === "exit").map((e) => e.toCanto)
);

// Back to Lust
ws.send(JSON.stringify({ type: "travel", toCanto: "inferno_05" }));
await waitFor((m) => m.room?.cantoId === "inferno_05", 5000, "lust-return");
console.log("return Lust ok");

console.log(
  "emits",
  toasts.filter((t) => t.level === "emit").map((t) => t.text)
);
ws.close();
console.log("OK");
