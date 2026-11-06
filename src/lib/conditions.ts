import type { SymbolViewProps } from 'expo-symbols';
import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { boundsKey, clampBounds, type Bounds } from '@/lib/geo';

export type ConditionId =
  | 'wind'
  | 'airQuality'
  | 'fireDanger'
  | 'waterVapor'
  | 'soilMoisture'
  | 'vegetation';

type Stop = [value: number, color: string];

type BaseCondition = {
  id: ConditionId;
  label: string;
  icon: SymbolViewProps['name'];
  source: string;
  legend: { color: string; label: string }[];
};

/**
 * "grid" conditions are sampled from Open-Meteo at a grid of points over the
 * visible map and drawn as colored cells. Free, no API key.
 */
export type GridCondition = BaseCondition & {
  kind: 'grid';
  stops: Stop[];
};

/** "raster" conditions are image tiles from a public map service. */
export type RasterCondition = BaseCondition & {
  kind: 'raster';
  tiles: string;
  opacity: number;
  maxzoom?: number;
};

export type Condition = GridCondition | RasterCondition;

const WIND_STOPS: Stop[] = [
  [0, '#a5f3fc'],
  [10, '#34d399'],
  [20, '#facc15'],
  [30, '#f97316'],
  [45, '#dc2626'],
];

// US EPA AQI category colors.
const AQI_STOPS: Stop[] = [
  [0, '#00e400'],
  [50, '#00e400'],
  [51, '#ffff00'],
  [100, '#ffff00'],
  [101, '#ff7e00'],
  [150, '#ff7e00'],
  [151, '#ff0000'],
  [200, '#ff0000'],
  [201, '#8f3f97'],
  [300, '#8f3f97'],
  [301, '#7e0023'],
];

// Total column water vapor, kg/m² (≈ mm of precipitable water).
const VAPOR_STOPS: Stop[] = [
  [0, '#fef3c7'],
  [10, '#a5f3fc'],
  [25, '#38bdf8'],
  [40, '#2563eb'],
  [60, '#4c1d95'],
];

// Volumetric soil moisture, top 1 cm, m³/m³.
const SOIL_STOPS: Stop[] = [
  [0, '#7c2d12'],
  [0.1, '#d97706'],
  [0.2, '#fde68a'],
  [0.3, '#6ee7b7'],
  [0.4, '#0ea5e9'],
  [0.5, '#1e3a8a'],
];

export const CONDITIONS: Condition[] = [
  {
    id: 'wind',
    kind: 'grid',
    label: 'Wind',
    icon: { ios: 'wind', android: 'air', web: 'air' },
    source: 'Open-Meteo, 10 m wind',
    stops: WIND_STOPS,
    legend: [
      { color: WIND_STOPS[0][1], label: 'Calm' },
      { color: WIND_STOPS[2][1], label: '20 mph' },
      { color: WIND_STOPS[4][1], label: '45+ mph' },
    ],
  },
  {
    id: 'airQuality',
    kind: 'grid',
    label: 'Air quality',
    icon: { ios: 'aqi.medium', android: 'masks', web: 'masks' },
    source: 'Open-Meteo, US AQI',
    stops: AQI_STOPS,
    legend: [
      { color: '#00e400', label: 'Good' },
      { color: '#ffff00', label: 'Moderate' },
      { color: '#ff7e00', label: 'Sensitive' },
      { color: '#ff0000', label: 'Unhealthy' },
      { color: '#8f3f97', label: 'Very' },
      { color: '#7e0023', label: 'Hazardous' },
    ],
  },
  {
    id: 'fireDanger',
    kind: 'raster',
    label: 'Fire danger',
    icon: { ios: 'exclamationmark.triangle.fill', android: 'warning', web: 'warning' },
    source: 'NOAA SPC Day 1 fire weather outlook (US only)',
    // ArcGIS MapServer export: one 256px image per tile, using the service's own colors.
    tiles:
      'https://mapservices.weather.noaa.gov/vector/rest/services/fire_weather/SPC_firewx/MapServer/export' +
      '?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&dpi=96' +
      '&format=png32&transparent=true&layers=show:1,2&f=image',
    opacity: 0.75,
    legend: [
      { color: '#ffbb77', label: 'Elevated' },
      { color: '#ff5555', label: 'Critical' },
      { color: '#ff55ff', label: 'Extreme' },
    ],
  },
  {
    id: 'waterVapor',
    kind: 'grid',
    label: 'Water vapor',
    icon: { ios: 'humidity.fill', android: 'humidity_percentage', web: 'humidity_percentage' },
    source: 'Open-Meteo, total column water vapor',
    stops: VAPOR_STOPS,
    legend: [
      { color: VAPOR_STOPS[0][1], label: 'Dry' },
      { color: VAPOR_STOPS[2][1], label: '25 mm' },
      { color: VAPOR_STOPS[4][1], label: 'Moist' },
    ],
  },
  {
    id: 'soilMoisture',
    kind: 'grid',
    label: 'Soil wetness',
    icon: { ios: 'drop.fill', android: 'water_drop', web: 'water_drop' },
    source: 'Open-Meteo, soil moisture 0–1 cm',
    stops: SOIL_STOPS,
    legend: [
      { color: SOIL_STOPS[0][1], label: 'Dry' },
      { color: SOIL_STOPS[2][1], label: '20%' },
      { color: SOIL_STOPS[5][1], label: 'Wet' },
    ],
  },
  {
    id: 'vegetation',
    kind: 'raster',
    label: 'Vegetation',
    icon: { ios: 'leaf.fill', android: 'eco', web: 'eco' },
    source: 'NASA GIBS, MODIS 8-day NDVI',
    // GIBS WMS returns the most recent available image when TIME is omitted.
    tiles:
      'https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi' +
      '?SERVICE=WMS&REQUEST=GetMap&VERSION=1.1.1&LAYERS=MODIS_Terra_NDVI_8Day&STYLES=' +
      '&SRS=EPSG:3857&BBOX={bbox-epsg-3857}&WIDTH=256&HEIGHT=256&FORMAT=image/png&TRANSPARENT=true',
    opacity: 0.65,
    maxzoom: 9,
    legend: [
      { color: '#c8a26b', label: 'Bare' },
      { color: '#a3c26b', label: 'Sparse' },
      { color: '#1e6b1e', label: 'Dense' },
    ],
  },
];

export function getCondition(id: ConditionId | null) {
  return CONDITIONS.find((c) => c.id === id) ?? null;
}

// ---------------------------------------------------------------------------
// Grid sampling (Open-Meteo) and hex display
// ---------------------------------------------------------------------------
//
// There are two separate grids:
//
// - Samples: the points actually fetched from Open-Meteo. They sit on a square
//   grid in Web Mercator whose spacing halves at every whole zoom level, so
//   each level's points are also points of the next level. Zooming in reuses
//   everything already fetched, and zooming out over an area you've already
//   seen needs no requests at all.
//
// - Hexes: what's drawn. A honeycomb fixed to the screen (the map is always
//   north-up and flat, so screen points map straight onto the map). As the
//   map moves underneath, each hex is re-shaded from the cached samples
//   without waiting on the network. Colors blend the nearest samples; numbers
//   and wind arrows show the single nearest sample, never interpolated, and
//   update once closer samples arrive. Drawing lives in components/map/hex-overlay.

/** On-screen width of a hex, in points (MapLibre's logical pixels). */
export const HEX_WIDTH_PX = 48;
/** Sample spacing at a whole zoom level. Between levels it's ~90–180 px. */
const SAMPLE_SPACING_PX = 128;
/** ~10 km spacing. Open-Meteo's models aren't finer than that, so stop here. */
const MAX_SAMPLE_LEVEL = 10;
/** Open-Meteo's "current" values refresh about every 15 minutes, so polling faster is wasted quota. */
const POLL_MS = 10 * 60 * 1000;
/** How often to check for stale samples. Only stale or missing points are requested. */
const CHECK_MS = 60 * 1000;
const MAX_POINTS_PER_REQUEST = 100;
const MAX_CACHED_SAMPLES = 4000;
/** How many nearby samples blend into a hex's color. */
const BLEND_NEIGHBORS = 4;
/** A sample can color hexes up to this many sample spacings away (at the level it was used at). */
const SAMPLE_REACH = 1;

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const AIR_QUALITY_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality';

function hexToRgb(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function colorFor(value: number, stops: Stop[]) {
  if (value <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    const [v1, c1] = stops[i];
    if (value <= v1) {
      const [v0, c0] = stops[i - 1];
      const t = v1 === v0 ? 1 : (value - v0) / (v1 - v0);
      const a = hexToRgb(c0);
      const b = hexToRgb(c1);
      const mix = a.map((x, k) => Math.round(x + (b[k] - x) * t));
      return `rgb(${mix[0]},${mix[1]},${mix[2]})`;
    }
  }
  return stops[stops.length - 1][1];
}

function formatValue(id: ConditionId, value: number) {
  return id === 'soilMoisture' ? `${Math.round(value * 100)}%` : String(Math.round(value));
}

// --- Projection -------------------------------------------------------------
// Everything is laid out in Web Mercator (the map's own projection, in
// radians) so spacing is even on screen at any latitude.

const DEG = Math.PI / 180;
const SQRT3 = Math.sqrt(3);
const toMercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * DEG) / 2));
const fromMercY = (y: number) => (2 * Math.atan(Math.exp(y)) - Math.PI / 2) / DEG;
const MAX_MERC_Y = toMercY(85);

/** MapLibre draws the whole world 512 points wide at zoom 0, doubling each level. */
const radiansPerPx = (zoom: number) => (2 * Math.PI) / (512 * 2 ** zoom);
const sampleStep = (level: number) => SAMPLE_SPACING_PX * radiansPerPx(level);

function sampleLevel(zoom: number) {
  return Math.min(MAX_SAMPLE_LEVEL, Math.max(0, Math.round(zoom)));
}

function viewRect(bounds: Bounds) {
  const [w, s, e, n] = clampBounds(bounds);
  return { x0: w * DEG, x1: e * DEG, y0: toMercY(s), y1: toMercY(n) };
}

// --- Samples ----------------------------------------------------------------

type SamplePoint = { key: string; x: number; y: number; lon: number; lat: number };

type Reading = { value: number | null; direction: number | null };

type Sample = SamplePoint &
  Reading & {
    /** Coarsest zoom level this point has been used at; sets how far it reaches. */
    level: number;
    fetchedAt: number;
  };

export type SampleCache = ReadonlyMap<string, Sample>;

/**
 * Sample points covering the view at `level`, plus one ring outside it so
 * hexes at the edges have neighbors to blend with. A point shared by several
 * levels always gets the same key, so it's only fetched once.
 */
function samplePoints(bounds: Bounds, level: number): SamplePoint[] {
  const { x0, x1, y0, y1 } = viewRect(bounds);
  const step = sampleStep(level);
  const points: SamplePoint[] = [];
  for (let j = Math.floor(y0 / step) - 1; j <= Math.ceil(y1 / step) + 1; j++) {
    const y = j * step;
    if (Math.abs(y) > MAX_MERC_Y) continue;
    for (let i = Math.floor(x0 / step) - 1; i <= Math.ceil(x1 / step) + 1; i++) {
      const x = i * step;
      if (Math.abs(x) > Math.PI + 1e-9) continue;
      let [l, a, b] = [level, i, j];
      while (l > 0 && a % 2 === 0 && b % 2 === 0) {
        l--;
        a /= 2;
        b /= 2;
      }
      points.push({ key: `${l}/${a}/${b}`, x, y, lon: x / DEG, lat: fromMercY(y) });
    }
  }
  return points;
}

async function fetchOpenMeteo(baseUrl: string, points: SamplePoint[], params: Record<string, string>) {
  const query = new URLSearchParams({
    latitude: points.map((p) => p.lat.toFixed(3)).join(','),
    longitude: points.map((p) => p.lon.toFixed(3)).join(','),
    ...params,
  });
  const response = await fetch(`${baseUrl}?${query.toString()}`);
  if (!response.ok) throw new Error(`Conditions request failed (${response.status})`);
  const data = await response.json();
  if (data?.error) throw new Error(data.reason || 'Conditions request failed');
  // Multiple coordinates return a list; a single one returns an object.
  const list: any[] = Array.isArray(data) ? data : [data];
  return points.map((_, i) => list[i]?.current ?? {});
}

const finite = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

async function fetchChunk(condition: GridCondition, points: SamplePoint[]): Promise<Reading[]> {
  const none = (value: unknown): Reading => ({ value: finite(value), direction: null });
  switch (condition.id) {
    case 'wind': {
      const rows = await fetchOpenMeteo(FORECAST_URL, points, {
        current: 'wind_speed_10m,wind_direction_10m',
        wind_speed_unit: 'mph',
      });
      return rows.map((r) => ({
        value: finite(r.wind_speed_10m),
        direction: finite(r.wind_direction_10m),
      }));
    }
    case 'airQuality': {
      const rows = await fetchOpenMeteo(AIR_QUALITY_URL, points, { current: 'us_aqi' });
      return rows.map((r) => none(r.us_aqi));
    }
    case 'waterVapor': {
      const rows = await fetchOpenMeteo(FORECAST_URL, points, {
        current: 'total_column_integrated_water_vapour',
      });
      return rows.map((r) => none(r.total_column_integrated_water_vapour));
    }
    case 'soilMoisture': {
      const rows = await fetchOpenMeteo(FORECAST_URL, points, { current: 'soil_moisture_0_to_1cm' });
      return rows.map((r) => none(r.soil_moisture_0_to_1cm));
    }
    default:
      return points.map(() => none(null));
  }
}

async function fetchReadings(condition: GridCondition, points: SamplePoint[]) {
  const chunks: SamplePoint[][] = [];
  for (let k = 0; k < points.length; k += MAX_POINTS_PER_REQUEST) {
    chunks.push(points.slice(k, k + MAX_POINTS_PER_REQUEST));
  }
  const results = await Promise.all(chunks.map((chunk) => fetchChunk(condition, chunk)));
  return results.flat();
}

function mergeReadings(
  cache: SampleCache | undefined,
  points: SamplePoint[],
  readings: Reading[],
  level: number
): SampleCache {
  const next = new Map(cache);
  const now = Date.now();
  points.forEach((point, i) => {
    const old = next.get(point.key);
    next.set(point.key, {
      ...point,
      value: readings[i]?.value ?? null,
      direction: readings[i]?.direction ?? null,
      level: Math.min(level, old?.level ?? level),
      fetchedAt: now,
    });
  });

  // Drop the oldest samples once the cache gets big.
  if (next.size > MAX_CACHED_SAMPLES) {
    const oldest = [...next.values()].sort((a, b) => a.fetchedAt - b.fetchedAt);
    const drop = next.size - Math.floor(MAX_CACHED_SAMPLES * 0.8);
    for (const sample of oldest.slice(0, drop)) next.delete(sample.key);
  }
  return next;
}

/** Marks cached points as used at a coarser level, so they reach farther. No request needed. */
function claimLevel(cache: SampleCache, keys: string[], level: number): SampleCache {
  const next = new Map(cache);
  for (const key of keys) {
    const sample = next.get(key);
    if (sample && sample.level > level) next.set(key, { ...sample, level });
  }
  return next;
}

// --- Hexes ------------------------------------------------------------------

/** Where the map is looking. North is always up (rotate and tilt are off). */
export type MapView = { center: [number, number]; zoom: number };

/** Center of one hex in the fixed on-screen honeycomb, in screen points. */
export type ScreenHex = { cx: number; cy: number };

export type HexShade = {
  /** Blended from the nearest samples. */
  color: string;
  /** The single nearest sample's value. Never interpolated. */
  label: string;
  /** The nearest sample's wind direction ("from", degrees), if it has one. */
  direction: number | null;
};

/**
 * Pointy-top honeycomb covering a width × height screen. It depends only on
 * the screen size, so the hexes never move; only their contents change.
 */
export function screenHexes(width: number, height: number): ScreenHex[] {
  const r = HEX_WIDTH_PX / SQRT3;
  const rowStep = 1.5 * r;
  const hexes: ScreenHex[] = [];
  if (width <= 0 || height <= 0) return hexes;
  for (let row = 0; row * rowStep <= height + r; row++) {
    const offset = row % 2 === 1 ? HEX_WIDTH_PX / 2 : 0;
    for (let col = 0; col * HEX_WIDTH_PX + offset <= width + HEX_WIDTH_PX / 2; col++) {
      hexes.push({ cx: col * HEX_WIDTH_PX + offset, cy: row * rowStep });
    }
  }
  return hexes;
}

type Neighbor = { sample: Sample; d2: number; reach2: number };

/**
 * What each on-screen hex shows for the current map view: a color blended
 * from the nearest cached samples (inverse-distance weighted), plus the
 * single nearest sample's number and wind direction. A hex with no sample in
 * reach gets null and is drawn empty until data for it arrives.
 */
export function shadeHexes(
  condition: GridCondition,
  cache: SampleCache | undefined,
  view: MapView,
  width: number,
  height: number,
  hexes: ScreenHex[]
): (HexShade | null)[] {
  if (!cache?.size || width <= 0 || height <= 0) return hexes.map(() => null);

  // Screen point -> mercator. Linear because the map never rotates or tilts.
  const rpp = radiansPerPx(view.zoom);
  const mx = view.center[0] * DEG;
  const my = toMercY(view.center[1]);
  const toX = (px: number) => mx + (px - width / 2) * rpp;
  const toY = (py: number) => my - (py - height / 2) * rpp;
  const x0 = toX(0);
  const x1 = toX(width);
  const y0 = toY(height);
  const y1 = toY(0);

  // Only samples that can reach the screen take part.
  const nearby: { sample: Sample; reach2: number }[] = [];
  for (const sample of cache.values()) {
    if (sample.value == null) continue;
    const reach = sampleStep(sample.level) * SAMPLE_REACH;
    if (sample.x < x0 - reach || sample.x > x1 + reach) continue;
    if (sample.y < y0 - reach || sample.y > y1 + reach) continue;
    nearby.push({ sample, reach2: reach * reach });
  }
  if (!nearby.length) return hexes.map(() => null);

  return hexes.map((hex) => {
    const x = toX(hex.cx);
    const y = toY(hex.cy);
    if (Math.abs(x) > Math.PI || Math.abs(y) > MAX_MERC_Y) return null;

    // The few nearest samples, closest first.
    const best: Neighbor[] = [];
    for (const { sample, reach2 } of nearby) {
      const dx = sample.x - x;
      const dy = sample.y - y;
      const d2 = dx * dx + dy * dy;
      if (best.length === BLEND_NEIGHBORS && d2 >= best[best.length - 1].d2) continue;
      let at = best.length;
      while (at > 0 && best[at - 1].d2 > d2) at--;
      best.splice(at, 0, { sample, d2, reach2 });
      if (best.length > BLEND_NEIGHBORS) best.pop();
    }
    if (!best.some((n) => n.d2 <= n.reach2)) return null;

    // Blend for color; nearest for the number and arrow.
    const nearest = best[0].sample;
    let blended = nearest.value!;
    if (best[0].d2 > 1e-18) {
      let sum = 0;
      let weights = 0;
      for (const n of best) {
        const w = 1 / n.d2;
        sum += n.sample.value! * w;
        weights += w;
      }
      blended = sum / weights;
    }

    return {
      color: colorFor(blended, condition.stops),
      label: formatValue(condition.id, nearest.value!),
      direction: nearest.direction,
    };
  });
}

// --- Hook -------------------------------------------------------------------

/**
 * Cached samples for the active condition, for the hex overlay to shade from.
 * Missing samples for the view are fetched after a short pause once the map
 * settles, and stale ones (older than POLL_MS) are refreshed while the app is
 * open. Samples are kept per condition, so switching back is instant.
 */
export function useConditionSamples(condition: Condition | null, bounds: Bounds, zoom: number) {
  const [caches, setCaches] = useState<Partial<Record<ConditionId, SampleCache>>>({});
  const [pending, setPending] = useState<Partial<Record<ConditionId, number>>>({});
  const [error, setError] = useState<{ id: ConditionId; message: string } | null>(null);
  const inFlight = useRef(new Set<string>());

  const gridCondition = condition?.kind === 'grid' ? condition : null;
  const id = gridCondition?.id ?? null;
  const level = sampleLevel(zoom);
  const key = boundsKey(bounds);

  // Timers and listeners outlive the render that set them up, so they read
  // the latest view and cache from here.
  const latest = useRef({ bounds, caches });
  useEffect(() => {
    latest.current = { bounds, caches };
  });

  useEffect(() => {
    if (!gridCondition) return;
    const conditionId = gridCondition.id;

    const sync = async () => {
      const cache = latest.current.caches[conditionId];
      const now = Date.now();
      const claim: string[] = [];
      const missing: SamplePoint[] = [];
      const stale: SamplePoint[] = [];

      for (const point of samplePoints(latest.current.bounds, level)) {
        if (inFlight.current.has(`${conditionId}|${point.key}`)) continue;
        const sample = cache?.get(point.key);
        if (!sample) {
          missing.push(point);
          continue;
        }
        if (now - sample.fetchedAt >= POLL_MS) stale.push(point);
        if (sample.level > level) claim.push(point.key);
      }

      if (claim.length) {
        setCaches((prev) => {
          const current = prev[conditionId];
          return current ? { ...prev, [conditionId]: claimLevel(current, claim, level) } : prev;
        });
      }

      const toFetch = [...missing, ...stale];
      if (!toFetch.length) return;
      const flightKeys = toFetch.map((p) => `${conditionId}|${p.key}`);
      flightKeys.forEach((k) => inFlight.current.add(k));

      // The spinner is for new areas only; background refreshes stay quiet.
      const showSpinner = missing.length > 0;
      const bump = (by: number) =>
        setPending((prev) => ({ ...prev, [conditionId]: (prev[conditionId] ?? 0) + by }));
      if (showSpinner) bump(1);

      try {
        const readings = await fetchReadings(gridCondition, toFetch);
        setCaches((prev) => ({
          ...prev,
          [conditionId]: mergeReadings(prev[conditionId], toFetch, readings, level),
        }));
        setError((prev) => (prev?.id === conditionId ? null : prev));
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Unable to load conditions';
        setError({ id: conditionId, message });
      } finally {
        flightKeys.forEach((k) => inFlight.current.delete(k));
        if (showSpinner) bump(-1);
      }
    };

    // Short pause so a burst of pans sends one request.
    const debounce = setTimeout(sync, 400);
    const check = setInterval(() => {
      if (AppState.currentState === 'active') sync();
    }, CHECK_MS);
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') sync();
    });

    return () => {
      clearTimeout(debounce);
      clearInterval(check);
      appState.remove();
    };
    // `key` stands in for `bounds` so tiny pans don't refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, key, level]);

  return {
    samples: id ? caches[id] : undefined,
    loading: id != null && (pending[id] ?? 0) > 0,
    error: id && error?.id === id ? error.message : '',
  };
}
