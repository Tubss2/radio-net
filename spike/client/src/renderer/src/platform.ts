import { inElectron } from './bridge';
import { isPreview } from './lib/previewMode';

/** The web build (`vite --mode web`). Preview and Electron stay on their own hosts. */
export const isWeb = import.meta.env.MODE === 'web';

/** Storage, hotkeys, and the overlay depend on the host. The radio UI does not. */
export type PlatformName = 'electron' | 'web' | 'preview';

export function platformName(): PlatformName {
  if (inElectron) return 'electron';
  if (isPreview) return 'preview';
  return 'web';
}
