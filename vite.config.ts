import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  root: path.join(__dirname, "client"),
  build: {
    outDir: path.join(__dirname, "dist", "client"),
    emptyOutDir: true,
    rollupOptions: {
      input: path.join(__dirname, "client", "index.html")
    }
  },
  resolve: {
    alias: {
      '@': path.join(__dirname, "client", "src"),
      '@db': path.join(__dirname, "db")
    }
  }
});
