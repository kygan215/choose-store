/** Amap's consumer rating is separate from our 100-point location match score. */
export function normalizeAmapRating(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !value.trim()) return null;
  const rating = Number(value);
  return Number.isFinite(rating) && rating > 0 && rating <= 5 ? rating : null;
}

export function amapRating(poi: unknown): number | null {
  if (!poi || typeof poi !== "object") return null;
  const row = poi as Record<string, any>;
  return normalizeAmapRating(row.business?.rating)
    ?? normalizeAmapRating(row.biz_ext?.rating)
    ?? normalizeAmapRating(row.rating);
}

export function matchedAmapRating(poiId: unknown, candidates: unknown): number | null {
  if (!poiId || !Array.isArray(candidates)) return null;
  return amapRating(candidates.find(item => item && String(item.id) === String(poiId)));
}

export function formatAmapRating(value: unknown): string {
  const rating = normalizeAmapRating(value);
  return rating === null ? "暂无评分" : `${rating.toFixed(1)} 分`;
}
