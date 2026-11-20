import { useEffect, useState } from "react";

import { boundsCenter, boundsKey, distanceNm, type Bounds } from "@/lib/geo";

/**
 * Live aircraft positions from adsb.fi's open data API.
 * - Free, no key, personal / non-commercial use only.
 * - 1 request per second limit, max radius 250 NM.
 * - Their terms require crediting adsb.fi (shown on the map).
 * https://github.com/adsbfi/opendata
 */
const ADSB_ENDPOINT = "https://opendata.adsb.fi/api/v3";
const POLL_MS = 10_000;
const MAX_RADIUS_NM = 250;

export type AircraftCollection = GeoJSON.FeatureCollection<
	GeoJSON.Point,
	{
		hex: string;
		callsign: string;
		type: string;
		altitude: number | null;
		speed: number | null;
		track: number;
	}
>;

export const EMPTY_AIRCRAFT: AircraftCollection = {
	type: "FeatureCollection",
	features: [],
};

function toCollection(data: any): AircraftCollection {
	const list: any[] = Array.isArray(data?.ac)
		? data.ac
		: Array.isArray(data?.aircraft)
			? data.aircraft
			: [];
	const features: AircraftCollection["features"] = [];

	for (const a of list) {
		if (!Number.isFinite(a?.lat) || !Number.isFinite(a?.lon)) continue;
		if (a.alt_baro === "ground") continue; // skip planes parked or taxiing

		features.push({
			type: "Feature",
			id: a.hex,
			geometry: { type: "Point", coordinates: [a.lon, a.lat] },
			properties: {
				hex: String(a.hex ?? ""),
				callsign: String(a.flight ?? a.r ?? "").trim(),
				type: String(a.t ?? ""),
				altitude: Number.isFinite(a.alt_baro) ? a.alt_baro : null,
				speed: Number.isFinite(a.gs) ? a.gs : null,
				track: Number.isFinite(a.track)
					? a.track
					: Number.isFinite(a.true_heading)
						? a.true_heading
						: 0,
			},
		});
	}

	return { type: "FeatureCollection", features };
}

/** Polls aircraft around the current map view while `enabled` is true. */
export function useAircraft(enabled: boolean, bounds: Bounds) {
	const [aircraft, setAircraft] =
		useState<AircraftCollection>(EMPTY_AIRCRAFT);
	const [error, setError] = useState("");
	const key = boundsKey(bounds);

	useEffect(() => {
		if (!enabled) return;

		let cancelled = false;
		const center = boundsCenter(bounds);
		const corner: [number, number] = [bounds[2], bounds[3]];
		const radius = Math.max(
			5,
			Math.min(MAX_RADIUS_NM, Math.ceil(distanceNm(center, corner))),
		);
		const url = `${ADSB_ENDPOINT}/lat/${center[1].toFixed(4)}/lon/${center[0].toFixed(4)}/dist/${radius}`;

		const load = async () => {
			try {
				const response = await fetch(url);
				if (!response.ok)
					throw new Error(
						`Aircraft request failed (${response.status})`,
					);
				const result = toCollection(await response.json());
				if (!cancelled) {
					setAircraft(result);
					setError("");
				}
			} catch (e) {
				if (!cancelled)
					setError(
						e instanceof Error
							? e.message
							: "Unable to load aircraft",
					);
			}
		};

		// Small delay so a burst of pans only sends one request.
		const first = setTimeout(load, 400);
		const timer = setInterval(load, POLL_MS);
		return () => {
			cancelled = true;
			clearTimeout(first);
			clearInterval(timer);
		};
		// `key` stands in for `bounds` so small pans don't restart polling.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [enabled, key]);

	// Hidden while disabled. Turning planes back on shows the last positions
	// for a moment until the first fresh request lands.
	if (!enabled) return { aircraft: EMPTY_AIRCRAFT, error: "" };
	return { aircraft, error };
}
