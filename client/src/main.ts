import Phaser from "phaser";
import { GameSocket } from "./net/GameSocket";
import { WorldScene } from "./scenes/WorldScene";
import { showToast } from "./ui/hud";

const DEFAULT_SERVER =
  import.meta.env.VITE_GAME_SERVER_URL ||
  (typeof __DEFAULT_GAME_SERVER__ !== "undefined"
    ? __DEFAULT_GAME_SERVER__
    : "https://game-server-production-b9f9.up.railway.app");

function resolveServer(): string {
  const params = new URLSearchParams(location.search);
  const q = params.get("server");
  if (q) return q.replace(/\/$/, "");
  return DEFAULT_SERVER.replace(/\/$/, "");
}

const serverUrl = resolveServer();
const name =
  new URLSearchParams(location.search).get("name") ||
  `Wanderer-${Math.random().toString(36).slice(2, 6)}`;

showToast(`Connecting to ${serverUrl}…`, "info");

const socket = new GameSocket(serverUrl, name);
socket.connect();

socket.on((msg) => {
  if (msg.type === "welcome") {
    showToast(`Connected as ${name}`, "info");
  }
});

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: "game-root",
  width: window.innerWidth,
  height: window.innerHeight,
  backgroundColor: "#0b0f0c",
  scene: [WorldScene],
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
};

const game = new Phaser.Game(config);
game.scene.start("world", { socket });

window.addEventListener("resize", () => {
  game.scale.resize(window.innerWidth, window.innerHeight);
});

console.info("[Selva Oscura] Slice 1 client", { serverUrl, name });
