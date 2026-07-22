// apps/editor/vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true, // reachable from outside the container (docker/editor.Dockerfile)
  },
  preview: {
    port: 5173,
    host: true,
  },
});