import { describe, expect, it } from 'vitest';
import { isHoldButtonRelease, shouldDropBrowserPtt } from './browserPtt';

describe('browser push-to-talk release', () => {
  it('drops the button when the window blurs or the tab hides', () => {
    expect(shouldDropBrowserPtt({ type: 'blur' })).toBe(true);
    expect(shouldDropBrowserPtt({ type: 'visibilitychange', visibilityState: 'hidden' })).toBe(true);
    expect(shouldDropBrowserPtt({ type: 'visibilitychange', visibilityState: 'visible' })).toBe(false);
  });

  it('drops Space on keyup and ignores other keys and clicks', () => {
    expect(shouldDropBrowserPtt({ type: 'keyup', code: 'Space' })).toBe(true);
    expect(shouldDropBrowserPtt({ type: 'keyup', code: 'KeyG' })).toBe(false);
    expect(shouldDropBrowserPtt({ type: 'pointerup' })).toBe(false);
    expect(isHoldButtonRelease('pointerup')).toBe(true);
    expect(isHoldButtonRelease('pointerleave')).toBe(true);
    expect(isHoldButtonRelease('click')).toBe(false);
  });
});
