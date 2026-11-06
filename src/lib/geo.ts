/** [west, south, east, north], same order MapLibre uses. */
export type Bounds = [number, number, number, number];

/** Rough California view, used until the map reports its real bounds. */
export const DEFAULT_BOUNDS: Bounds = [-125, 32, -113, 43];

export function clampBounds([w, s, e, n]: Bounds): Bounds {
  return [Math.max(-180, w), Math.max(-85, s), Math.min(180, e), Math.min(85, n)];
}

export function boundsCenter([w, s, e, n]: Bounds): [number, number] {
  return [(w + e) / 2, (s + n) / 2];
}

/** Great-circle distance in nautical miles. */
export function distanceNm(a: [number, number], b: [number, number]) {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * 3440.065 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Rounds bounds so tiny pans don't trigger a refetch. Coarser rounding when
 * zoomed out.
 */
export function boundsKey(bounds: Bounds) {
  const [w, s, e, n] = bounds;
  const span = Math.max(e - w, n - s);
  const step = span > 20 ? 2 : span > 5 ? 0.5 : span > 1 ? 0.1 : 0.02;
  return bounds.map((v) => Math.round(v / step) * step).join(',');
}
