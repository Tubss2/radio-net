import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const pagesCsp = [
  "default-src 'self'",
  "connect-src 'self' https://radio-149-28-170-200.sslip.io wss://lk-149-28-170-200.sslip.io https://lk-149-28-170-200.sslip.io",
  "img-src 'self' data: blob:",
  "media-src 'self' blob: mediastream:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
  "worker-src 'self' blob:",
].join('; ');

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
        return html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${pagesCsp}" />`);
      },
    },
  ],
  build: {
    outDir: resolve(__dirname, '../web-dist'),
    emptyOutDir: true,
  },
  server: { port: 5175, strictPort: true },
}));
