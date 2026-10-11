/**
 * One transaction at a time per sending key.
 *
 * The agent can now be woken by a press, an approval and the keeper at once,
 * each on a different capsule — the per-capsule lock does not stop that, and
 * should not. But all of them send from one account, and two sends that read
 * the pending nonce at the same moment get the same one: one lands, the other
 * is rejected. So submission is queued per address. Only the send waits its
 * turn; waiting for the receipt does not, so runs still overlap where they can.
 */
const g = globalThis as unknown as { __valetSendQueue?: Map<string, Promise<unknown>> };
const queues = (g.__valetSendQueue ??= new Map());

export function inTurn<T>(address: string, send: () => Promise<T>): Promise<T> {
  const key = address.toLowerCase();
  const prev = queues.get(key) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(send);
  queues.set(key, next);
  return next;
}
