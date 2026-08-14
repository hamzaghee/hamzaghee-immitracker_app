import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const root = path.dirname(fileURLToPath(import.meta.url));
// Chart geometry and palette live outside web/ so the server's report renderer
// can import the same module. Vite needs both the alias and fs access.
const sharedDir = path.resolve(root, '../shared');

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@shared': sharedDir },
  },
  server: {
    fs: { allow: [root, sharedDir] },
    port: 5173,
    // The API loads a 48MB dataset at startup; give it room on cold requests.
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        timeout: 600000,
      },
    },
  },
});
