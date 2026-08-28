import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "web",
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 43120,
    proxy: {
      "/api": "http://127.0.0.1:43119",
      "/health": "http://127.0.0.1:43119"
    }
  },
  build: {
    outDir: "../dist/web",
    emptyOutDir: true
  }
});
