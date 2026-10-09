/** One line for the web radio after someone picks how they talk. */
export function describePttMode(input: {
  talkMode: 'hold' | 'voice';
  talkLabel: string;
  phoneLinked: boolean;
  helperLinked: boolean;
}): string {
  const here = input.talkMode === 'voice'
    ? 'open mic in this window'
    : `hold ${input.talkLabel} while this window is focused`;
  const extra: string[] = [];
  if (input.phoneLinked) extra.push('phone');
  if (input.helperLinked) extra.push('Windows helper');
  if (extra.length === 0) return `Current: ${here}`;
  return `Current: ${extra.join(' and ')} · ${here}`;
}
