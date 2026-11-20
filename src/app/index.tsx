import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import bbox from "@turf/bbox";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import { Camera, GeoJSONSource, Images, Layer, Map, RasterSource, type CameraRef } from "@maplibre/maplibre-react-native";
import { useFocusEffect } from "expo-router";
import { SymbolView, type SymbolViewProps } from "expo-symbols";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, AppState, FlatList, Modal, TextInput, useWindowDimensions, Linking, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { HexLayer, type HexStatus } from "@/components/map/hex-overlay";
import { MapHelper } from "@/components/map/map-helper";
import { MapLegend } from "@/components/map/map-legend";
import { BottomTabInset } from "@/constants/theme";
import { useMapLocation } from "@/hooks/use-map-location";
import { useMapTheme } from "@/hooks/use-map-theme";
import { useAircraft } from "@/lib/aircraft";
import { getCondition, type ConditionId, type MapView } from "@/lib/conditions";
import { DEFAULT_BOUNDS, type Bounds } from "@/lib/geo";
import { createMapViewStore } from "@/lib/map-view-store";
const INITIAL_VIEW: MapView = {
  center: [-98.5795, 39.8283],
  zoom: 3
};
const FIRMS_MAP_KEY = process.env.EXPO_PUBLIC_FIRMS_MAP_KEY;
const MAX_HOTSPOT_HOURS = 168;
const HOTSPOT_DETAIL_ZOOM = 10;
const TIME_WINDOWS = [{
  hours: 24,
  label: "24 hours"
}, {
  hours: 72,
  label: "3 days"
}, {
  hours: 168,
  label: "7 days"
}];
const ACTIVE_PERIMETER_WHERE = "attr_IncidentTypeCategory = 'WF' " + "AND attr_ActiveFireCandidate = 1 " + "AND attr_FireOutDateTime IS NULL";
const FIRMS_SOURCES = ["VIIRS_NOAA20_NRT", "VIIRS_NOAA21_NRT", "VIIRS_SNPP_NRT"];
const FIRMS_AREAS = ["-125,24,-66,50", "-180,51,-129,72", "172,50,180,55", "-161,18,-154,23"];
const PERIMETER_ENDPOINT = "https://services3.arcgis.com/T4QMspbfLg3qTGWY/ArcGIS/rest/services/WFIGS_Interagency_Perimeters_Current/FeatureServer/0/query";
type Hotspot = {
  type: "Feature";
  id?: number;
  geometry: {
    type: "Point";
    coordinates: [number, number];
  };
  properties: {
    id: number;
    perimeterKeys?: string[];
    detected: number | null;
    satellite: string;
    confidence: string;
    frp: number | null;
    brightness: number | null;
    daynight: string;
  };
};
type FireCollection = {
  type: "FeatureCollection";
  features: Hotspot[];
};
type FirePerimeter = {
  type: "Feature";
  id?: number | string;
  geometry: {
    type: "Polygon";
    coordinates: number[][][];
  } | {
    type: "MultiPolygon";
    coordinates: number[][][][];
  };
  properties: Record<string, unknown>;
};
type PerimeterCollection = {
  type: "FeatureCollection";
  features: FirePerimeter[];
};
const EMPTY_PERIMETERS: PerimeterCollection = {
  type: "FeatureCollection",
  features: []
};
const EMPTY_DATA: FireCollection = {
  type: "FeatureCollection",
  features: []
};
async function fetchFirms(hours: number, now = Date.now()): Promise<FireCollection> {
  if (!FIRMS_MAP_KEY) {
    throw new Error("Missing EXPO_PUBLIC_FIRMS_MAP_KEY in .env");
  }
  const cutoff = now - hours * 60 * 60 * 1000;
  const dayMs = 24 * 60 * 60 * 1000;
  const firstDay = Math.floor(cutoff / dayMs) * dayMs;
  const today = Math.floor(now / dayMs) * dayMs;
  const requests: Promise<string>[] = [];
  for (const source of FIRMS_SOURCES) {
    for (const area of FIRMS_AREAS) {
      for (let start = firstDay; start <= today; start += 5 * dayMs) {
        const days = Math.min(5, Math.floor((today - start) / dayMs) + 1);
        const date = new Date(start).toISOString().slice(0, 10);
        const url = "https://firms.modaps.eosdis.nasa.gov/api/area/csv/" + `${encodeURIComponent(FIRMS_MAP_KEY)}/` + `${source}/${area}/${days}/${date}`;
        requests.push((async () => {
          const response = await fetch(url);
          if (!response.ok) {
            throw new Error(`NASA ${source} request failed (${response.status})`);
          }
          return response.text();
        })());
      }
    }
  }
  const csvFiles = await Promise.all(requests);
  const features: {
    geometry: {
      x: number;
      y: number;
    };
    attributes: {
      OBJECTID: number;
      acq_time: number;
      satellite: string;
      confidence: string;
      frp: number | null;
      bright_ti4: number | null;
      daynight: string;
    };
  }[] = [];
  const seen = new Set<string>();
  const optionalNumber = (value: string | undefined) => {
    if (value == null || value.trim() === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  };
  for (const csv of csvFiles) {
    const lines = csv.replace(/^\uFEFF/, "").trim().split(/\r?\n/);
    const headers = lines[0].split(",").map(value => value.trim());
    const required = ["latitude", "longitude", "acq_date", "acq_time", "satellite", "confidence"];
    if (!required.every(name => headers.includes(name))) {
      throw new Error("Unexpected NASA response. Check your API key " + "and FIRMS data availability.");
    }
    for (const line of lines.slice(1)) {
      if (!line.trim()) continue;
      const values = line.split(",");
      const row: Record<string, string> = {};
      headers.forEach((header, index) => {
        row[header] = values[index]?.trim() ?? "";
      });
      const longitude = optionalNumber(row.longitude);
      const latitude = optionalNumber(row.latitude);
      const time = row.acq_time.padStart(4, "0");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(row.acq_date) || !/^\d{4}$/.test(time)) {
        continue;
      }
      const detected = Date.parse(`${row.acq_date}T${time.slice(0, 2)}:` + `${time.slice(2, 4)}:00Z`);
      if (longitude == null || latitude == null || Math.abs(longitude) > 180 || Math.abs(latitude) > 90 || !Number.isFinite(detected) || detected < cutoff || detected > now) {
        continue;
      }
      const key = `${row.satellite}|${detected}|${longitude}|${latitude}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const confidence = row.confidence.toLowerCase();
      features.push({
        geometry: {
          x: longitude,
          y: latitude
        },
        attributes: {
          OBJECTID: features.length + 1,
          acq_time: detected,
          satellite: row.satellite || "Not reported",
          confidence: confidence === "l" ? "Low" : confidence === "n" ? "Nominal" : confidence === "h" ? "High" : row.confidence || "Not reported",
          frp: optionalNumber(row.frp),
          bright_ti4: optionalNumber(row.bright_ti4),
          daynight: row.daynight
        }
      });
    }
  }
  features.sort((a, b) => b.attributes.acq_time - a.attributes.acq_time);
  return toGeoJSON({
    features
  });
}
function toGeoJSON(data: any): FireCollection {
  if (data.error) {
    throw new Error(data.error.message || "ArcGIS query failed");
  }
  if (!Array.isArray(data.features)) {
    throw new Error("Unexpected response from ArcGIS");
  }
  const features: Hotspot[] = [];
  for (const feature of data.features) {
    const x = feature.geometry?.x;
    const y = feature.geometry?.y;
    const a = feature.attributes;
    if (!a || !Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 180 || Math.abs(y) > 90) {
      continue;
    }
    features.push({
      type: "Feature",
      id: a.OBJECTID,
      geometry: {
        type: "Point",
        coordinates: [x, y]
      },
      properties: {
        id: a.OBJECTID,
        detected: Number.isFinite(a.acq_time) ? a.acq_time : null,
        satellite: String(a.satellite ?? "Not reported"),
        confidence: String(a.confidence ?? "Not reported"),
        frp: Number.isFinite(a.frp) ? a.frp : null,
        brightness: Number.isFinite(a.bright_ti4) ? a.bright_ti4 : null,
        daynight: a.daynight === "D" ? "Day" : a.daynight === "N" ? "Night" : "Not reported"
      }
    });
  }
  return {
    type: "FeatureCollection",
    features
  };
}
function formatTime(value: number | null) {
  if (value == null) return "Not reported";
  return new Date(value).toISOString().replace("T", " ").slice(0, 19) + " UTC";
}
async function fetchPerimeters(): Promise<PerimeterCollection> {
  const features: FirePerimeter[] = [];
  const pageSize = 1000;
  let offset = 0;
  while (true) {
    const params = new URLSearchParams({
      f: "geojson",
      where: ACTIVE_PERIMETER_WHERE,
      outFields: ["OBJECTID", "poly_IncidentName", "poly_IRWINID", "poly_PolygonDateTime", "attr_IncidentTypeCategory", "attr_ActiveFireCandidate", "attr_FireDiscoveryDateTime", "attr_PercentContained", "attr_ContainmentDateTime", "attr_ControlDateTime", "attr_FireOutDateTime", "attr_ModifiedOnDateTime_dt"].join(","),
      returnGeometry: "true",
      outSR: "4326",
      orderByFields: "OBJECTID ASC",
      resultOffset: String(offset),
      resultRecordCount: String(pageSize)
    });
    const response = await fetch(`${PERIMETER_ENDPOINT}?${params.toString()}`);
    if (!response.ok) {
      throw new Error(`Perimeter request failed (${response.status})`);
    }
    const data = await response.json();
    if (data.error) {
      throw new Error(data.error.message || "Unable to load perimeters");
    }
    if (data.type !== "FeatureCollection" || !Array.isArray(data.features)) {
      throw new Error("Unexpected perimeter response");
    }
    for (const feature of data.features) {
      if (feature.geometry?.type === "Polygon" || feature.geometry?.type === "MultiPolygon") {
        features.push(feature);
      }
    }
    const count = data.features.length;
    if (count === 0) break;
    offset += count;
    const more = data.exceededTransferLimit === true || data.properties?.exceededTransferLimit === true;
    if (count < pageSize && !more) break;
  }
  return {
    type: "FeatureCollection",
    features
  };
}
async function filterHotspotsToPerimeters(hotspots: FireCollection, perimeters: PerimeterCollection): Promise<FireCollection> {
  const indexed = perimeters.features.map(perimeter => ({
    perimeter,
    bounds: bbox(perimeter)
  }));
  const features: Hotspot[] = [];
  for (let i = 0; i < hotspots.features.length; i++) {
    if (i > 0 && i % 250 === 0) {
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
    const hotspot = hotspots.features[i];
    const [longitude, latitude] = hotspot.geometry.coordinates;
    const matchingKeys: string[] = [];
    for (const {
      perimeter,
      bounds
    } of indexed) {
      const [west, south, east, north] = bounds;
      if (longitude < west || longitude > east || latitude < south || latitude > north) {
        continue;
      }
      if (booleanPointInPolygon(hotspot, perimeter)) {
        matchingKeys.push(perimeterKey(perimeter));
      }
    }
    if (matchingKeys.length > 0) {
      features.push({
        ...hotspot,
        properties: {
          ...hotspot.properties,
          perimeterKeys: [...new Set(matchingKeys)]
        }
      });
    }
  }
  return {
    type: "FeatureCollection",
    features
  };
}
function filterHotspotsByTime(hotspots: FireCollection, hours: number, now: number): FireCollection {
  const cutoff = now - hours * 60 * 60 * 1000;
  return {
    type: "FeatureCollection",
    features: hotspots.features.filter(({
      properties
    }) => {
      const detected = properties.detected;
      return detected != null && detected >= cutoff && detected <= now;
    })
  };
}
function readableObservation(value: number | null) {
  if (value == null || !Number.isFinite(value)) {
    return "Not reported";
  }
  const date = new Date(value);
  const formatted = date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short"
  });
  const minutes = Math.floor((Date.now() - value) / 60000);
  if (minutes < 0) return formatted;
  const age = minutes < 1 ? "less than a minute ago" : minutes < 60 ? `${minutes} minutes ago` : minutes < 1440 ? `${Math.floor(minutes / 60)} hours ago` : `${Math.floor(minutes / 1440)} days ago`;
  return `${formatted} (${age})`;
}
function readableSatellite(value: string) {
  const names: Record<string, string> = {
    N: "Suomi NPP",
    SNPP: "Suomi NPP",
    N20: "NOAA-20",
    "1": "NOAA-20",
    N21: "NOAA-21",
    "2": "NOAA-21"
  };
  return names[value.trim().toUpperCase()] ?? value;
}
function perimeterTimestamp(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const timestamp = /^\d+$/.test(value.trim()) ? Number(value) : Date.parse(value);
    return Number.isFinite(timestamp) ? timestamp : null;
  }
  return null;
}
function readableContainment(value: unknown): string {
  if (value == null || typeof value !== "number" && typeof value !== "string" || String(value).trim() === "") {
    return "Not reported";
  }
  const percent = Number(value);
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
    return "Not reported";
  }
  return `${percent}% contained`;
}
type PerimeterLocatorCollection = {
  type: "FeatureCollection";
  features: {
    type: "Feature";
    geometry: {
      type: "Point";
      coordinates: [number, number];
    };
    properties: {
      perimeterKey: string;
      hotspotCount: number;
    };
  }[];
};
function perimeterKey(perimeter: FirePerimeter): string {
  return String(perimeter.properties.OBJECTID ?? perimeter.id ?? perimeter.properties.poly_IRWINID ?? "");
}
function perimeterName(perimeter: FirePerimeter): string {
  return String(perimeter.properties.poly_IncidentName || "Unnamed wildfire");
}
function hotspotCountLabel(count: number): string {
  return `${count.toLocaleString()} ${count === 1 ? "hotspot" : "hotspots"}`;
}
function countHotspotsByPerimeter(hotspots: FireCollection): globalThis.Map<string, number> {
  const counts = new globalThis.Map<string, number>();
  for (const hotspot of hotspots.features) {
    for (const key of new Set(hotspot.properties.perimeterKeys ?? [])) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return counts;
}
function perimeterHotspotCount(perimeter: FirePerimeter): number {
  const value = perimeter.properties.appHotspotCount;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}
function withHotspotCounts(perimeters: PerimeterCollection, counts: globalThis.Map<string, number>): PerimeterCollection {
  return {
    type: "FeatureCollection",
    features: perimeters.features.map(perimeter => ({
      ...perimeter,
      properties: {
        ...perimeter.properties,
        appHotspotCount: counts.get(perimeterKey(perimeter)) ?? 0
      }
    }))
  };
}
function findPerimeters(perimeters: PerimeterCollection, query: string): FirePerimeter[] {
  const search = query.trim().toLowerCase();
  return perimeters.features.filter(perimeter => perimeterName(perimeter).toLowerCase().includes(search)).slice().sort((a, b) => perimeterHotspotCount(b) - perimeterHotspotCount(a) || perimeterName(a).localeCompare(perimeterName(b)) || perimeterKey(a).localeCompare(perimeterKey(b)));
}
function buildPerimeterLocators(perimeters: PerimeterCollection): PerimeterLocatorCollection {
  const features: PerimeterLocatorCollection["features"] = [];
  for (const perimeter of perimeters.features) {
    const coordinate = perimeter.geometry.type === "Polygon" ? perimeter.geometry.coordinates[0]?.[0] : perimeter.geometry.coordinates[0]?.[0]?.[0];
    const key = perimeterKey(perimeter);
    if (!coordinate || !key || !Number.isFinite(coordinate[0]) || !Number.isFinite(coordinate[1])) continue;
    features.push({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [coordinate[0], coordinate[1]]
      },
      properties: {
        perimeterKey: key,
        hotspotCount: perimeterHotspotCount(perimeter)
      }
    });
  }
  return {
    type: "FeatureCollection",
    features
  };
}
function perimeterFocusBounds(perimeter: FirePerimeter): [number, number, number, number] | null {
  const [west, south, east, north] = bbox(perimeter);
  if (![west, south, east, north].every(Number.isFinite)) return null;
  const longitudePadding = Math.max((0.01 - (east - west)) / 2, 0);
  const latitudePadding = Math.max((0.01 - (north - south)) / 2, 0);
  return [Math.max(-180, west - longitudePadding), Math.max(-85, south - latitudePadding), Math.min(180, east + longitudePadding), Math.min(85, north + latitudePadding)];
}
const FOLLOW_STORAGE_KEY = "ignis.followed-fires.v1";
const FOLLOW_CHANNEL_ID = "followed-fire-updates-v2";
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false
  })
});
type FollowObservation = {
  containment: number | null;
  recordAt: number | null;
  boundaryAt: number | null;
  outAt: number | null;
  seenHotspots: Record<string, number>;
};
type FollowedFire = {
  id: string;
  name: string;
  followedAt: number;
  checkedAt: number;
  baseline: FollowObservation;
};
type FireSnapshot = {
  hotspots: FireCollection;
  perimeters: PerimeterCollection;
  asOf: number;
};
function notificationFireId(perimeter: FirePerimeter): string {
  const id = perimeter.properties.poly_IRWINID;
  return typeof id === "string" ? id.replace(/[{}]/g, "").trim().toLowerCase() : "";
}
function containmentNumber(value: unknown): number | null {
  if (value == null || String(value).trim() === "") return null;
  const number = typeof value === "number" || typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(number) && number >= 0 && number <= 100 ? number : null;
}
function observeFollowedFire(id: string, snapshot: FireSnapshot): FollowObservation | null {
  const boundaries = snapshot.perimeters.features.filter(fire => notificationFireId(fire) === id);
  if (boundaries.length === 0) return null;
  boundaries.sort((a, b) => (perimeterTimestamp(b.properties.attr_ModifiedOnDateTime_dt) ?? 0) - (perimeterTimestamp(a.properties.attr_ModifiedOnDateTime_dt) ?? 0));
  const properties = boundaries[0].properties;
  const keys = new Set(boundaries.map(perimeterKey));
  const seenHotspots: Record<string, number> = {};
  for (const hotspot of snapshot.hotspots.features) {
    const detected = hotspot.properties.detected;
    if (detected == null || !Number.isFinite(detected) || !hotspot.properties.perimeterKeys?.some(key => keys.has(key))) continue;
    const key = `${hotspot.properties.satellite}|${detected}|${hotspot.geometry.coordinates.join(",")}`;
    seenHotspots[key] = detected;
  }
  return {
    containment: containmentNumber(properties.attr_PercentContained),
    recordAt: perimeterTimestamp(properties.attr_ModifiedOnDateTime_dt),
    boundaryAt: Math.max(...boundaries.map(fire => perimeterTimestamp(fire.properties.poly_PolygonDateTime) ?? 0)) || null,
    outAt: perimeterTimestamp(properties.attr_FireOutDateTime),
    seenHotspots
  };
}
function followedFireUpdate(fire: FollowedFire, observation: FollowObservation, asOf: number) {
  const old = fire.baseline;
  const changes: string[] = [];
  if (observation.containment != null && observation.containment !== old.containment) {
    changes.push(`Reported containment: ${observation.containment}%.`);
  }
  if (observation.outAt != null && observation.outAt !== old.outAt) changes.push("A reported out date was added or changed.");
  if (observation.boundaryAt != null && observation.boundaryAt !== old.boundaryAt) changes.push("The mapped boundary record changed.");
  const newDetections = Object.entries(observation.seenHotspots).filter(([key]) => !Object.prototype.hasOwnProperty.call(old.seenHotspots, key));
  if (newDetections.length > 0) {
    const latest = Math.max(...newDetections.map(([, detected]) => detected));
    changes.push(`${newDetections.length} newly received satellite detection${newDetections.length === 1 ? "" : "s"}. Latest observation: ${formatTime(latest)}.`);
  }
  if (changes.length === 0 && observation.recordAt != null && observation.recordAt > (old.recordAt ?? 0)) {
    changes.push("The incident record was updated.");
  }
  const cutoff = asOf - MAX_HOTSPOT_HOURS * 3600000;
  const seenHotspots = Object.fromEntries(Object.entries({
    ...old.seenHotspots,
    ...observation.seenHotspots
  }).filter(([, detected]) => detected >= cutoff));
  return {
    changes,
    next: {
      ...fire,
      checkedAt: asOf,
      baseline: {
        containment: observation.containment ?? old.containment,
        recordAt: observation.recordAt ?? old.recordAt,
        boundaryAt: observation.boundaryAt ?? old.boundaryAt,
        outAt: observation.outAt ?? old.outAt,
        seenHotspots
      }
    }
  };
}
function parseFollowedFires(raw: string | null): FollowedFire[] {
  if (!raw) return [];
  const data: unknown = JSON.parse(raw);
  if (!data || typeof data !== "object" || !("version" in data) || data.version !== 1 || !("fires" in data) || !Array.isArray(data.fires)) throw new Error("Saved followed-fire data could not be read.");
  const ids = new Set<string>();
  for (const fire of data.fires) {
    const baseline = fire?.baseline;
    if (!fire || typeof fire.id !== "string" || !fire.id || ids.has(fire.id) || typeof fire.name !== "string" || !Number.isFinite(fire.followedAt) || !Number.isFinite(fire.checkedAt) || !baseline || ["containment", "recordAt", "boundaryAt", "outAt"].some(key => baseline[key] !== null && (typeof baseline[key] !== "number" || !Number.isFinite(baseline[key]))) || !baseline.seenHotspots || typeof baseline.seenHotspots !== "object" || Array.isArray(baseline.seenHotspots) || Object.values(baseline.seenHotspots).some(value => typeof value !== "number" || !Number.isFinite(value))) {
      throw new Error("Saved followed-fire data could not be read.");
    }
    ids.add(fire.id);
  }
  return data.fires as FollowedFire[];
}
async function notificationPermission(ask: boolean): Promise<boolean> {
  if (Platform.OS === "web") throw new Error("Use the Android or iOS app for phone notifications.");
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync(FOLLOW_CHANNEL_ID, {
      name: "Followed fire updates",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 200, 150, 200]
    });
  }
  let permission = await Notifications.getPermissionsAsync();
  if (!permission.granted && permission.canAskAgain && ask) permission = await Notifications.requestPermissionsAsync();
  return permission.granted || permission.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
}
async function sendFollowNotification(title: string, body: string, fireId?: string): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      ...(Platform.OS === "ios" ? {
        sound: "default" as const
      } : {}),
      data: {
        kind: fireId ? "fire-update" : "test",
        fireId: fireId ?? ""
      }
    },
    trigger: {
      channelId: FOLLOW_CHANNEL_ID
    }
  });
}
function useFollowedFireNotifications(snapshot: FireSnapshot) {
  const [following, setFollowing] = useState<FollowedFire[]>([]);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const followingRef = useRef<FollowedFire[]>([]);
  const readyRef = useRef(false);
  const mounted = useRef(true);
  const latest = useRef(snapshot);
  latest.current = snapshot;
  const queue = useRef<Promise<void>>(Promise.resolve());
  const enqueue = useCallback((job: () => Promise<void>) => {
    const result = queue.current.then(job);
    queue.current = result.catch(() => {});
    return result;
  }, []);
  const commit = useCallback(async (fires: FollowedFire[]) => {
    await AsyncStorage.setItem(FOLLOW_STORAGE_KEY, JSON.stringify({
      version: 1,
      fires
    }));
    followingRef.current = fires;
    if (mounted.current) setFollowing(fires);
  }, []);
  useEffect(() => {
    let cancelled = false;
    mounted.current = true;
    void enqueue(async () => {
      const saved = parseFollowedFires(await AsyncStorage.getItem(FOLLOW_STORAGE_KEY));
      if (cancelled) return;
      followingRef.current = saved;
      readyRef.current = true;
      setFollowing(saved);
      setReady(true);
    }).catch(() => {
      if (!cancelled) setNotice("Could not load saved follows. Restart the app to retry; saved data was not changed.");
    });
    return () => {
      cancelled = true;
      mounted.current = false;
    };
  }, [enqueue]);
  const runAction = useCallback((job: () => Promise<void>) => enqueue(async () => {
    if (!readyRef.current) throw new Error("Followed fires are still loading.");
    if (mounted.current) {
      setBusy(true);
      setNotice("");
    }
    try {
      await job();
    } finally {
      if (mounted.current) setBusy(false);
    }
  }).catch((error: unknown) => {
    if (mounted.current) setNotice(error instanceof Error ? error.message : "Unable to update notifications.");
  }), [enqueue]);
  const enable = useCallback(() => runAction(async () => {
    const permission = await notificationPermission(true);
    if (mounted.current) {
      setAllowed(permission);
      setNotice(permission ? "Phone notifications are enabled. Updates are checked while this map is open." : "Phone notifications are blocked. Enable them in your phone's app settings.");
    }
  }), [runAction]);
  const follow = useCallback((perimeter: FirePerimeter) => runAction(async () => {
    const id = notificationFireId(perimeter);
    if (!id) throw new Error("This record has no stable incident ID and cannot be followed yet.");
    if (followingRef.current.some(fire => fire.id === id)) return;
    const current = latest.current;
    const baseline = observeFollowedFire(id, current);
    if (!baseline) throw new Error("Refresh the map before following this fire.");
    await commit([...followingRef.current, {
      id,
      name: perimeterName(perimeter),
      followedAt: Date.now(),
      checkedAt: current.asOf,
      baseline
    }]);
    const permission = await notificationPermission(true);
    if (mounted.current) {
      setAllowed(permission);
      setNotice(permission ? `Following ${perimeterName(perimeter)}. You'll be notified of changes found while the map is open.` : `Following ${perimeterName(perimeter)}. Phone notifications are blocked; enable them in app settings.`);
    }
  }), [commit, runAction]);
  const unfollow = useCallback((id: string) => runAction(async () => {
    await commit(followingRef.current.filter(fire => fire.id !== id));
    if (mounted.current) setNotice("Fire unfollowed.");
  }), [commit, runAction]);
  const test = useCallback(() => runAction(async () => {
    const permission = await notificationPermission(true);
    if (mounted.current) setAllowed(permission);
    if (!permission) throw new Error("Allow notifications in your phone's app settings, then try the test again.");
    await sendFollowNotification("Ignis — test notification", "This is a test. Yo");
    if (mounted.current) setNotice("Test notification requested. Check the phone's notification panel.");
  }), [runAction]);
  useEffect(() => {
    if (!ready) return;
    void enqueue(async () => {
      if (!mounted.current || AppState.currentState !== "active" || followingRef.current.length === 0) return;
      const permission = await notificationPermission(false);
      if (mounted.current) setAllowed(permission);
      const next = [...followingRef.current];
      let changed = false;
      for (let index = 0; index < next.length; index++) {
        if (!mounted.current || AppState.currentState !== "active") break;
        const fire = next[index];
        if (snapshot.asOf <= fire.checkedAt) continue;
        const observation = observeFollowedFire(fire.id, snapshot);
        if (!observation) continue;
        const update = followedFireUpdate(fire, observation, snapshot.asOf);
        if (update.changes.length > 0 && permission) {
          try {
            await sendFollowNotification(`Ignis — ${fire.name}`, update.changes.join(" "), fire.id);
          } catch {
            if (mounted.current) setNotice(`Could not send the update for ${fire.name}. It will be retried on the next refresh.`);
            continue;
          }
        }
        next[index] = update.next;
        changed = true;
      }
      if (changed) await commit(next);
    }).catch(() => {
      if (mounted.current) setNotice("Could not save notification progress. A later refresh may repeat an update.");
    });
  }, [snapshot, ready, enqueue, commit]);
  return {
    following,
    ready,
    busy,
    notice,
    allowed,
    follow,
    unfollow,
    enable,
    test
  };
}
type WeatherForecast = {
  location: string;
  period: string;
  temperature: number;
  unit: string;
  forecast: string;
};
type NWSForecastPeriod = {
  startTime?: unknown;
  endTime?: unknown;
  name?: unknown;
  temperature?: unknown;
  temperatureUnit?: unknown;
  shortForecast?: unknown;
};
async function fetchWeather(center: [number, number], signal: AbortSignal): Promise<WeatherForecast> {
  const [longitude, latitude] = center;
  const headers = {
    Accept: "application/geo+json",
    ...(Platform.OS === "web" ? {} : {
      "User-Agent": "Ignis Fire Map"
    })
  };
  const pointsResponse = await fetch(`https://api.weather.gov/points/${latitude},${longitude}`, {
    headers,
    signal
  });
  if (!pointsResponse.ok) {
    throw new Error(`NWS location request failed (${pointsResponse.status})`);
  }
  const pointData = (await pointsResponse.json()) as {
    properties?: {
      forecastHourly?: unknown;
      relativeLocation?: {
        properties?: {
          city?: unknown;
          state?: unknown;
        };
      };
    };
  };
  const forecastUrl = pointData.properties?.forecastHourly;
  if (typeof forecastUrl !== "string") {
    throw new Error("NWS did not provide a forecast for this map area");
  }
  const forecastEndpoint = new URL(forecastUrl);
  if (forecastEndpoint.protocol !== "https:" || forecastEndpoint.hostname !== "api.weather.gov") {
    throw new Error("NWS returned an invalid forecast URL");
  }
  const forecastResponse = await fetch(forecastEndpoint.toString(), {
    headers,
    signal
  });
  if (!forecastResponse.ok) {
    throw new Error(`NWS forecast request failed (${forecastResponse.status})`);
  }
  const forecastData = (await forecastResponse.json()) as {
    properties?: {
      periods?: unknown;
    };
  };
  const periods = forecastData.properties?.periods;
  if (!Array.isArray(periods)) {
    throw new Error("NWS returned an unexpected forecast");
  }
  const validPeriods = periods.flatMap(value => {
    if (typeof value !== "object" || value === null) return [];
    const candidate = value as NWSForecastPeriod;
    const start = typeof candidate.startTime === "string" ? Date.parse(candidate.startTime) : Number.NaN;
    const end = typeof candidate.endTime === "string" ? Date.parse(candidate.endTime) : Number.NaN;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || typeof candidate.temperature !== "number" || !Number.isFinite(candidate.temperature) || typeof candidate.shortForecast !== "string") {
      return [];
    }
    const temperature = candidate.temperature;
    const shortForecast = candidate.shortForecast;
    return [{
      ...candidate,
      start,
      end,
      temperature,
      shortForecast
    }];
  });
  const now = Date.now();
  const period = validPeriods.find(item => item.start <= now && now < item.end) ?? validPeriods.find(item => item.start > now) ?? validPeriods[0];
  if (!period) {
    throw new Error("NWS hourly forecast has no temperature for this map area");
  }
  const location = pointData.properties?.relativeLocation?.properties;
  const city = typeof location?.city === "string" ? location.city : "";
  const state = typeof location?.state === "string" ? location.state : "";
  return {
    location: city && state ? `${city}, ${state}` : "Current map area",
    period: typeof period.name === "string" ? period.name : "Current hour",
    temperature: period.temperature,
    unit: typeof period.temperatureUnit === "string" ? period.temperatureUnit : "F",
    forecast: period.shortForecast
  };
}
function weatherSymbol(forecast: string): SymbolViewProps["name"] {
  const summary = forecast.toLowerCase();
  if (summary.includes("thunder")) {
    return {
      ios: "cloud.bolt.fill",
      android: "thunderstorm",
      web: "thunderstorm"
    };
  }
  if (summary.includes("snow") || summary.includes("sleet")) {
    return {
      ios: "cloud.snow.fill",
      android: "weather_snowy",
      web: "weather_snowy"
    };
  }
  if (summary.includes("rain") || summary.includes("shower") || summary.includes("drizzle")) {
    return {
      ios: "cloud.rain.fill",
      android: "rainy",
      web: "rainy"
    };
  }
  if (summary.includes("cloud") || summary.includes("overcast") || summary.includes("fog")) {
    return {
      ios: "cloud.fill",
      android: "cloud",
      web: "cloud"
    };
  }
  return {
    ios: "sun.max.fill",
    android: "wb_sunny",
    web: "wb_sunny"
  };
}
export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const map = useMapTheme();
  const camera = useRef<CameraRef>(null);
  const centerWhenLocated = useRef(false);
  const location = useMapLocation();
  // Map helper state
  const [bounds, setBounds] = useState<Bounds>(DEFAULT_BOUNDS);
  // Matches the Camera's initial zoom below.
  const [zoom, setZoom] = useState(3);
  const [weatherCenter, setWeatherCenter] = useState<[number, number]>(INITIAL_VIEW.center);
  const [weather, setWeather] = useState<WeatherForecast | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(true);
  const [weatherError, setWeatherError] = useState("");
  const [showPlanes, setShowPlanes] = useState(false);
  const [showFires, setShowFires] = useState(true);
  const [conditionId, setConditionId] = useState<ConditionId | null>(null);
  const [helperExpanded, setHelperExpanded] = useState(false);
  const condition = getCondition(conditionId);
  const {
    aircraft,
    error: aircraftError
  } = useAircraft(showPlanes, bounds);
  // Hex data lives in <HexLayer> so new data re-renders only the overlay;
  // this screen just tracks loading/error for the legend card.
  const [gridStatus, setGridStatus] = useState<HexStatus>({
    loading: false,
    error: ""
  });
  // Live map position for the hex overlay. Kept out of state so map movement
  // re-renders only the overlay, not this whole screen.
  const [viewStore] = useState(() => createMapViewStore(INITIAL_VIEW));
  const centerOnLocation = useCallback(() => {
    if (!location.position) return;
    const {
      longitude,
      latitude
    } = location.position.coords;
    camera.current?.easeTo({
      center: [longitude, latitude],
      zoom: Math.max(viewStore.get().zoom, 12),
      duration: 750
    });
  }, [location.position, viewStore]);
  useEffect(() => {
    if (location.error) centerWhenLocated.current = false;
    if (location.position && centerWhenLocated.current) {
      centerWhenLocated.current = false;
      centerOnLocation();
    }
  }, [location.position, location.error, centerOnLocation]);
  useFocusEffect(useCallback(() => () => {
    centerWhenLocated.current = false;
  }, []));
  const locate = () => {
    if (location.position) {
      centerOnLocation();
      return;
    }
    if (location.error) {
      Alert.alert("Your location", location.error.message, [{
        text: "Cancel",
        style: "cancel"
      }, location.error.openSettings ? {
        text: "Open Settings",
        onPress: () => {
          centerWhenLocated.current = true;
          void Linking.openSettings().catch(() => {
            centerWhenLocated.current = false;
            Alert.alert("Location access", "Open your device’s Settings and allow location access for Ignis.");
          });
        }
      } : {
        text: "Try Again",
        onPress: () => {
          centerWhenLocated.current = true;
          location.retry();
        }
      }]);
    }
  };

  // Keeps floating UI just above the bottom tab bar. Android's tab bar sits
  // below the map, so only a small margin is needed; on iOS and web the tab
  // bar overlaps the map, so clear it too.
  const bottomOffset = Platform.OS === "android" ? 12 : insets.bottom + BottomTabInset + 12;
  useEffect(() => {
    let cancelled = false;
    let activeRequest: AbortController | null = null;
    const loadWeather = async () => {
      activeRequest?.abort();
      const controller = new AbortController();
      activeRequest = controller;
      setWeather(null);
      setWeatherLoading(true);
      setWeatherError("");
      try {
        const result = await fetchWeather(weatherCenter, controller.signal);
        if (!cancelled && !controller.signal.aborted) setWeather(result);
      } catch (e) {
        if (!cancelled && !controller.signal.aborted) {
          setWeatherError(e instanceof Error ? e.message : "Unable to load NWS forecast");
        }
      } finally {
        if (!cancelled && !controller.signal.aborted) setWeatherLoading(false);
      }
    };
    const timer = setTimeout(() => {
      void loadWeather();
    }, 600);
    const refreshTimer = setInterval(() => {
      void loadWeather();
    }, 30 * 60 * 1000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      clearInterval(refreshTimer);
      activeRequest?.abort();
    };
  }, [weatherCenter]);
  const [hours, setHours] = useState(24);
  const window = useWindowDimensions();
  const [mapHeight, setMapHeight] = useState(window.height);
  const [headerHeight, setHeaderHeight] = useState(230);
  const detailsMaxHeight = Math.min(mapHeight * 0.4, Math.max(120, mapHeight - headerHeight - 48 - 160));
  const [showFireList, setShowFireList] = useState(false);
  const [showFollowing, setShowFollowing] = useState(false);
  const [notificationTarget, setNotificationTarget] = useState<string | null>(null);
  const [fireSearch, setFireSearch] = useState("");
  const [snapshot, setSnapshot] = useState(() => ({
    hotspots: EMPTY_DATA,
    perimeters: EMPTY_PERIMETERS,
    asOf: Date.now()
  }));
  const followed = useFollowedFireNotifications(snapshot);
  const requestVersion = useRef(0);
  const fires = useMemo(() => filterHotspotsByTime(snapshot.hotspots, hours, snapshot.asOf), [snapshot, hours]);
  const hotspotCounts = useMemo(() => countHotspotsByPerimeter(fires), [fires]);
  const perimeters = useMemo(() => withHotspotCounts(snapshot.perimeters, hotspotCounts), [snapshot.perimeters, hotspotCounts]);
  const matchingPerimeterCount = perimeters.features.filter(p => perimeterHotspotCount(p) > 0).length;
  const perimeterLocators = useMemo(() => buildPerimeterLocators(perimeters), [perimeters]);
  const fireList = useMemo(() => findPerimeters(perimeters, fireSearch), [perimeters, fireSearch]);
  const timeRangeLabel = TIME_WINDOWS.find(window => window.hours === hours)?.label ?? `${hours} hours`;
  const [selected, setSelected] = useState<Hotspot | null>(null);
  const [selectedPerimeter, setSelectedPerimeter] = useState<FirePerimeter | null>(null);
  const [showTechnical, setShowTechnical] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    const version = ++requestVersion.current;
    const asOf = Date.now();
    setLoading(true);
    setError("");
    try {
      const [hotspotData, perimeterData] = await Promise.all([fetchFirms(MAX_HOTSPOT_HOURS, asOf), fetchPerimeters()]);
      if (version !== requestVersion.current) return;
      const filteredHotspots = await filterHotspotsToPerimeters(hotspotData, perimeterData);
      if (version !== requestVersion.current) return;
      console.log("Wildfire matching (last 7 days):", {
        nasaHotspots: hotspotData.features.length,
        activeCandidatePerimeters: perimeterData.features.length,
        matchedHotspots: filteredHotspots.features.length
      });
      setSnapshot({
        hotspots: filteredHotspots,
        perimeters: perimeterData,
        asOf
      });
      setSelected(null);
      setSelectedPerimeter(null);
    } catch (e) {
      if (version !== requestVersion.current) return;
      setError(e instanceof Error ? e.message : "Unable to load fire data");
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    const first = setTimeout(() => {
      void refresh();
    }, 0);
    const timer = setInterval(() => {
      if (AppState.currentState === "active") void refresh();
    }, 5 * 60 * 1000);
    const appStateSubscription = AppState.addEventListener("change", state => {
      if (state === "active") void refresh();
    });
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      appStateSubscription.remove();
      requestVersion.current += 1;
    };
  }, [refresh]);
  const focusPerimeter = useCallback((perimeter: FirePerimeter) => {
    setShowFires(true);
    setShowFireList(false);
    setShowFollowing(false);
    setSelected(null);
    setShowTechnical(false);
    setSelectedPerimeter(perimeter);
    const bounds = perimeterFocusBounds(perimeter);
    if (!bounds) return;
    camera.current?.fitBounds(bounds, {
      padding: {
        top: 48 + headerHeight + 16,
        right: 32,
        bottom: detailsMaxHeight + bottomOffset + 16,
        left: 32
      },
      duration: 900
    });
  }, [headerHeight, detailsMaxHeight, bottomOffset]);
  useEffect(() => {
    let active = true;
    const receive = (response: Notifications.NotificationResponse | null) => {
      const data = response?.notification.request.content.data;
      if (active && data?.kind === "fire-update" && typeof data.fireId === "string") {
        setNotificationTarget(data.fireId);
        void Notifications.clearLastNotificationResponseAsync().catch(() => {});
      }
    };
    const subscription = Notifications.addNotificationResponseReceivedListener(receive);
    void Notifications.getLastNotificationResponseAsync().then(receive).catch(() => {});
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);
  useEffect(() => {
    if (!notificationTarget || loading) return;
    const fire = perimeters.features.find(feature => notificationFireId(feature) === notificationTarget);
    if (fire) focusPerimeter(fire);else setShowFollowing(true);
    setNotificationTarget(null);
  }, [notificationTarget, loading, perimeters, focusPerimeter]);
  const selectedProperties = selected?.properties;
  const selectedFollowId = selectedPerimeter ? notificationFireId(selectedPerimeter) : "";
  const selectedIsFollowed = followed.following.some(fire => fire.id === selectedFollowId);
  return <View style={{
    flex: 1,
    backgroundColor: map.screen
  }} onLayout={event => setMapHeight(event.nativeEvent.layout.height)}>
      <Map style={{
      flex: 1
    }} mapStyle={map.basemap} onPress={() => {
      setSelected(null);
      setSelectedPerimeter(null);
    }} onRegionIsChanging={event => {
      const {
        center,
        zoom
      } = event.nativeEvent;
      viewStore.set({
        center,
        zoom
      });
    }} onRegionDidChange={event => {
      const {
        bounds,
        center,
        zoom
      } = event.nativeEvent;
      viewStore.set({
        center,
        zoom
      }, true);
      // Bounds and zoom in state drive fetching, which waits for the map to settle.
      setBounds(bounds);
      // Rounded so float noise on a pure pan doesn't change the sample level.
      setZoom(Math.round(zoom * 1000) / 1000);
      setWeatherCenter([Number(center[0].toFixed(3)), Number(center[1].toFixed(3))]);
    }} dragPan={true} touchZoom={true}
    // Always north-up and flat: no two-finger rotate or tilt.
    touchRotate={false} touchPitch={false} doubleTapHoldZoom={false}
    // On Android the map buttons sit in the bottom-right corner, so move
    // the attribution (i) button next to the MapLibre logo on the left.
    attributionPosition={Platform.OS === "android" ? {
      bottom: 8,
      left: 104
    } : undefined}>


				<GeoJSONSource id="wildfire-perimeters" data={perimeters} hitbox={{
        top: 28,
        right: 28,
        bottom: 28,
        left: 28
      }} onPress={event => {
        event.stopPropagation();
        const pressed = event.nativeEvent.features.find(feature => feature.geometry.type === "Polygon" || feature.geometry.type === "MultiPolygon");
        if (!pressed) return;
        const pressedId = pressed.properties?.OBJECTID ?? pressed.id;
        if (pressedId == null) return;
        const perimeter = perimeters.features.find(feature => String(feature.properties.OBJECTID ?? feature.id) === String(pressedId));
        if (perimeter) focusPerimeter(perimeter);
      }}>
					<Layer id="wildfire-perimeter-fill" layout={{
          visibility: showFires ? "visible" : "none"
        }} type="fill" paint={{
          "fill-color": ["case", [">", ["get", "appHotspotCount"], 0], "#d946ef", "#ff6b35"],
          "fill-opacity": ["case", [">", ["get", "appHotspotCount"], 0], 0.35, 0.2]
        }} />

					<Layer id="wildfire-perimeter-outline" layout={{
          visibility: showFires ? "visible" : "none"
        }} type="line" paint={{
          "line-color": ["case", ["==", ["to-string", ["get", "OBJECTID"]], selectedPerimeter ? perimeterKey(selectedPerimeter) : ""], "#fff176", [">", ["get", "appHotspotCount"], 0], "#d946ef", "#ff9500"],
          "line-width": ["case", ["==", ["to-string", ["get", "OBJECTID"]], selectedPerimeter ? perimeterKey(selectedPerimeter) : ""], 4, [">", ["get", "appHotspotCount"], 0], 3.5, 2.5]
        }} />
				</GeoJSONSource>

				<Camera ref={camera} initialViewState={INITIAL_VIEW} />

				{/* Locators make small fires visible at regional / national zoom levels. */}
				<GeoJSONSource id="wildfire-locators" data={perimeterLocators} hitbox={{
        top: 28,
        right: 28,
        bottom: 28,
        left: 28
      }} onPress={event => {
        event.stopPropagation();
        const key = event.nativeEvent.features.find(feature => feature.properties?.perimeterKey != null)?.properties?.perimeterKey;
        const perimeter = perimeters.features.find(feature => perimeterKey(feature) === String(key));
        if (perimeter) focusPerimeter(perimeter);
      }}>
					<Layer id="wildfire-locator-circles" layout={{
          visibility: showFires ? "visible" : "none"
        }} type="circle" maxzoom={HOTSPOT_DETAIL_ZOOM} filter={[">", ["get", "hotspotCount"], 0]} paint={{
          "circle-color": "#d946ef",
          "circle-radius": 6,
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 1.5
        }} />
					{/* Keep a locator at close zoom if no matching detections can replace it. */}
					<Layer id="wildfire-locators-without-hotspots" layout={{
          visibility: showFires ? "visible" : "none"
        }} type="circle" filter={["==", ["get", "hotspotCount"], 0]} paint={{
          "circle-color": "#38bdf8",
          "circle-radius": 6,
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 1.5
        }} />
				</GeoJSONSource>

				{/* Keep detections at their actual coordinates, without cluster centers. */}
				<GeoJSONSource id="fire-hotspots" data={fires} cluster={false} onPress={event => {
        event.stopPropagation();
        const pressed = event.nativeEvent.features.find(feature => feature.geometry.type === "Point" && feature.properties?.cluster !== true && feature.properties?.id != null);
        if (!pressed) return;
        const hotspot = fires.features.find(feature => String(feature.properties.id) === String(pressed.properties?.id));
        setShowTechnical(false);
        setSelectedPerimeter(null);
        setSelected(hotspot ?? null);
      }}>
					<Layer id="fire-hotspot-circles" layout={{
          visibility: showFires ? "visible" : "none"
        }} type="circle" minzoom={HOTSPOT_DETAIL_ZOOM} paint={{
          "circle-color": "#ff3b30",
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 2.5, 8, 5, 12, 7],
          "circle-opacity": 0.85,
          "circle-stroke-color": "#ffd166",
          "circle-stroke-width": 0.8
        }} />
				</GeoJSONSource>

        <Images images={{
        plane: require("@/assets/images/map/plane.png")
      }} />
        {condition?.kind === "raster" && <RasterSource key={condition.id} id={`condition-${condition.id}`} tiles={[condition.tiles]} tileSize={256} maxzoom={condition.maxzoom} attribution={condition.source}>
            <Layer id={`condition-${condition.id}-raster`} type="raster" beforeId="wildfire-perimeter-fill" paint={{
          "raster-opacity": condition.opacity
        }} />
          </RasterSource>}

        {/* Planes stay mounted (empty when off) so they always draw on top. */}
        <GeoJSONSource id="aircraft" data={aircraft}>
          <Layer id="aircraft-icons" type="symbol" layout={{
          visibility: showPlanes ? "visible" : "none",
          "icon-image": "plane",
          "icon-size": ["interpolate", ["linear"], ["zoom"], 4, 0.075, 10, 0.1375],
          "icon-rotate": ["get", "track"],
          "icon-rotation-alignment": "map",
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
          "text-field": ["step", ["zoom"], "", 8, ["get", "callsign"]],
          "text-font": ["Noto Sans Regular"],
          "text-size": 11,
          "text-offset": [0, 1.4],
          "text-anchor": "top",
          "text-optional": true
        }} paint={{
          "text-color": map.mapLabel,
          "text-halo-color": map.mapLabelHalo,
          "text-halo-width": 1.2
        }} />
        </GeoJSONSource>
        {location.position && <GeoJSONSource id="current-location" data={{
        type: "Feature",
        properties: {},
        geometry: {
          type: "Point",
          coordinates: [location.position.coords.longitude, location.position.coords.latitude]
        }
      }}>
            <Layer id="current-location-dot" type="circle" paint={{
          "circle-radius": 7,
          "circle-color": "#208AEF",
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 3
        }} />
          </GeoJSONSource>}
			</Map>
      {/* Fixed on-screen honeycomb; the map moves underneath it. */}
      {/* Stays mounted for every layer so downloaded data survives switching. */}
      <HexLayer condition={condition} bounds={bounds} zoom={zoom} onStatusChange={setGridStatus} view={viewStore} fillOpacity={map.gridOpacity} borderColor={map.border} labelColor={map.mapLabel} />



			<View onLayout={event => setHeaderHeight(event.nativeEvent.layout.height)} style={{
      position: "absolute",
      top: 48,
      left: 16,
      right: 16,
      padding: 14,
      borderRadius: 14,
      backgroundColor: map.panel
    }}>
				<Text style={{
        color: map.text,
        fontSize: 21,
        fontWeight: "bold"
      }}>
					Ignis
				</Text>

				<Text style={{
        color: map.textMuted,
        marginTop: 4
      }}>
					{loading ? "Loading satellite detections..." : `${hotspotCountLabel(fires.features.length)}${showFires ? "" : " (hidden)"} • ${perimeters.features.length.toLocaleString()} wildfire boundaries`}</Text>

				<Text style={{
        color: map.textMuted,
        fontSize: 12,
        marginTop: 10
      }}>
					Hotspot time range
				</Text>
				<View style={{
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 8,
        marginTop: 6
      }}>
					{TIME_WINDOWS.map(({
          hours: value,
          label
        }) => <Pressable key={value} onPress={() => {
          setHours(value);
          setSelected(null);
          setSelectedPerimeter(null);
          setShowTechnical(false);
        }} style={{
          paddingVertical: 8,
          paddingHorizontal: 13,
          borderRadius: 8,
          backgroundColor: hours === value ? "#dc2626" : map.button
        }}>
							<Text style={{
            color: map.text,
            fontWeight: "600"
          }}>
								{label}
							</Text>
						</Pressable>)}

					<Pressable onPress={refresh} style={{
          padding: 8,
          borderRadius: 8,
          backgroundColor: map.buttonStrong
        }}>
						<Text style={{
            color: map.text
          }}>Refresh</Text>
					</Pressable>
				</View>

				<View style={{
        flexDirection: "row",
        gap: 8,
        marginTop: 10
      }}>
					<Pressable accessibilityRole="button" accessibilityLabel="Find a fire by name and zoom to its boundary" onPress={() => {
          setFireSearch("");
          setShowFireList(true);
        }} style={{
          flex: 1,
          paddingVertical: 12,
          paddingHorizontal: 12,
          borderRadius: 8,
          backgroundColor: "#075985",
          minHeight: 44
        }}>
						<Text style={{
            color: map.text,
            fontWeight: "600"
          }}>Find a fire</Text>
					</Pressable>
					<Pressable accessibilityRole="button" accessibilityLabel="Followed fires and notification settings" onPress={() => setShowFollowing(true)} style={{
          flex: 1,
          minHeight: 44,
          justifyContent: "center",
          paddingHorizontal: 12,
          borderRadius: 8,
          backgroundColor: map.button
        }}>
						<Text style={{
            color: map.text,
            fontWeight: "600"
          }}>Following ({followed.following.length})</Text>
					</Pressable>
				</View>
				<Text style={{
        color: map.textMuted,
        fontSize: 12,
        marginTop: 8
      }}>
					Purple: boundary with hotspots · Blue: fire locator
					{"\n"}Zoom in for red satellite hotspots.
					{"\n"}{matchingPerimeterCount} {matchingPerimeterCount === 1 ? "boundary" : "boundaries"} with hotspots · past {timeRangeLabel}
				</Text>

				{loading && <ActivityIndicator color="#f87171" style={{
        marginTop: 10,
        alignSelf: "flex-start"
      }} />}

				{!!error && <Text style={{
        color: map.error,
        marginTop: 8
      }}>{error}</Text>}
			</View>

      {!selectedProperties && !selectedPerimeter && <View pointerEvents="none" style={{
      position: "absolute",
      bottom: bottomOffset,
      left: 12,
      right: 76,
      maxWidth: 150,
      minHeight: 38,
      justifyContent: "center",
      padding: 6,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: map.border,
      backgroundColor: map.panelSolid
    }} accessibilityRole="summary" accessibilityLabel={weather ? `${weather.temperature} degrees ${weather.unit}, ${weather.location}` : weatherLoading ? "Loading weather forecast" : weatherError}>
          {weatherLoading ? <View style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 6
      }}>
              <ActivityIndicator size="small" color={map.spinner} />
              <Text style={{
          color: map.textMuted,
          fontSize: 10
        }}>
                Loading weather...
              </Text>
            </View> : weather ? <View style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 5
      }}>
              <SymbolView name={weatherSymbol(weather.forecast)} size={18} tintColor={map.accent} />
              <View style={{
          flexShrink: 1
        }}>
                <Text style={{
            color: map.text,
            fontSize: 15,
            fontWeight: "700"
          }} numberOfLines={1}>
                  {weather.temperature}°{weather.unit}
                </Text>
                <Text style={{
            color: map.textMuted,
            fontSize: 9
          }} numberOfLines={1}>
                  {weather.location}
                </Text>
              </View>
            </View> : <Text style={{
        color: map.error,
        fontSize: 11
      }} numberOfLines={2}>
              {weatherError}
            </Text>}
        </View>}

      {!selectedProperties && !selectedPerimeter && !helperExpanded && <MapLegend bottom={bottomOffset + 52} condition={condition} conditionLoading={gridStatus.loading} conditionError={gridStatus.error} planeCount={showPlanes ? aircraft.features.length : null} planeError={aircraftError} />}

      <MapHelper bottom={bottomOffset} locating={location.loading} onLocate={locate} showPlanes={showPlanes} showFires={showFires} condition={conditionId} onTogglePlanes={() => setShowPlanes(v => !v)} onToggleFires={() => setShowFires(v => !v)} onSelectCondition={setConditionId} onExpandedChange={setHelperExpanded} />


			<Modal visible={showFireList} transparent animationType="slide" onRequestClose={() => setShowFireList(false)}>
				<View style={{
        flex: 1,
        justifyContent: "flex-end",
        backgroundColor: "#00000088"
      }}>
					<Pressable style={{
          flex: 1
        }} accessibilityRole="button" accessibilityLabel="Close fire list" onPress={() => setShowFireList(false)} />
					<View style={{
          height: "70%",
          backgroundColor: map.screen,
          padding: 20,
          paddingBottom: 32,
          borderTopLeftRadius: 20,
          borderTopRightRadius: 20
        }}>
						<View style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 12
          }}>
							<Text style={{
              color: map.text,
              fontSize: 22,
              fontWeight: "bold",
              flex: 1
            }}>Find a fire</Text>
							<Pressable accessibilityRole="button" onPress={() => setShowFireList(false)} style={{
              padding: 12,
              minHeight: 44
            }}>
								<Text style={{
                color: map.accent,
                fontWeight: "600"
              }}>Close</Text>
							</Pressable>
						</View>
						<Text style={{
            color: map.textMuted,
            marginBottom: 12
          }}>
							Hotspot matches appear first. Tap a row to zoom to its boundary.
						</Text>
						<TextInput value={fireSearch} onChangeText={setFireSearch} placeholder="Search fire name" placeholderTextColor={map.textSubtle} accessibilityLabel="Search fire name" autoCorrect={false} returnKeyType="search" style={{
            color: map.text,
            backgroundColor: map.panelSolid,
            borderRadius: 10,
            paddingHorizontal: 14,
            paddingVertical: 12,
            fontSize: 16,
            marginBottom: 8
          }} />
						<FlatList style={{
            flex: 1
          }} data={fireList} keyExtractor={item => perimeterKey(item)} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" ListEmptyComponent={<Text style={{
            color: map.textMuted,
            paddingVertical: 24
          }}>
									{loading ? "Loading wildfire boundaries..." : error ? "Unable to load boundaries. Close this list and try Refresh." : fireSearch.trim() ? "No fire names match your search." : "No wildfire boundaries available."}
								</Text>} renderItem={({
            item
          }) => <Pressable accessibilityRole="button" accessibilityLabel={`Zoom to ${perimeterName(item)}`} onPress={() => focusPerimeter(item)} style={{
            paddingVertical: 16,
            borderBottomWidth: 1,
            borderBottomColor: map.button
          }}>
									<Text style={{
              color: map.text,
              fontSize: 17,
              fontWeight: "600"
            }}>{perimeterName(item)}</Text>
									<Text style={{
              color: map.textMuted,
              marginTop: 5
            }}>
										Containment: {readableContainment(item.properties.attr_PercentContained)}
									</Text>
									<Text style={{
              color: perimeterHotspotCount(item) > 0 ? "#e879f9" : map.textSubtle,
              marginTop: 5
            }}>
										{hotspotCountLabel(perimeterHotspotCount(item))} · past {timeRangeLabel}
									</Text>
									<Text style={{
              color: map.accent,
              marginTop: 5
            }}>View on map →</Text>
								</Pressable>} />
					</View>
				</View>
			</Modal>

			<Modal visible={showFollowing} transparent animationType="slide" onRequestClose={() => setShowFollowing(false)}>
				<View style={{
        flex: 1,
        justifyContent: "flex-end",
        backgroundColor: "#00000088"
      }}>
					<Pressable style={{
          flex: 1
        }} accessibilityRole="button" accessibilityLabel="Close followed fires" onPress={() => setShowFollowing(false)} />
					<View style={{
          height: "78%",
          backgroundColor: map.screen,
          padding: 20,
          paddingBottom: 32,
          borderTopLeftRadius: 20,
          borderTopRightRadius: 20
        }}>
						<View style={{
            flexDirection: "row",
            alignItems: "center"
          }}>
							<Text style={{
              color: map.text,
              fontSize: 21,
              fontWeight: "bold",
              flex: 1
            }}>Following & notifications</Text>
							<Pressable accessibilityRole="button" onPress={() => setShowFollowing(false)} style={{
              padding: 12
            }}>
								<Text style={{
                color: map.accent
              }}>Close</Text>
							</Pressable>
						</View>
						<Text style={{
            color: map.textMuted,
            marginTop: 8
          }}>
							Receive incident-record, containment, boundary and newly received satellite-detection updates for fires you follow.
						</Text>
						<Text style={{
            color: "#fcd34d",
            marginTop: 8
          }}>
							First version: checks run every 5 minutes while this map is open. No update checks run while the app is closed. These are informational updates, not evacuation alerts.
						</Text>
						<View style={{
            flexDirection: "row",
            flexWrap: "wrap",
            gap: 8,
            marginTop: 12,
            marginBottom: 8
          }}>
							<Pressable disabled={!followed.ready || followed.busy} accessibilityRole="button" onPress={() => {
              void followed.enable();
            }} style={{
              backgroundColor: "#075985",
              padding: 12,
              borderRadius: 8,
              opacity: followed.ready && !followed.busy ? 1 : 0.5
            }}>
								<Text style={{
                color: map.text
              }}>Enable notifications</Text>
							</Pressable>
							<Pressable disabled={!followed.ready || followed.busy} accessibilityRole="button" onPress={() => {
              void followed.test();
            }} style={{
              backgroundColor: map.button,
              padding: 12,
              borderRadius: 8,
              opacity: followed.ready && !followed.busy ? 1 : 0.5
            }}>
								<Text style={{
                color: map.text
              }}>Send test</Text>
							</Pressable>
							<Pressable accessibilityRole="button" onPress={() => {
              void Linking.openSettings().catch(() => {});
            }} style={{
              padding: 12
            }}>
								<Text style={{
                color: map.accent
              }}>Phone settings</Text>
							</Pressable>
						</View>
						<Text style={{
            color: map.textMuted,
            marginBottom: 8
          }}>
							{followed.allowed === true ? "Notification permission allowed" : followed.allowed === false ? "Notification permission blocked" : "Tap Enable notifications to check permission"}
						</Text>
						{!!followed.notice && <Text style={{
            color: "#bae6fd",
            marginBottom: 10
          }}>{followed.notice}</Text>}
						<FlatList style={{
            flex: 1
          }} data={followed.following} keyExtractor={fire => fire.id} ListEmptyComponent={<Text style={{
            color: map.textMuted,
            paddingVertical: 20
          }}>
								{followed.ready ? "No followed fires yet. Open a fire's details and tap Follow fire." : "Loading followed fires..."}
							</Text>} renderItem={({
            item
          }) => {
            const mapped = perimeters.features.find(fire => notificationFireId(fire) === item.id);
            return <View style={{
              paddingVertical: 14,
              borderBottomWidth: 1,
              borderBottomColor: map.button
            }}>
									<Text style={{
                color: map.text,
                fontSize: 17,
                fontWeight: "600"
              }}>{item.name}</Text>
									<Text style={{
                color: map.textMuted,
                marginTop: 5
              }}>
										{mapped ? "Available on the current map" : "Not in the latest active map results; current status is unknown."}
									</Text>
									<View style={{
                flexDirection: "row",
                gap: 16,
                marginTop: 4
              }}>
										{mapped && <Pressable accessibilityRole="button" onPress={() => focusPerimeter(mapped)} style={{
                  paddingVertical: 12
                }}>
											<Text style={{
                    color: map.accent
                  }}>View on map</Text>
										</Pressable>}
										<Pressable disabled={followed.busy} accessibilityRole="button" onPress={() => {
                  void followed.unfollow(item.id);
                }} style={{
                  paddingVertical: 12
                }}>
											<Text style={{
                    color: map.error
                  }}>Unfollow</Text>
										</Pressable>
									</View>
								</View>;
          }} />
					</View>
				</View>
			</Modal>

			{selectedPerimeter && <View style={{
      position: "absolute",
      bottom: bottomOffset,
      left: 16,
      right: 16,
      maxHeight: detailsMaxHeight,
      backgroundColor: map.panelSolid,
      borderRadius: 14,
      padding: 16
    }}>
					<ScrollView>
						<Text style={{
          color: map.text,
          fontSize: 20,
          fontWeight: "bold"
        }}>
							{String(selectedPerimeter.properties.poly_IncidentName || "Fire name not reported")}
						</Text>

						<Text style={{
          color: "#ffd166",
          marginTop: 6
        }}>
							Reported wildfire boundary
						</Text>
						<Pressable accessibilityRole="button" disabled={!selectedFollowId || !followed.ready || followed.busy} onPress={() => {
          void (selectedIsFollowed ? followed.unfollow(selectedFollowId) : followed.follow(selectedPerimeter));
        }} style={{
          marginTop: 12,
          padding: 12,
          borderRadius: 8,
          backgroundColor: selectedIsFollowed ? map.button : "#075985",
          opacity: selectedFollowId && followed.ready && !followed.busy ? 1 : 0.5
        }}>
							<Text style={{
            color: map.text,
            textAlign: "center",
            fontWeight: "600"
          }}>
								{!selectedFollowId ? "Following unavailable: incident ID missing" : !followed.ready ? "Loading follows..." : selectedIsFollowed ? "Following — tap to unfollow" : "Follow fire"}
							</Text>
						</Pressable>
						<Text style={{
          color: map.textSubtle,
          marginTop: 6
        }}>Update checks run while this map is open.</Text>
						{!!followed.notice && <Text style={{
          color: "#bae6fd",
          marginTop: 6
        }}>{followed.notice}</Text>}
						<Text style={{
          color: "#e879f9",
          marginTop: 10
        }}>
							Satellite detections: {hotspotCountLabel(hotspotCounts.get(perimeterKey(selectedPerimeter)) ?? 0)} · past {timeRangeLabel}
						</Text>

						<Text style={{
          color: map.textBody,
          marginTop: 16
        }}>
							Status: Wildfire flagged as potentially active
						</Text>

						<Text style={{
          color: map.textBody,
          marginTop: 12
        }}>
							Reported containment:{" "}
							{readableContainment(selectedPerimeter.properties.attr_PercentContained)}
						</Text>

						<Text style={{
          color: map.textBody,
          marginTop: 12
        }}>
							Incident record updated:
							{"\n"}
							{readableObservation(perimeterTimestamp(selectedPerimeter.properties.attr_ModifiedOnDateTime_dt))}
						</Text>

						<Text style={{
          color: map.textBody,
          marginTop: 12
        }}>
							Reported out date:
							{"\n"}
							{readableObservation(perimeterTimestamp(selectedPerimeter.properties.attr_FireOutDateTime))}
						</Text>

						<Text style={{
          color: map.textSubtle,
          marginTop: 12
        }}>
							Containment is not the same as extinguishment.
							An active-candidate flag and missing out date do not confirm current burning.
						</Text>

						<Text style={{
          color: map.textBody,
          marginTop: 16
        }}>
							Boundary captured:
							{"\n"}
							{readableObservation(perimeterTimestamp(selectedPerimeter.properties.poly_PolygonDateTime))}
						</Text>

						<Text style={{
          color: map.textSubtle,
          marginTop: 12
        }}>
							This is the reported mapped fire extent. It does not
							mean the entire area is currently burning.
						</Text>

						<Text style={{
          color: map.textMuted,
          marginTop: 12
        }}>
							Boundary source: NIFC / WFIGS
						</Text>

						<Pressable onPress={() => setSelectedPerimeter(null)} style={{
          marginTop: 16,
          padding: 12,
          borderRadius: 8,
          backgroundColor: map.button
        }}>
							<Text style={{
            color: map.text,
            textAlign: "center"
          }}>
								Close
							</Text>
						</Pressable>
					</ScrollView>
				</View>}
			{selectedProperties && <View style={{
      position: "absolute",
      bottom: bottomOffset,
      left: 16,
      right: 16,
      backgroundColor: map.panelSolid,
      borderRadius: 14,
      padding: 16
    }}>
					<ScrollView>
						<Text style={{
          color: map.text,
          fontSize: 18,
          fontWeight: "bold"
        }}>
							Hotspot details
						</Text>

						<Text style={{
          color: map.textBody,
          marginTop: 8
        }}>
							Satellite observation:
							{"\n"}
							{readableObservation(selectedProperties.detected)}
							{"\n\n"}Satellite:{" "}
							{readableSatellite(selectedProperties.satellite)}
							{"\n"}Detection confidence: {selectedProperties.confidence}
						</Text>

						<Text style={{
          color: map.textSubtle,
          marginTop: 8
        }}>
							Confidence describes the quality of the satellite heat
							detection. It is not a wildfire risk rating.
						</Text>

						<Text style={{
          color: map.textSubtle,
          marginTop: 8
        }}>
							This detection falls within a reported wildfire perimeter.
							It does not establish that the location is still burning.
						</Text>

						<Pressable onPress={() => setShowTechnical(current => !current)} style={{
          marginTop: 12,
          paddingVertical: 8
        }}>
							<Text style={{
            color: "#ffd166",
            fontWeight: "600"
          }}>
								{showTechnical ? "Hide technical details" : "Show technical details"}
							</Text>
						</Pressable>

						{showTechnical && <Text style={{
          color: map.textMuted,
          marginTop: 8
        }}>
								Coordinates: {selected?.geometry.coordinates[1].toFixed(5)},{" "}
								{selected?.geometry.coordinates[0].toFixed(5)}

								{"\n\n"}Fire radiative power:{" "}
								{selectedProperties.frp == null ? "Not reported" : `${selectedProperties.frp} MW`}
								{"\n"}Estimated radiant heat output associated with the
								detection; not the fire's size.

								{"\n\n"}Satellite brightness temperature:{" "}
								{selectedProperties.brightness == null ? "Not reported" : `${selectedProperties.brightness} K`}
								{"\n"}An infrared measurement, not a direct flame temperature.

								{"\n\n"}Observation period: {selectedProperties.daynight}
							</Text>}

						<Pressable onPress={() => {
          setSelected(null);
          setSelectedPerimeter(null);
        }} style={{
          marginTop: 12,
          padding: 10,
          backgroundColor: map.button,
          borderRadius: 8
        }}>
							<Text style={{
            color: map.text,
            textAlign: "center"
          }}>Close</Text>
						</Pressable>
					</ScrollView>
				</View>}
		</View>;
}
