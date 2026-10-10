import { hashAdminKey } from './accounts.js';
import { assertProductionConfig } from './production.js';
import { DEFAULT_BAND, FileChannelStore, MemoryChannelStore, type ChannelStore } from './store.js';

/** Fixed dev admin key so a local client can create channels without fishing it out of a log each boot. Production sets SEED_DEV=0. */
const DEV_ADMIN_KEY = 'rnk_dev';

export interface BootEnv {
  NODE_ENV?: string;
  SEED_DEV?: string;
  RN_DATA_FILE?: string;
  RN_STORE_MAC_KEY?: string;
  LIVEKIT_API_KEY?: string;
  LIVEKIT_API_SECRET?: string;
  COMMUNITY_SETUP_CODE?: string;
}

/**
 * Open the channel store. Production checks run first, so a refused boot does not
 * write the public dev community into store.json.
 */
export function loadStore(env: BootEnv): { store: ChannelStore; seededNow: boolean } {
  const seedDev = (env.SEED_DEV ?? '1') !== '0';
  assertProductionConfig({
    nodeEnv: env.NODE_ENV,
    seedDev,
    apiKey: env.LIVEKIT_API_KEY ?? 'devkey',
    apiSecret: env.LIVEKIT_API_SECRET ?? 'secret',
    setupCode: env.COMMUNITY_SETUP_CODE,
  });
  const dataFile = env.RN_DATA_FILE;
  const store: ChannelStore = dataFile ? new FileChannelStore(dataFile, env.RN_STORE_MAC_KEY) : new MemoryChannelStore();
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
  return { store, seededNow };
}
