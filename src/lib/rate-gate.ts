/**
 * Minimum-interval gate.
 *
 * Each call to `acquire()` returns a promise that resolves when the caller
 * is allowed to make its request. Calls are serialized globally, so with a
 * gate of 1000ms you get at most one request per second across the whole
 * concurrency pool — regardless of how many workers are in flight.
 *
 * Usage:
 *   const gate = createRateGate(1000);
 *   await Promise.all(items.map(x => limit(async () => {
 *     await gate();
 *     await callGroq(x);
 *   })));
 */
export function createRateGate(minIntervalMs: number): () => Promise<void> {
  let nextAllowedAt = 0;
  let chain: Promise<void> = Promise.resolve();

  return function acquire(): Promise<void> {
    const ticket = chain.then(async () => {
      const now = Date.now();
      const wait = nextAllowedAt - now;
      if (wait > 0) {
        await new Promise((r) => setTimeout(r, wait));
      }
      nextAllowedAt = Date.now() + minIntervalMs;
    });
    chain = ticket;
    return ticket;
  };
}
