import { describe, expect, it } from 'vitest';
import { ALL_CALL_ATTR, allCallSpeaker } from './allCall';

describe('all-call speaker', () => {
  it('uses a remote name marked by the server, including a forward', () => {
    expect(allCallSpeaker([
      { name: 'Toby', identity: 'me', local: true, attributes: { [ALL_CALL_ATTR]: '1' } },
      { name: 'Rhys', identity: 'r', attributes: { [ALL_CALL_ATTR]: '1' } },
    ])).toBe('Rhys');
    expect(allCallSpeaker([{ name: '', identity: 'r', forwarded: true }])).toBe('r');
    expect(allCallSpeaker([{ name: 'Sam', identity: 's', attributes: {} }])).toBeNull();
  });
});
