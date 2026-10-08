import { Redis } from "ioredis";

type RateRedis = Pick<Redis, "eval">;
const sleep = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));
// Redis TIME keeps API and Worker on one clock. Only immediate grants advance
// the next slot, so an event-loop delay cannot release a backlog all at once.
const ACQUIRE_SLOT = `
local clock = redis.call('TIME')
local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
local next = tonumber(redis.call('GET', KEYS[1]) or '0')
if next > now then return next - now end
redis.call('SET', KEYS[1], now + tonumber(ARGV[1]), 'PX', 2000)
return 0`;

export function createAmapRateLimiter(qps: number, redis?: RateRedis, scope = "storemap:amap:rate") {
  const interval = Math.ceil(1000 / Math.max(1, Math.min(100, Number.isFinite(qps) ? qps : 10)));
  let next = 0;
  return async () => {
    if (redis) {
      for (;;) {
        const wait = Number(await redis.eval(ACQUIRE_SLOT, 1, scope, interval));
        if (!Number.isFinite(wait) || wait < 0) throw new Error("高德请求限流服务返回无效结果");
        if (wait === 0) return;
        await sleep(wait);
      }
    }
    for (;;) {
      const wait = next - Date.now();
      if (wait <= 0) { next = Date.now() + interval; return; }
      await sleep(wait);
    }
  };
}

let limiter: (() => Promise<void>) | undefined;
export async function waitForAmapSlot() {
  if (!limiter) {
    const qps = Number(process.env.AMAP_MAX_QPS || 1000 / Math.max(50, Number(process.env.AMAP_REQUEST_INTERVAL_MS || 100)));
    const redis = process.env.REDIS_URL ? new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 1, connectTimeout: 3000,
    }) : undefined;
    redis?.on("error", () => {});
    limiter = createAmapRateLimiter(qps, redis);
  }
  try { await limiter(); } catch { throw new Error("高德请求限流服务暂不可用，请稍后重试"); }
}
