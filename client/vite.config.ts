import { defineConfig } from "vite";
import path from "node:path";

export default defineConfig({
  root: ".",
  publicDir: "public",
  resolve: {
    alias: {
      "@game-core": path.resolve(__dirname, "../shared/game-core/src"),
    },
  },
  server: {
    port: 5173,
    host: true,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
  },
  define: {
    __DEFAULT_GAME_SERVER__: JSON.stringify(
      process.env.VITE_GAME_SERVER_URL ||
        "https://game-server-production-b9f9.up.railway.app"
    ),
  },
});
