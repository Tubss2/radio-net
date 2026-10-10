import { describe, expect, it } from 'vitest';
import { BIND_RECORD_MS, canArmBindRecord } from './bindRecord';

describe('bind recording', () => {
  it('arms only while the main window is focused', () => {
    expect(BIND_RECORD_MS).toBe(10_000);
    expect(canArmBindRecord({ fromApp: true, isMainWindow: true, focused: true })).toBe(true);
    expect(canArmBindRecord({ fromApp: true, isMainWindow: true, focused: false })).toBe(false);
    expect(canArmBindRecord({ fromApp: true, isMainWindow: false, focused: true })).toBe(false);
    expect(canArmBindRecord({ fromApp: false, isMainWindow: true, focused: true })).toBe(false);
  });
});
