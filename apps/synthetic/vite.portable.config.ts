import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "portable",
  base: "./",
  publicDir: "../public",
  plugins: [react()],
  build: {
    outDir: "../portable-dist",
    emptyOutDir: true,
  },
});
