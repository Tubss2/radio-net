/** Shown above the four push-to-talk choices, safest first. */
export const PTT_CHOOSER_INTRO = 'There are 4 options for setting up push to talk, ranked safest to least safe.';

/**
 * Desktop installer release. GitHub's /releases/latest currently redirects to the
 * helper-1 release, which is the tray program, so this link names the desktop tag.
 */
export const DESKTOP_RELEASE_URL = 'https://github.com/Tubss2/radio-net/releases/tag/v0.4.4';

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
    body: 'Small open-source app that links to this browser and listens for when you press push to talk. Works while in game. Only runs while its window is open.',
  },
  {
    rank: 4,
    title: 'Full app experience',
    body: 'Still heavily WIP. Offers in-game radio overlays and more advanced options. Probably don\'t use this unless you know and trust the developer personally.',
  },
] as const;
