import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { PREVIEW_CSP, injectCsp } from '../src/shared/pagesCsp';

/** Build only. The dev server keeps its own websocket. */
function previewCsp(): Plugin {
  return {
    name: 'preview-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return injectCsp(html, PREVIEW_CSP);
    },
  };
}

/** Browser preview. `base: './'` so the built site works from any path, including a GitHub Pages subpath. */
export default defineConfig({
  root: resolve(__dirname),
  base: './',
  plugins: [react(), previewCsp()],
  build: {
    outDir: resolve(__dirname, '../preview-dist'),
    emptyOutDir: true,
  },
  server: { port: 5174, strictPort: true },
});
