import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { injectPreviewCsp } from '../src/shared/webCsp';

/** The published mock must not be able to call the API. The dev server is left alone so its websocket still works. */
function previewCsp(): Plugin {
  return {
    name: 'preview-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return injectPreviewCsp(html);
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
