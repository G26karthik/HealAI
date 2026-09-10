import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

// The client, server and ml-svc all read shared/enums.js. Vite needs explicit
// permission to serve a file from outside its root.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@shared': path.resolve(here, '../shared') },
  },
  server: {
    port: 5173,
    fs: { allow: ['..'] },
    proxy: {
      '/api': { target: 'http://localhost:5000', changeOrigin: true },
      '/socket.io': { target: 'http://localhost:5000', ws: true },
    },
  },
});
