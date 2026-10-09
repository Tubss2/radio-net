import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/** Browser preview. `base: './'` so the built site works from any path, including a GitHub Pages subpath. */
export default defineConfig({
  root: resolve(__dirname),
  base: './',
  plugins: [react()],
  build: {
    outDir: resolve(__dirname, '../preview-dist'),
    emptyOutDir: true,
  },
  server: { port: 5174, strictPort: true },
});
