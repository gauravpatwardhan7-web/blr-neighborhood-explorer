// In-process sliding-window rate limiter.
// Works for single-instance Node.js deployments (Vercel serverless / self-hosted).
// For multi-replica deployments replace the Map with Redis / Upstash.

type Entry = { count: number; resetAt: number };

const store = new Map<string, Entry>();
const MAX_ENTRIES = 5_000; // hard cap to prevent unbounded memory growth

function evict(now: number) {
  for (const [k, v] of store) {
    if (now >= v.resetAt) store.delete(k);
    if (store.size < MAX_ENTRIES / 2) break;
  }
}

export function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number
): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();

  if (store.size >= MAX_ENTRIES) evict(now);

  const entry = store.get(key);

  if (!entry || now >= entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSec: 0 };
  }

  if (entry.count >= maxRequests) {
    return { allowed: false, retryAfterSec: Math.ceil((entry.resetAt - now) / 1000) };
  }

  entry.count++;
  return { allowed: true, retryAfterSec: 0 };
}

// Extract the real client IP from the forwarded header set by Vercel / nginx / Cloudflare.
export function getClientIp(req: { headers: { get(name: string): string | null } }): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
}
