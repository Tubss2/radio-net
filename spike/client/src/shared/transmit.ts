/** The talk channel is the one already chosen, or the first tuned channel that can transmit. */
export function pickTransmitId(
  current: string | null,
  rows: { id: string; canTransmit: boolean; status: string }[],
): string | null {
  if (current && rows.some((row) => row.id === current && row.canTransmit && row.status !== 'gone')) return current;
  return rows.find((row) => row.canTransmit && row.status !== 'gone')?.id ?? null;
}
