import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    // The Go server serves ./web, so build straight into it.
    outDir: "../web",
    emptyOutDir: true,
  },
  server: {
    proxy: {
      "/api": "http://localhost:8025",
    },
  },
});
