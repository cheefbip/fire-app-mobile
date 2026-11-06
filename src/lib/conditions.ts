import type { SymbolViewProps } from 'expo-symbols';
import { useEffect, useState } from 'react';
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
// Grid sampling (Open-Meteo)
// ---------------------------------------------------------------------------

/**
 * Roughly how many whole hexes fit in the view. Partial hexes along the edges
 * are sampled too, so the real request is ~50–65 points (the old 7×7 grid was 49).
 */
const TARGET_CELLS = 35;
/** Open-Meteo's "current" values refresh about every 15 minutes, so polling faster is wasted quota. */
const POLL_MS = 10 * 60 * 1000;
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const AIR_QUALITY_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality';

export type GridCollection = GeoJSON.FeatureCollection<
  GeoJSON.Geometry,
  { kind: 'cell' | 'label' | 'arrow'; color: string; label: string }
>;

export const EMPTY_GRID: GridCollection = { type: 'FeatureCollection', features: [] };

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

type Cell = {
  lon: number;
  lat: number;
  /** Closed ring of the hexagon's 6 corners, [lon, lat]. */
  ring: [number, number][];
  /** Center-to-corner distance in degrees of latitude; used to size arrows and labels. */
  radiusLat: number;
};

// Hexes are laid out in Web Mercator (the map's own projection) so they look
// regular on screen at any latitude, then converted back to lon/lat.
const DEG = Math.PI / 180;
const toMercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * DEG) / 2));
const fromMercY = (y: number) => (2 * Math.atan(Math.exp(y)) - Math.PI / 2) / DEG;
const SQRT3 = Math.sqrt(3);

/**
 * Pointy-top hex lattice anchored at mercator (0, 0). The hex size snaps to
 * steps of √2, so panning or small zooms reuse the exact same cells instead
 * of reshuffling them every time the view moves.
 */
function makeCells(bounds: Bounds): Cell[] {
  const [w, s, e, n] = clampBounds(bounds);
  const x0 = w * DEG;
  const x1 = e * DEG;
  const y0 = toMercY(s);
  const y1 = toMercY(n);

  // Hex area is (3√3 / 2)·r², so pick r to fit about TARGET_CELLS in the view.
  const area = Math.max((x1 - x0) * (y1 - y0), 1e-12);
  const idealR = Math.sqrt(area / (TARGET_CELLS * 1.5 * SQRT3));
  const r = Math.SQRT2 ** Math.round(Math.log(idealR) / Math.log(Math.SQRT2));
  const colStep = SQRT3 * r;
  const rowStep = 1.5 * r;

  const cells: Cell[] = [];
  const rowStart = Math.floor(y0 / rowStep) - 1;
  const rowEnd = Math.ceil(y1 / rowStep) + 1;
  for (let row = rowStart; row <= rowEnd; row++) {
    const cy = row * rowStep;
    const offset = Math.abs(row % 2) === 1 ? colStep / 2 : 0;
    const colStart = Math.floor((x0 - offset) / colStep) - 1;
    const colEnd = Math.ceil((x1 - offset) / colStep) + 1;
    for (let col = colStart; col <= colEnd; col++) {
      const cx = col * colStep + offset;
      // Keep hexes that overlap the view at all, so the edges are covered.
      if (cx < x0 - r || cx > x1 + r || cy < y0 - r || cy > y1 + r) continue;

      const ring: [number, number][] = [];
      for (let k = 0; k < 6; k++) {
        const angle = (Math.PI / 3) * k + Math.PI / 6; // pointy top
        ring.push([(cx + r * Math.cos(angle)) / DEG, fromMercY(cy + r * Math.sin(angle))]);
      }
      ring.push(ring[0]);

      const lat = fromMercY(cy);
      const lon = cx / DEG;
      if (lat < -85 || lat > 85 || lon < -180 || lon > 180) continue;
      cells.push({ lon, lat, ring, radiusLat: fromMercY(cy + r) - lat });
    }
  }
  return cells;
}

async function fetchOpenMeteo(baseUrl: string, cells: Cell[], params: Record<string, string>) {
  const query = new URLSearchParams({
    latitude: cells.map((c) => c.lat.toFixed(3)).join(','),
    longitude: cells.map((c) => c.lon.toFixed(3)).join(','),
    ...params,
  });
  const response = await fetch(`${baseUrl}?${query.toString()}`);
  if (!response.ok) throw new Error(`Conditions request failed (${response.status})`);
  const data = await response.json();
  if (data?.error) throw new Error(data.reason || 'Conditions request failed');
  // Multiple coordinates return a list; a single one returns an object.
  const list: any[] = Array.isArray(data) ? data : [data];
  return list.map((item) => item?.current ?? {});
}

/** Arrow pointing the way the wind is blowing (Open-Meteo gives the "from" direction). */
function windArrow(cell: Cell, fromDeg: number): GeoJSON.MultiLineString {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const bearing = toRad((fromDeg + 180) % 360);
  const len = cell.radiusLat * 0.55;
  const k = 1 / Math.cos(toRad(cell.lat)); // keep arrows from stretching east-west
  const point = (b: number, d: number, from: [number, number]): [number, number] => [
    from[0] + Math.sin(b) * d * k,
    from[1] + Math.cos(b) * d,
  ];
  const center: [number, number] = [cell.lon, cell.lat];
  const tail = point(bearing + Math.PI, len, center);
  const tip = point(bearing, len, center);
  const head = len * 0.45;
  return {
    type: 'MultiLineString',
    coordinates: [
      [tail, tip],
      [tip, point(bearing + Math.PI - 0.5, head, tip)],
      [tip, point(bearing + Math.PI + 0.5, head, tip)],
    ],
  };
}

async function loadGrid(condition: GridCondition, bounds: Bounds): Promise<GridCollection> {
  const cells = makeCells(bounds);
  let values: (number | null)[] = [];
  let directions: (number | null)[] = [];
  let format = (v: number) => String(Math.round(v));

  switch (condition.id) {
    case 'wind': {
      const rows = await fetchOpenMeteo(FORECAST_URL, cells, {
        current: 'wind_speed_10m,wind_direction_10m',
        wind_speed_unit: 'mph',
      });
      values = rows.map((r) => r.wind_speed_10m ?? null);
      directions = rows.map((r) => r.wind_direction_10m ?? null);
      format = (v) => `${Math.round(v)}`;
      break;
    }
    case 'airQuality': {
      const rows = await fetchOpenMeteo(AIR_QUALITY_URL, cells, { current: 'us_aqi' });
      values = rows.map((r) => r.us_aqi ?? null);
      break;
    }
    case 'waterVapor': {
      const rows = await fetchOpenMeteo(FORECAST_URL, cells, {
        current: 'total_column_integrated_water_vapour',
      });
      values = rows.map((r) => r.total_column_integrated_water_vapour ?? null);
      break;
    }
    case 'soilMoisture': {
      const rows = await fetchOpenMeteo(FORECAST_URL, cells, { current: 'soil_moisture_0_to_1cm' });
      values = rows.map((r) => r.soil_moisture_0_to_1cm ?? null);
      format = (v) => `${Math.round(v * 100)}%`;
      break;
    }
  }

  const features: GridCollection['features'] = [];
  cells.forEach((cell, i) => {
    const value = values[i];
    if (value == null || !Number.isFinite(value)) return;
    const color = colorFor(value, condition.stops);
    const label = format(value);

    features.push({
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [cell.ring],
      },
      properties: { kind: 'cell', color, label },
    });

    const dir = directions[i];
    if (dir != null && Number.isFinite(dir)) {
      features.push({
        type: 'Feature',
        geometry: windArrow(cell, dir),
        properties: { kind: 'arrow', color, label },
      });
    }

    // Wind labels sit just below the arrow so they don't overlap it.
    const labelLat = dir != null ? cell.lat - cell.radiusLat * 0.6 : cell.lat;
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [cell.lon, labelLat] },
      properties: { kind: 'label', color, label },
    });
  });

  return { type: 'FeatureCollection', features };
}

/**
 * Loads the hex grid for the active condition. Refetches when the view moves,
 * and polls every POLL_MS while the app is open.
 */
export function useConditionGrid(condition: Condition | null, bounds: Bounds) {
  // Each piece of state remembers which condition it belongs to. Switching
  // conditions hides the old cells and errors right away (they don't match the
  // new id), while panning keeps the cells on screen until new data arrives.
  const [grid, setGrid] = useState<{ id: ConditionId; data: GridCollection } | null>(null);
  const [loadingId, setLoadingId] = useState<ConditionId | null>(null);
  const [error, setError] = useState<{ id: ConditionId; message: string } | null>(null);
  const key = boundsKey(bounds);
  const gridCondition = condition?.kind === 'grid' ? condition : null;
  const id = gridCondition?.id ?? null;

  useEffect(() => {
    if (!gridCondition) return;

    const conditionId = gridCondition.id;
    let cancelled = false;
    let lastLoaded = 0;

    // `quiet` refreshes keep the current cells and skip the spinner.
    const load = async (quiet: boolean) => {
      if (!quiet) setLoadingId(conditionId);
      try {
        const result = await loadGrid(gridCondition, bounds);
        if (cancelled) return;
        setGrid({ id: conditionId, data: result });
        setError(null);
        lastLoaded = Date.now();
      } catch (e) {
        if (cancelled) return;
        const message = e instanceof Error ? e.message : 'Unable to load conditions';
        setError({ id: conditionId, message });
      } finally {
        if (!cancelled && !quiet) setLoadingId(null);
      }
    };

    // Short debounce so a pan doesn't fire a request per frame.
    const debounce = setTimeout(() => load(false), 500);

    // Poll while the app is in the foreground only.
    const poll = setInterval(() => {
      if (AppState.currentState === 'active') load(true);
    }, POLL_MS);

    // Coming back to the app after a while refreshes right away.
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active' && lastLoaded && Date.now() - lastLoaded >= POLL_MS) load(true);
    });

    return () => {
      cancelled = true;
      clearTimeout(debounce);
      clearInterval(poll);
      appState.remove();
    };
    // `key` stands in for `bounds` so small pans don't refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, key]);

  return {
    grid: id && grid?.id === id ? grid.data : EMPTY_GRID,
    loading: id != null && loadingId === id,
    error: id && error?.id === id ? error.message : '',
  };
}
