/** Runs `fn` over `items` with at most `limit` in flight at once. Used to enrich the (much smaller,
 * bounded-by-time-window) recent-launches list with per-mint reward data without firing hundreds of
 * requests at stonk.fun simultaneously. */
export async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
