import { defineConfig } from "vite";

export default defineConfig(({ mode }) => ({
  server: {
    port: 3000,
    ...(mode === "test" ? { hmr: false, watch: null } : {}),
    strictPort: true,
    fs: { strict: true, deny: ["**/data/**", "**/.env*", "**/.git/**"] },
  },
  build: {
    rollupOptions: { output: { manualChunks: { phaser: ["phaser"] } } },
  },
}));
