import { defineConfig } from "vite";

export default defineConfig(({ mode }) => ({
  server: {
    port: 3000,
    ...(mode === "test" ? { hmr: false, watch: null } : {}),
    strictPort: true,
    proxy: { "/api": "http://127.0.0.1:4320" },
    fs: { strict: true, deny: ["**/data/**", "**/.env*", "**/.git/**"] },
  },
  preview: { proxy: { "/api": "http://127.0.0.1:4320" } },
  build: {
    rollupOptions: { output: { manualChunks: { phaser: ["phaser"] } } },
  },
}));
