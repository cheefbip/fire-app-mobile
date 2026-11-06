import {
	Camera,
	GeoJSONSource,
	Images,
	Layer,
	Map,
	RasterSource,
} from "@maplibre/maplibre-react-native";
import { useCallback, useEffect, useState } from "react";
import {
	ActivityIndicator,
	Pressable,
	ScrollView,
	Text,
	View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { MapHelper } from "@/components/map/map-helper";
import { MapLegend } from "@/components/map/map-legend";
import { BottomTabInset } from "@/constants/theme";
import { useAircraft } from "@/lib/aircraft";
import {
	getCondition,
	useConditionGrid,
	type ConditionId,
} from "@/lib/conditions";
import { DEFAULT_BOUNDS, type Bounds } from "@/lib/geo";

const MAPTILER_API_KEY = process.env.EXPO_PUBLIC_MAPTILER_API_KEY;

const ENDPOINT =
	"https://services9.arcgis.com/RHVPKKiFTONKtxq3/ArcGIS/rest/services/Satellite_VIIRS_Thermal_Hotspots_and_Fire_Activity/FeatureServer/0/query";

type Hotspot = {
	type: "Feature";
	id?: number;
	geometry: {
		type: "Point";
		coordinates: [number, number];
	};
	properties: {
		id: number;
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

const EMPTY_DATA: FireCollection = {
	type: "FeatureCollection",
	features: [],
};

function makeQueryURL(hours: number) {
	const since = new Date(Date.now() - hours * 3600000)
		.toISOString()
		.slice(0, 19)
		.replace("T", " ");

	const params = new URLSearchParams({
		f: "json",
		where: `acq_time >= TIMESTAMP '${since}'`,
		geometry: JSON.stringify({
			xmin: -125,
			ymin: 32,
			xmax: -113,
			ymax: 43,
		}),
		geometryType: "esriGeometryEnvelope",
		inSR: "4326",
		outSR: "4326",
		spatialRel: "esriSpatialRelIntersects",
		returnGeometry: "true",
		outFields: "OBJECTID,acq_time,satellite,confidence,frp,bright_ti4,daynight",
		orderByFields: "acq_time DESC,OBJECTID DESC",
		resultRecordCount: "5000",
	});

	return `${ENDPOINT}?${params.toString()}`;
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

		if (
			!a ||
			!Number.isFinite(x) ||
			!Number.isFinite(y) ||
			Math.abs(x) > 180 ||
			Math.abs(y) > 90
		) {
			continue;
		}

		features.push({
			type: "Feature",
			id: a.OBJECTID,
			geometry: {
				type: "Point",
				coordinates: [x, y],
			},
			properties: {
				id: a.OBJECTID,
				detected: Number.isFinite(a.acq_time) ? a.acq_time : null,
				satellite: String(a.satellite ?? "Not reported"),
				confidence: String(a.confidence ?? "Not reported"),
				frp: Number.isFinite(a.frp) ? a.frp : null,
				brightness: Number.isFinite(a.bright_ti4) ? a.bright_ti4 : null,
				daynight:
					a.daynight === "D"
						? "Day"
						: a.daynight === "N"
							? "Night"
							: "Not reported",
			},
		});
	}

	return {
		type: "FeatureCollection",
		features,
	};
}

function formatTime(value: number | null) {
	if (value == null) return "Not reported";
	return new Date(value).toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

export default function HomeScreen() {
	const insets = useSafeAreaInsets();
	const [hours, setHours] = useState(24);
	const [fires, setFires] = useState<FireCollection>(EMPTY_DATA);
	const [selected, setSelected] = useState<Hotspot | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");

	// Map helper state
	const [bounds, setBounds] = useState<Bounds>(DEFAULT_BOUNDS);
	const [showPlanes, setShowPlanes] = useState(false);
	const [showFires, setShowFires] = useState(true);
	const [conditionId, setConditionId] = useState<ConditionId | null>(null);
	const [helperExpanded, setHelperExpanded] = useState(false);

	const condition = getCondition(conditionId);
	const { aircraft, error: aircraftError } = useAircraft(showPlanes, bounds);
	const {
		grid,
		loading: gridLoading,
		error: gridError,
	} = useConditionGrid(condition, bounds);

	// Keeps floating UI just above the bottom tab bar.
	const bottomOffset = insets.bottom + BottomTabInset + 12;

	const refresh = useCallback(async () => {
		setLoading(true);
		setError("");

		try {
			const response = await fetch(makeQueryURL(hours));

			if (!response.ok) {
				throw new Error(`Request failed (${response.status})`);
			}

			const result = toGeoJSON(await response.json());
			setFires(result);
			setSelected(null);
		} catch (e) {
			setError(e instanceof Error ? e.message : "Unable to load fire data");
		} finally {
			setLoading(false);
		}
	}, [hours]);

	useEffect(() => {
		// Deferred a tick so refresh's setState calls run outside the effect body.
		const first = setTimeout(refresh, 0);
		const timer = setInterval(refresh, 5 * 60 * 1000);
		return () => {
			clearTimeout(first);
			clearInterval(timer);
		};
	}, [refresh]);

	const selectedProperties = selected?.properties;

	return (
		<View style={{ flex: 1, backgroundColor: "#101820" }}>
			<Map
				style={{ flex: 1 }}
				mapStyle="https://tiles.openfreemap.org/styles/liberty"
				onPress={() => setSelected(null)}
				onRegionDidChange={(event) => setBounds(event.nativeEvent.bounds)}
			>
				<Camera initialViewState={{ center: [-119.4179, 36.7783], zoom: 5 }} />

				<Images images={{ plane: require("@/assets/images/map/plane.png") }} />

				{/* Fires stay mounted so condition layers can sit underneath them. */}
				<GeoJSONSource
					id="fire-hotspots"
					data={fires}
					cluster={false}
					clusterRadius={35}
				>
					<Layer
						id="fire-hotspot-circles"
						type="circle"
						layout={{ visibility: showFires ? "visible" : "none" }}
						paint={{
							"circle-color": "#ff3b30",
							"circle-radius": [
								"interpolate",
								["linear"],
								["zoom"],
								3,
								2.5,
								8,
								5,
								12,
								7,
							],
							"circle-opacity": 0.85,
							"circle-stroke-color": "#ffd166",
							"circle-stroke-width": 0.8,
						}}
					/>
				</GeoJSONSource>

				{condition?.kind === "raster" && (
					<RasterSource
						key={condition.id}
						id={`condition-${condition.id}`}
						tiles={[condition.tiles]}
						tileSize={256}
						maxzoom={condition.maxzoom}
						attribution={condition.source}
					>
						<Layer
							id={`condition-${condition.id}-raster`}
							type="raster"
							beforeId="fire-hotspot-circles"
							paint={{ "raster-opacity": condition.opacity }}
						/>
					</RasterSource>
				)}

				{condition?.kind === "grid" && (
					<GeoJSONSource id="condition-grid" data={grid}>
						<Layer
							id="condition-grid-cells"
							type="fill"
							beforeId="fire-hotspot-circles"
							filter={["==", ["get", "kind"], "cell"]}
							paint={{
								"fill-color": ["get", "color"],
								"fill-opacity": 0.38,
								"fill-outline-color": "#ffffff22",
							}}
						/>
						<Layer
							id="condition-grid-arrows"
							beforeId="aircraft-icons"
							type="line"
							filter={["==", ["get", "kind"], "arrow"]}
							layout={{ "line-cap": "round", "line-join": "round" }}
							paint={{ "line-color": "#0f172a", "line-width": 2.5 }}
						/>
						<Layer
							id="condition-grid-labels"
							beforeId="aircraft-icons"
							type="symbol"
							filter={["==", ["get", "kind"], "label"]}
							layout={{
								"text-field": ["get", "label"],
								"text-font": ["Noto Sans Regular"],
								"text-size": 12,
								"text-allow-overlap": true,
							}}
							paint={{
								"text-color": "#0f172a",
								"text-halo-color": "#ffffffcc",
								"text-halo-width": 1.5,
							}}
						/>
					</GeoJSONSource>
				)}

				{/* Planes stay mounted (empty when off) so they always draw on top. */}
				<GeoJSONSource id="aircraft" data={aircraft}>
					<Layer
						id="aircraft-icons"
						type="symbol"
						layout={{
							visibility: showPlanes ? "visible" : "none",
							"icon-image": "plane",
							"icon-size": ["interpolate", ["linear"], ["zoom"], 4, 0.3, 10, 0.55],
							"icon-rotate": ["get", "track"],
							"icon-rotation-alignment": "map",
							"icon-allow-overlap": true,
							"icon-ignore-placement": true,
							"text-field": ["step", ["zoom"], "", 8, ["get", "callsign"]],
							"text-font": ["Noto Sans Regular"],
							"text-size": 11,
							"text-offset": [0, 1.4],
							"text-anchor": "top",
							"text-optional": true,
						}}
						paint={{
							"text-color": "#0f172a",
							"text-halo-color": "#ffffffdd",
							"text-halo-width": 1.2,
						}}
					/>
				</GeoJSONSource>
			</Map>

			<View
				style={{
					position: "absolute",
					top: 48,
					left: 16,
					right: 16,
					padding: 14,
					borderRadius: 14,
					backgroundColor: "#101820ee",
				}}
			>
				<Text style={{ color: "white", fontSize: 21, fontWeight: "bold" }}>
					California Fire Watch
				</Text>

				<Text style={{ color: "#cbd5e1", marginTop: 4 }}>
					{loading
						? "Loading satellite detections..."
						: `${fires.features.length.toLocaleString()} hotspots found${showFires ? "" : " (hidden)"}`}
				</Text>

				<View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
					{[24, 48, 168].map((value) => (
						<Pressable
							key={value}
							onPress={() => setHours(value)}
							style={{
								paddingVertical: 8,
								paddingHorizontal: 13,
								borderRadius: 8,
								backgroundColor: hours === value ? "#dc2626" : "#334155",
							}}
						>
							<Text style={{ color: "white", fontWeight: "600" }}>
								{value === 168 ? "7 days" : `${value} hours`}
							</Text>
						</Pressable>
					))}

					<Pressable
						onPress={refresh}
						style={{
							padding: 8,
							borderRadius: 8,
							backgroundColor: "#475569",
						}}
					>
						<Text style={{ color: "white" }}>Refresh</Text>
					</Pressable>
				</View>

				{loading && (
					<ActivityIndicator
						color="#f87171"
						style={{ marginTop: 10, alignSelf: "flex-start" }}
					/>
				)}

				{!!error && (
					<Text style={{ color: "#fca5a5", marginTop: 8 }}>{error}</Text>
				)}
			</View>

			{!selectedProperties && !helperExpanded && (
				<MapLegend
					bottom={bottomOffset}
					condition={condition}
					conditionLoading={gridLoading}
					conditionError={gridError}
					planeCount={showPlanes ? aircraft.features.length : null}
					planeError={aircraftError}
				/>
			)}

			<MapHelper
				bottom={bottomOffset}
				showPlanes={showPlanes}
				showFires={showFires}
				condition={conditionId}
				onTogglePlanes={() => setShowPlanes((v) => !v)}
				onToggleFires={() => setShowFires((v) => !v)}
				onSelectCondition={setConditionId}
				onExpandedChange={setHelperExpanded}
			/>

			{selectedProperties && (
				<View
					style={{
						position: "absolute",
						bottom: bottomOffset,
						left: 16,
						right: 76,
						backgroundColor: "#101820f5",
						borderRadius: 14,
						padding: 16,
					}}
				>
					<ScrollView>
						<Text style={{ color: "white", fontSize: 18, fontWeight: "bold" }}>
							Hotspot details
						</Text>

						<Text style={{ color: "#e2e8f0", marginTop: 8 }}>
							Coordinates: {selected?.geometry.coordinates[1].toFixed(5)},{" "}
							{selected?.geometry.coordinates[0].toFixed(5)}
							{"\n"}Detected: {formatTime(selectedProperties.detected)}
							{"\n"}Satellite: {selectedProperties.satellite}
							{"\n"}Confidence: {selectedProperties.confidence}
							{"\n"}Fire radiative power:{" "}
							{selectedProperties.frp ?? "Not reported"} MW
							{"\n"}Brightness temperature:{" "}
							{selectedProperties.brightness ?? "Not reported"} K{"\n"}Day /
							night: {selectedProperties.daynight}
						</Text>

						<Text style={{ color: "#94a3b8", marginTop: 8 }}>
							To enable tap-to-select, wire the GeoJSON source&apos;s onPress event
							to setSelected using the pressed feature&apos;s properties.
						</Text>

						<Pressable
							onPress={() => setSelected(null)}
							style={{
								marginTop: 12,
								padding: 10,
								backgroundColor: "#334155",
								borderRadius: 8,
							}}
						>
							<Text style={{ color: "white", textAlign: "center" }}>Close</Text>
						</Pressable>
					</ScrollView>
				</View>
			)}
		</View>
	);
}
