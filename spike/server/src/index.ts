import { buildApp } from './app.js';
import { loadStore } from './boot.js';

const env = (k: string, d: string) => process.env[k] ?? d;

const { store, seededNow } = loadStore(process.env);
const dataFile = process.env.RN_DATA_FILE;

const app = buildApp(store, {
  livekitUrl: env('LIVEKIT_URL', 'ws://127.0.0.1:7880'),
  livekitHttpUrl: env('LIVEKIT_HTTP_URL', 'http://127.0.0.1:7880'),
  apiKey: env('LIVEKIT_API_KEY', 'devkey'),
  apiSecret: env('LIVEKIT_API_SECRET', 'secret'),
  communitySetupCode: process.env.COMMUNITY_SETUP_CODE,
  joinRateLimit: Number(env('JOIN_RATE_LIMIT', '30')),
  trustProxy: env('TRUST_PROXY', '0') === '1',
});

const port = Number(env('PORT', '8787'));
const host = env('HOST', '127.0.0.1');
app.listen({ port, host }).then(() => {
  console.log(`token server on http://${host}:${port}${dataFile ? ` (store ${dataFile})` : ''}`);
  if (seededNow) console.log('dev community seeded; invite DEVN-ET01 (admin key is the local dev key, not printed)');
});
