import {
  Camera,
  GeoJSONSource,
  Layer,
  Map,
} from "@maplibre/maplibre-react-native";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";

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
	const [hours, setHours] = useState(24);
	const [fires, setFires] = useState<FireCollection>(EMPTY_DATA);
	const [selected, setSelected] = useState<Hotspot | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");

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
		refresh();

		const timer = setInterval(refresh, 5 * 60 * 1000);
		return () => clearInterval(timer);
	}, [refresh]);

	const selectedProperties = selected?.properties;

	return (
		<View style={{ flex: 1, backgroundColor: "#101820" }}>
			<Map
				style={{ flex: 1 }}
				mapStyle="https://tiles.openfreemap.org/styles/liberty"
				onPress={() => setSelected(null)}
			>
				<Camera centerCoordinate={[-119.4179, 36.7783]} zoomLevel={5} />

				<GeoJSONSource
					id="fire-hotspots"
					data={fires}
					cluster={true}
					clusterRadius={35}
				>
					<Layer
						id="fire-hotspot-circles"
						type="circle"
						style={{
							circleColor: "#ff3b30",
							circleRadius: [
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
							circleOpacity: 0.85,
							circleStrokeColor: "#ffd166",
							circleStrokeWidth: 0.8,
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
						: `${fires.features.length.toLocaleString()} hotspots found`}
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

			{selectedProperties && (
				<View
					style={{
						position: "absolute",
						bottom: 24,
						left: 16,
						right: 16,
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
							To enable tap-to-select, wire the GeoJSON source's onPress event
							to setSelected using the pressed feature's properties.
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
