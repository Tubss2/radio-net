import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { PAGES_CSP, injectCsp } from '../src/shared/pagesCsp';

/** The product web app. GitHub Pages serves it at /radio-net/. */
export default defineConfig(({ command }) => ({
  root: resolve(__dirname),
  base: command === 'serve' ? '/' : '/radio-net/',
  plugins: [
    react(),
    {
      name: 'pages-csp',
      transformIndexHtml(html: string) {
        if (command === 'serve') return html;
        return injectCsp(html, PAGES_CSP);
      },
    },
  ],
  build: {
    outDir: resolve(__dirname, '../web-dist'),
    emptyOutDir: true,
  },
  server: { port: 5175, strictPort: true },
}));
