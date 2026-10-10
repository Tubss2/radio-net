import { describe, expect, it } from 'vitest';
import { pickTransmitId } from './transmit';

describe('pickTransmitId', () => {
  const rows = [
    { id: 'a', canTransmit: true, status: 'live' },
    { id: 'b', canTransmit: true, status: 'connecting' },
  ];

  it('keeps the current talk channel', () => {
    expect(pickTransmitId('b', rows)).toBe('b');
  });

  it('picks the first tuned channel that can transmit', () => {
    expect(pickTransmitId(null, rows)).toBe('a');
    expect(pickTransmitId('missing', rows)).toBe('a');
  });

  it('skips a listen-only or deleted channel', () => {
    expect(pickTransmitId(null, [
      { id: 'listen', canTransmit: false, status: 'live' },
      { id: 'gone', canTransmit: true, status: 'gone' },
      { id: 'cmd', canTransmit: true, status: 'live' },
    ])).toBe('cmd');
    expect(pickTransmitId(null, [{ id: 'listen', canTransmit: false, status: 'live' }])).toBeNull();
  });
});
