import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Get absolute path to client directory
const clientDir = path.resolve(__dirname, 'client');

export default defineConfig({
  plugins: [react()],
  root: clientDir,  // Set root to client directory
  base: '',
  build: {
    outDir: path.resolve(__dirname, 'dist', 'client'),
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: path.resolve(clientDir, 'index.html')
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(clientDir, 'src'),
      '@db': path.resolve(__dirname, 'db')
    }
  }
}); 