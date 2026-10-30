import bbox from "@turf/bbox";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";

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

const FIRMS_MAP_KEY = process.env.EXPO_PUBLIC_FIRMS_MAP_KEY;

const FIRMS_SOURCES = [
	"VIIRS_NOAA20_NRT",
	"VIIRS_NOAA21_NRT",
	"VIIRS_SNPP_NRT",
];

const FIRMS_AREAS = [
	"-125,24,-66,50",
	"-180,51,-129,72",
	"172,50,180,55",
	"-161,18,-154,23",
];

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
	geometry:
	| {
		type: "Polygon";
		coordinates: number[][][];
	}
	| {
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
	features: [],
};

const EMPTY_DATA: FireCollection = {
	type: "FeatureCollection",
	features: [],
};

async function fetchFirms(hours: number): Promise<FireCollection> {
	if (!FIRMS_MAP_KEY) {
		throw new Error("Missing EXPO_PUBLIC_FIRMS_MAP_KEY in .env");
	}

	const now = Date.now();
	const cutoff = now - hours * 60 * 60 * 1000;
	const dayMs = 24 * 60 * 60 * 1000;
	const firstDay = Math.floor(cutoff / dayMs) * dayMs;
	const today = Math.floor(now / dayMs) * dayMs;

	const requests: Promise<string>[] = [];

	for (const source of FIRMS_SOURCES) {
		for (const area of FIRMS_AREAS) {

			for (let start = firstDay; start <= today; start += 5 * dayMs) {
				const days = Math.min(
					5,
					Math.floor((today - start) / dayMs) + 1
				);

				const date = new Date(start).toISOString().slice(0, 10);

				const url =
					"https://firms.modaps.eosdis.nasa.gov/api/area/csv/" +
					`${encodeURIComponent(FIRMS_MAP_KEY)}/` +
					`${source}/${area}/${days}/${date}`;

				requests.push(
					(async () => {
						const response = await fetch(url);

						if (!response.ok) {
							throw new Error(
								`NASA ${source} request failed (${response.status})`
							);
						}

						return response.text();
					})()
				);
			}
		}
	}



	const csvFiles = await Promise.all(requests);


	const features: {
		geometry: { x: number; y: number };
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
		const lines = csv
			.replace(/^\uFEFF/, "")
			.trim()
			.split(/\r?\n/);


		const headers = lines[0].split(",").map((value) => value.trim());

		const required = [
			"latitude",
			"longitude",
			"acq_date",
			"acq_time",
			"satellite",
			"confidence",
		];

		if (!required.every((name) => headers.includes(name))) {
			throw new Error(
				"Unexpected NASA response. Check your API key " +
				"and FIRMS data availability."
			);
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

			if (
				!/^\d{4}-\d{2}-\d{2}$/.test(row.acq_date) ||
				!/^\d{4}$/.test(time)
			) {
				continue;
			}

			const detected = Date.parse(
				`${row.acq_date}T${time.slice(0, 2)}:` +
				`${time.slice(2, 4)}:00Z`
			);

			if (
				longitude == null ||
				latitude == null ||
				Math.abs(longitude) > 180 ||
				Math.abs(latitude) > 90 ||
				!Number.isFinite(detected) ||
				detected < cutoff ||
				detected > now
			) {
				continue;
			}

			const key =
				`${row.satellite}|${detected}|${longitude}|${latitude}`;

			if (seen.has(key)) continue;
			seen.add(key);

			const confidence = row.confidence.toLowerCase();

			features.push({
				geometry: {
					x: longitude,
					y: latitude,
				},
				attributes: {
					OBJECTID: features.length + 1,
					acq_time: detected,
					satellite: row.satellite || "Not reported",
					confidence:
						confidence === "l" ? "Low" :
							confidence === "n" ? "Nominal" :
								confidence === "h" ? "High" :
									row.confidence || "Not reported",
					frp: optionalNumber(row.frp),
					bright_ti4: optionalNumber(row.bright_ti4),
					daynight: row.daynight,
				},
			});
		}
	}

	features.sort(
		(a, b) => b.attributes.acq_time - a.attributes.acq_time
	);

	return toGeoJSON({ features });
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

async function fetchPerimeters(): Promise<PerimeterCollection> {
	const features: FirePerimeter[] = [];
	const pageSize = 1000;
	let offset = 0;

	while (true) {
		const params = new URLSearchParams({
			f: "geojson",
			where: "attr_IncidentTypeCategory = 'WF'",
			outFields: [
				"OBJECTID",
				"poly_IncidentName",
				"poly_IRWINID",
				"poly_PolygonDateTime",
				"attr_IncidentTypeCategory",
				"attr_FireDiscoveryDateTime",
				"attr_PercentContained",
				"attr_ContainmentDateTime",
				"attr_ControlDateTime",
				"attr_FireOutDateTime",
				"attr_ModifiedOnDateTime_dt",
			].join(","),
			returnGeometry: "true",
			outSR: "4326",
			orderByFields: "OBJECTID ASC",
			resultOffset: String(offset),
			resultRecordCount: String(pageSize),
		});

		const response = await fetch(
			`${PERIMETER_ENDPOINT}?${params.toString()}`
		);

		if (!response.ok) {
			throw new Error(
				`Perimeter request failed (${response.status})`
			);
		}

		const data = await response.json();

		if (data.error) {
			throw new Error(
				data.error.message || "Unable to load perimeters"
			);
		}

		if (
			data.type !== "FeatureCollection" ||
			!Array.isArray(data.features)
		) {
			throw new Error("Unexpected perimeter response");
		}

		for (const feature of data.features) {
			if (
				feature.geometry?.type === "Polygon" ||
				feature.geometry?.type === "MultiPolygon"
			) {
				features.push(feature);
			}
		}

		const count = data.features.length;

		if (count === 0) break;

		offset += count;

		const more =
			data.exceededTransferLimit === true ||
			data.properties?.exceededTransferLimit === true;

		if (count < pageSize && !more) break;
	}

	return {
		type: "FeatureCollection",
		features,
	};
}

async function filterHotspotsToPerimeters(
	hotspots: FireCollection,
	perimeters: PerimeterCollection
): Promise<FireCollection> {
	const indexed = perimeters.features.map((perimeter) => ({
		perimeter,
		bounds: bbox(perimeter),
	}));

	const features: Hotspot[] = [];

	for (let i = 0; i < hotspots.features.length; i++) {
		if (i > 0 && i % 250 === 0) {
			await new Promise<void>((resolve) => setTimeout(resolve, 0));
		}

		const hotspot = hotspots.features[i];
		const [longitude, latitude] = hotspot.geometry.coordinates;

		const matches = indexed.some(({ perimeter, bounds }) => {
			const [west, south, east, north] = bounds;

			if (
				longitude < west ||
				longitude > east ||
				latitude < south ||
				latitude > north
			) {
				return false;
			}

			return booleanPointInPolygon(hotspot, perimeter);
		});

		if (matches) {
			features.push(hotspot);
		}
	}

	return {
		type: "FeatureCollection",
		features,
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
		timeZoneName: "short",
	});

	const minutes = Math.floor((Date.now() - value) / 60000);

	if (minutes < 0) return formatted;

	const age =
		minutes < 1 ? "less than a minute ago" :
			minutes < 60 ? `${minutes} minutes ago` :
				minutes < 1440 ? `${Math.floor(minutes / 60)} hours ago` :
					`${Math.floor(minutes / 1440)} days ago`;

	return `${formatted} (${age})`;
}

function readableSatellite(value: string) {
	const names: Record<string, string> = {
		N: "Suomi NPP",
		SNPP: "Suomi NPP",
		N20: "NOAA-20",
		"1": "NOAA-20",
		N21: "NOAA-21",
		"2": "NOAA-21",
	};

	return names[value.trim().toUpperCase()] ?? value;
}

function perimeterTimestamp(value: unknown): number | null {
	if (typeof value === "number") {
		return Number.isFinite(value) ? value : null;
	}

	if (typeof value === "string" && value.trim() !== "") {
		const timestamp = /^\d+$/.test(value.trim())
			? Number(value)
			: Date.parse(value);

		return Number.isFinite(timestamp) ? timestamp : null;
	}

	return null;
}

function readableContainment(value: unknown): string {
	if (
		value == null ||
		(typeof value !== "number" && typeof value !== "string") ||
		String(value).trim() === ""
	) {
		return "Not reported";
	}

	const percent = Number(value);

	if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
		return "Not reported";
	}

	return `${percent}% contained`;
}

export default function HomeScreen() {
	const [hours, setHours] = useState(24);
	const [fires, setFires] = useState<FireCollection>(EMPTY_DATA);
	const [perimeters, setPerimeters] =
		useState<PerimeterCollection>(EMPTY_PERIMETERS);
	const [selected, setSelected] = useState<Hotspot | null>(null);
	const [selectedPerimeter, setSelectedPerimeter] =
		useState<FirePerimeter | null>(null);
	const [showTechnical, setShowTechnical] = useState(false);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");


	const refresh = useCallback(async () => {
		setLoading(true);
		setError("");

		try {
			const [hotspotData, perimeterData] = await Promise.all([
				fetchFirms(hours),
				fetchPerimeters(),
			]);

			const filteredHotspots = await filterHotspotsToPerimeters(
				hotspotData,
				perimeterData
			);

			console.log("Wildfire matching:", {
				hours,
				nasaHotspots: hotspotData.features.length,
				perimeters: perimeterData.features.length,
				matchedHotspots: filteredHotspots.features.length,
			});

			setFires(filteredHotspots);
			setPerimeters(perimeterData);
			setSelected(null);
			setSelectedPerimeter(null);
		} catch (e) {
			setError(
				e instanceof Error ? e.message : "Unable to load fire data"
			);
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
				dragPan={true}
				touchZoom={true}
				doubleTapHoldZoom={false}
			>

				<GeoJSONSource
					id="wildfire-perimeters"
					data={perimeters}
					onPress={(event) => {
						event.stopPropagation();

						const pressed = event.nativeEvent.features.find(
							(feature) =>
								feature.geometry.type === "Polygon" ||
								feature.geometry.type === "MultiPolygon"
						);

						if (!pressed) return;

						const pressedId =
							pressed.properties?.OBJECTID ?? pressed.id;

						if (pressedId == null) return;

						const perimeter = perimeters.features.find(
							(feature) =>
								String(feature.properties.OBJECTID ?? feature.id) ===
								String(pressedId)
						);

						setSelected(null);
						setShowTechnical(false);
						setSelectedPerimeter(perimeter ?? null);
					}}
				>
					<Layer
						id="wildfire-perimeter-fill"
						type="fill"
						paint={{
							"fill-color": "#ff6b35",
							"fill-opacity": 0.2,
						}}
					/>

					<Layer
						id="wildfire-perimeter-outline"
						type="line"
						paint={{
							"line-color": "#ff9500",
							"line-width": 2,
						}}
					/>
				</GeoJSONSource>

				<Camera initialViewState={{ center: [-98.5795, 39.8283], zoom: 3 }} />

				<GeoJSONSource
					id="fire-hotspots"
					data={fires}
					cluster={true}
					clusterRadius={35}
					onPress={(event) => {
						event.stopPropagation();

						const pressed = event.nativeEvent.features.find(
							(feature) =>
								feature.geometry.type === "Point" &&
								feature.properties?.cluster !== true &&
								feature.properties?.id != null
						);

						if (!pressed) return;

						const hotspot = fires.features.find(
							(feature) =>
								String(feature.properties.id) ===
								String(pressed.properties?.id)
						);
						setShowTechnical(false);
						setSelectedPerimeter(null);
						setSelected(hotspot ?? null);
					}}

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
					Ignis
				</Text>

				<Text style={{ color: "#cbd5e1", marginTop: 4 }}>
					{loading
						? "Loading satellite detections..."
						: `${fires.features.length.toLocaleString()} hotspots • ${perimeters.features.length.toLocaleString()} perimeter features`
					}</Text>

				<View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
					{[24, 48, 168].map((value) => (
						<Pressable
							key={value}
							onPress={() => {
								console.log("Time button pressed:", value);
								setHours(value);
							}}
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

			{selectedPerimeter && (
				<View
					style={{
						position: "absolute",
						bottom: 24,
						left: 16,
						right: 16,
						maxHeight: "45%",
						backgroundColor: "#101820f5",
						borderRadius: 14,
						padding: 16,
					}}
				>
					<ScrollView>
						<Text
							style={{
								color: "white",
								fontSize: 20,
								fontWeight: "bold",
							}}
						>
							{String(
								selectedPerimeter.properties.poly_IncidentName ||
								"Fire name not reported"
							)}
						</Text>

						<Text style={{ color: "#ffd166", marginTop: 6 }}>
							Reported wildfire boundary
						</Text>

						<Text style={{ color: "#e2e8f0", marginTop: 16 }}>
							Classification: Reported wildfire
						</Text>

						<Text style={{ color: "#e2e8f0", marginTop: 12 }}>
							Reported containment:{" "}
							{readableContainment(
								selectedPerimeter.properties.attr_PercentContained
							)}
						</Text>

						<Text style={{ color: "#e2e8f0", marginTop: 12 }}>
							Incident record updated:
							{"\n"}
							{readableObservation(
								perimeterTimestamp(
									selectedPerimeter.properties.attr_ModifiedOnDateTime_dt
								)
							)}
						</Text>

						<Text style={{ color: "#e2e8f0", marginTop: 12 }}>
							Reported out date:
							{"\n"}
							{readableObservation(
								perimeterTimestamp(
									selectedPerimeter.properties.attr_FireOutDateTime
								)
							)}
						</Text>

						<Text style={{ color: "#94a3b8", marginTop: 12 }}>
							Containment is not the same as extinguishment.
							A missing out date does not confirm current burning.
						</Text>

						<Text style={{ color: "#e2e8f0", marginTop: 16 }}>
							Boundary captured:
							{"\n"}
							{readableObservation(
								perimeterTimestamp(
									selectedPerimeter.properties.poly_PolygonDateTime
								)
							)}
						</Text>

						<Text style={{ color: "#94a3b8", marginTop: 12 }}>
							This is the reported mapped fire extent. It does not
							mean the entire area is currently burning.
						</Text>

						<Text style={{ color: "#cbd5e1", marginTop: 12 }}>
							Boundary source: NIFC / WFIGS
						</Text>

						<Pressable
							onPress={() => setSelectedPerimeter(null)}
							style={{
								marginTop: 16,
								padding: 12,
								borderRadius: 8,
								backgroundColor: "#334155",
							}}
						>
							<Text style={{ color: "white", textAlign: "center" }}>
								Close
							</Text>
						</Pressable>
					</ScrollView>
				</View>
			)}
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
							Satellite observation:
							{"\n"}
							{readableObservation(selectedProperties.detected)}
							{"\n\n"}Satellite:{" "}
							{readableSatellite(selectedProperties.satellite)}
							{"\n"}Detection confidence: {selectedProperties.confidence}
						</Text>

						<Text style={{ color: "#94a3b8", marginTop: 8 }}>
							Confidence describes the quality of the satellite heat
							detection. It is not a wildfire risk rating.
						</Text>

						<Text style={{ color: "#94a3b8", marginTop: 8 }}>
							This detection falls within a reported wildfire perimeter.
							It does not establish that the location is still burning.
						</Text>

						<Pressable
							onPress={() => setShowTechnical((current) => !current)}
							style={{ marginTop: 12, paddingVertical: 8 }}
						>
							<Text style={{ color: "#ffd166", fontWeight: "600" }}>
								{showTechnical ? "Hide technical details" : "Show technical details"}
							</Text>
						</Pressable>

						{showTechnical && (
							<Text style={{ color: "#cbd5e1", marginTop: 8 }}>
								Coordinates: {selected?.geometry.coordinates[1].toFixed(5)},{" "}
								{selected?.geometry.coordinates[0].toFixed(5)}

								{"\n\n"}Fire radiative power:{" "}
								{selectedProperties.frp == null
									? "Not reported"
									: `${selectedProperties.frp} MW`}
								{"\n"}Estimated radiant heat output associated with the
								detection; not the fire's size.

								{"\n\n"}Satellite brightness temperature:{" "}
								{selectedProperties.brightness == null
									? "Not reported"
									: `${selectedProperties.brightness} K`}
								{"\n"}An infrared measurement, not a direct flame temperature.

								{"\n\n"}Observation period: {selectedProperties.daynight}
							</Text>
						)}

						<Pressable
							onPress={() => {
								setSelected(null);
								setSelectedPerimeter(null);
							}}
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
