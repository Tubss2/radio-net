import { describe, expect, it } from 'vitest';
import { DESKTOP_RELEASE_URL, PTT_CHOOSER_INTRO, helperSetupStatus, helperSetupSteps, pttChoices } from './pttChooser';

describe('push-to-talk chooser', () => {
  it('ranks four options from safest to least safe', () => {
    expect(PTT_CHOOSER_INTRO).toBe('There are 4 options for setting up push to talk, ranked safest to least safe.');
    expect(pttChoices.map((choice) => choice.rank)).toEqual([1, 2, 3, 4]);
    expect(pttChoices.map((choice) => choice.title)).toEqual([
      'Browser only',
      'Phone activation',
      'Helper app',
      'Full app experience',
    ]);
    expect(pttChoices[0].body).toContain('alt-tabbing');
    expect(pttChoices[1].body).toContain('No downloads');
    expect(pttChoices[2].body).toContain('while its window is open');
    expect(helperSetupSteps).toEqual([
      'Download RadioNetHelper.exe.',
      'Open it. It only runs while its window is open.',
      'Enter the code from the helper window.',
    ]);
    expect(helperSetupStatus('idle')).toBe('Not linked yet.');
    expect(helperSetupStatus('looking')).toBe('Looking for the helper...');
    expect(helperSetupStatus('found')).toContain('Helper found');
    expect(helperSetupStatus('absent')).toContain("isn't running");
    expect(helperSetupStatus('connected')).toBe('Connected.');
    expect(helperSetupStatus('connected', true)).toContain('microphone');
    expect(pttChoices[3].body).toContain('trust the developer personally');
  });

  it('points the full app at the desktop release, not the helper release', () => {
    expect(DESKTOP_RELEASE_URL).toBe('https://github.com/Tubss2/radio-net/releases/tag/v0.4.4');
    expect(DESKTOP_RELEASE_URL).not.toContain('helper-');
  });
});
