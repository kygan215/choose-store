/** Keep the published phone text, including area codes and extensions. */
export function normalizeAmapTel(value: unknown): string | null {
  const values = Array.isArray(value) ? value : [value];
  const phones = values.flatMap(item => typeof item === "string" ? item.split(/[;；\n]+/) : [])
    .map(item => item.trim()).filter(item => /\d{3}/.test(item));
  return [...new Set(phones)].join("；") || null;
}

export function amapTel(poi: unknown): string | null {
  if (!poi || typeof poi !== "object") return null;
  const row = poi as { business?: { tel?: unknown }; tel?: unknown };
  return normalizeAmapTel(row.business?.tel) ?? normalizeAmapTel(row.tel);
}

export function matchedAmapTel(poiId: unknown, candidates: unknown): string | null {
  if (!poiId || !Array.isArray(candidates)) return null;
  return amapTel(candidates.find(item => item && String(item.id) === String(poiId)));
}

/** Official POI marker URI: generated local IDs must never link to another place. */
export function amapPlaceUrl(poiId: unknown): string | null {
  if (typeof poiId !== "string" || !/^B[A-Z0-9]{8,31}$/i.test(poiId)) return null;
  const params = new URLSearchParams({ poiid: poiId, src: "dianjie-poi", callnative: "1" });
  return `https://uri.amap.com/marker?${params}`;
}
