import { defineConfig } from "vite";

export default defineConfig({
  root: ".",
  publicDir: "public",
  server: {
    port: 5173,
    host: true,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    chunkSizeWarningLimit: 2000,
  },
  define: {
    __DEFAULT_GAME_SERVER__: JSON.stringify(
      process.env.VITE_GAME_SERVER_URL ||
        "https://game-server-production-b9f9.up.railway.app"
    ),
  },
});
