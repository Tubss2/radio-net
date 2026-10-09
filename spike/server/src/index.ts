import { hashAdminKey } from './accounts.js';
import { buildApp } from './app.js';
import { DEFAULT_BAND, FileChannelStore, MemoryChannelStore, type ChannelStore } from './store.js';

const env = (k: string, d: string) => process.env[k] ?? d;

const dataFile = process.env.RN_DATA_FILE;
const store: ChannelStore = dataFile ? new FileChannelStore(dataFile) : new MemoryChannelStore();

/** Fixed dev admin key so a local client can create channels without fishing it out of a log each boot. Production sets SEED_DEV=0. */
const DEV_ADMIN_KEY = 'rnk_dev';

// Dev seed: one community with a fixed invite code and a few channels, so the client has something to tune.
// Off on real servers (SEED_DEV=0): the public DEVN-ET01 code would let anyone in.
// A file store only seeds when it is empty, so a restart does not duplicate the dev community.
const seedDev = env('SEED_DEV', '1') !== '0';
let seededNow = false;
if (seedDev && store.listCommunities().length === 0) {
  seededNow = true;
  store.upsertCommunity({
    id: 'dev',
    name: 'War Dogs NZ (dev)',
    band: DEFAULT_BAND,
    inviteCode: 'DEVN-ET01',
    adminKeyHash: hashAdminKey(DEV_ADMIN_KEY),
    createdAt: new Date().toISOString(),
  });
  for (const [freq, name] of [['59.5', 'Command'], ['41.5', 'Arty'], ['45.0', 'Logi'], ['62.0', 'Alpha FT']] as const)
    store.create('dev', { freq, name }, 'seed');
}

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
  if (seededNow) console.log(`dev community invite code: DEVN-ET01  admin key: ${DEV_ADMIN_KEY}`);
});
