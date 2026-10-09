/** Refuse to boot a public server with the repo's dev invite or the public LiveKit dev secret. */
export function assertProductionConfig(env: {
  nodeEnv?: string;
  seedDev: boolean;
  apiKey: string;
  apiSecret: string;
  setupCode?: string;
}): void {
  if (env.nodeEnv !== 'production') return;
  if (env.seedDev) throw new Error('SEED_DEV must be 0 when NODE_ENV is production');
  if (env.apiKey === 'devkey' || env.apiSecret === 'secret' || env.apiSecret.length < 16) {
    throw new Error('Refusing the dev LiveKit credentials when NODE_ENV is production');
  }
  if (!env.setupCode) throw new Error('COMMUNITY_SETUP_CODE is required when NODE_ENV is production');
}
