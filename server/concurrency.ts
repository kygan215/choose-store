export function concurrencyLimit(value: unknown, fallback = 1, maximum = 16) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.min(maximum, Math.floor(parsed)) : fallback;
}

// Drain in-flight work on failure; do not start any further items.
export async function forEachConcurrent<T>(items: readonly T[], limit: number, visit: (item: T) => Promise<void>) {
  let cursor = 0, stopped = false;
  const workers = Array.from({length: Math.min(items.length, concurrencyLimit(limit))}, async () => {
    while (!stopped && cursor < items.length) {
      const item = items[cursor++];
      try { await visit(item); } catch (error) { stopped = true; throw error; }
    }
  });
  const results = await Promise.allSettled(workers);
  const failed = results.find(result => result.status === "rejected");
  if (failed?.status === "rejected") throw failed.reason;
}
