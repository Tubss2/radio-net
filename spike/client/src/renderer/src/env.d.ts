declare module '*.css';
declare module '*.wav?url' {
  const src: string;
  export default src;
}

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_LIVEKIT_URL?: string;
  readonly MODE: string;
  readonly BASE_URL: string;
  readonly PROD: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
