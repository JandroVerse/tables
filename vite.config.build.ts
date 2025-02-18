import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Get absolute path to client directory
const clientDir = path.resolve(__dirname, 'client');

export default defineConfig({
  plugins: [react()],
  root: path.join(__dirname, "client"),
  base: '',
  build: {
    outDir: path.join(__dirname, "dist", "server", "public"),
    emptyOutDir: true,
    chunkSizeWarningLimit: 1000,
    sourcemap: true,
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