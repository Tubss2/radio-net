import { MemoryAccountStore } from './accounts.js';
import { buildApp } from './app.js';
import { DEFAULT_BAND, MemoryChannelStore } from './store.js';

const env = (k: string, d: string) => process.env[k] ?? d;

const store = new MemoryChannelStore();
const accounts = new MemoryAccountStore();

// Dev seed: one community with a fixed invite code and a few channels, so the client has something to tune.
// Off on real servers (SEED_DEV=0): the public DEVN-ET01 code would let anyone in.
const seedDev = env('SEED_DEV', '1') !== '0';
if (seedDev) {
  const owner = accounts.createAccount('Toby');
  store.upsertCommunity({ id: 'dev', name: 'War Dogs NZ (dev)', band: DEFAULT_BAND, inviteCode: 'DEVN-ET01', createdAt: new Date().toISOString() });
  accounts.addMembership('dev', owner.account.id, 'owner');
  for (const [freq, name] of [['59.500', 'Command'], ['41.250', 'Arty'], ['45.000', 'Logi'], ['62.100', 'Alpha FT']] as const)
    store.create('dev', { freq, name }, owner.account.id);
}

const app = buildApp(
  store,
  {
    livekitUrl: env('LIVEKIT_URL', 'ws://127.0.0.1:7880'),
    livekitHttpUrl: env('LIVEKIT_HTTP_URL', 'http://127.0.0.1:7880'),
    apiKey: env('LIVEKIT_API_KEY', 'devkey'),
    apiSecret: env('LIVEKIT_API_SECRET', 'secret'),
    communitySetupCode: process.env.COMMUNITY_SETUP_CODE,
    joinRateLimit: Number(env('JOIN_RATE_LIMIT', '30')),
    trustProxy: env('TRUST_PROXY', '0') === '1',
  },
  accounts,
);

const port = Number(env('PORT', '8787'));
const host = env('HOST', '127.0.0.1');
app.listen({ port, host }).then(() => {
  console.log(`token server on http://${host}:${port}`);
  if (seedDev) console.log(`dev community invite code: DEVN-ET01`);
});
