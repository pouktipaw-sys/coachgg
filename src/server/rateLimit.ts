// Limiteur en mémoire (fenêtre glissante). Suffisant pour une instance unique ;
// à remplacer par un stockage partagé (Postgres/Redis) en multi-instance.
const buckets = new Map<string, number[]>();

export function rateLimit(key: string, max: number, windowMs: number): boolean {
  if (process.env.DISABLE_RATE_LIMIT === "1") return true;
  const now = Date.now();
  const arr = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= max) {
    buckets.set(key, arr);
    return false;
  }
  arr.push(now);
  buckets.set(key, arr);
  return true;
}

export function resetRateLimits() {
  buckets.clear();
}
