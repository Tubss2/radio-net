/** Shown above the four push-to-talk choices, safest first. */
export const PTT_CHOOSER_INTRO = 'There are 4 options for setting up push to talk, ranked safest to least safe.';

/**
 * Desktop installer release. This names the desktop tag so the full-app
 * download stays on the installer.
 */
export const DESKTOP_RELEASE_URL = 'https://github.com/Tubss2/radio-net/releases/tag/v0.4.5';

/** Setup inside the helper card. The code field sits on the third step. */
export const helperSetupSteps = [
  'Download RadioNetHelper.exe.',
  'Open it. It only runs while its window is open.',
  'Enter the code from the helper window.',
] as const;

export type HelperPhase = 'idle' | 'looking' | 'found' | 'absent' | 'connected';

export function helperSetupStatus(phase: HelperPhase, holding = false): string {
  if (holding) return 'Connected. The microphone is live.';
  if (phase === 'connected') return 'Connected.';
  if (phase === 'looking') return 'Looking for the helper...';
  if (phase === 'found') return 'Helper found. Enter the code from the window.';
  if (phase === 'absent') return "The helper isn't running. Download it, open the window, then try again.";
  return 'Not linked yet.';
}

export const pttChoices = [
  {
    rank: 1,
    title: 'Browser only',
    body: 'Push to talk only works when the browser window is focused. Needs alt-tabbing, or use voice activation.',
  },
  {
    rank: 2,
    title: 'Phone activation',
    body: 'Open a browser tab on your phone and press your screen to talk. No downloads.',
  },
  {
    rank: 3,
    title: 'Helper app',
    body: 'Small open-source app that links to this browser. Talk is F1, previous channel is F3, and next channel is F4. You can change those keys in the helper window. Each key lights red while held. Works while in game. Only runs while its window is open.',
  },
  {
    rank: 4,
    title: 'Full app experience',
    body: 'Still heavily WIP. Offers in-game radio overlays and more advanced options. Probably don\'t use this unless you know and trust the developer personally.',
  },
] as const;
