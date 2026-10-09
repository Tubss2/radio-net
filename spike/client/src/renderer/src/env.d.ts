declare module '*.css';

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_LIVEKIT_URL?: string;
  readonly MODE: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
