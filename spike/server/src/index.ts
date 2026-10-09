import { MemoryAccountStore } from './accounts.js';
import { buildApp } from './app.js';
import { DEFAULT_BAND, MemoryChannelStore } from './store.js';

const env = (k: string, d: string) => process.env[k] ?? d;

const store = new MemoryChannelStore();
const accounts = new MemoryAccountStore();

// Dev seed: one community with a fixed invite code and a few channels, so the client has something to tune.
// The owner's device token is printed once so scripts can act as admin.
const owner = accounts.createAccount('Toby');
store.upsertCommunity({ id: 'dev', name: 'War Dogs NZ (dev)', band: DEFAULT_BAND, inviteCode: 'DEVN-ET01', createdAt: new Date().toISOString() });
accounts.addMembership('dev', owner.account.id, 'owner');
for (const [freq, name] of [['59.500', 'Command'], ['41.250', 'Arty'], ['45.000', 'Logi'], ['62.100', 'Alpha FT']] as const)
  store.create('dev', { freq, name }, owner.account.id);

const app = buildApp(
  store,
  {
    livekitUrl: env('LIVEKIT_URL', 'ws://127.0.0.1:7880'),
    livekitHttpUrl: env('LIVEKIT_HTTP_URL', 'http://127.0.0.1:7880'),
    apiKey: env('LIVEKIT_API_KEY', 'devkey'),
    apiSecret: env('LIVEKIT_API_SECRET', 'secret'),
    communitySetupCode: process.env.COMMUNITY_SETUP_CODE,
    joinRateLimit: Number(env('JOIN_RATE_LIMIT', '30')),
  },
  accounts,
);

const port = Number(env('PORT', '8787'));
app.listen({ port, host: '127.0.0.1' }).then(() => {
  console.log(`token server on http://127.0.0.1:${port}`);
  console.log(`dev community invite code: DEVN-ET01`);
});
