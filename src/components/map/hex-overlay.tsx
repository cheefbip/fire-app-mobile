import { memo, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Path, Text as SvgText } from 'react-native-svg';

import {
  HEX_WIDTH_PX,
  screenHexes,
  shadeHexes,
  useConditionSamples,
  type Condition,
  type GridCondition,
  type SampleCache,
} from '@/lib/conditions';
import type { Bounds } from '@/lib/geo';
import type { MapViewStore } from '@/lib/map-view-store';

// Performance notes. The overlay re-shades up to ~20 times a second while the
// map moves, so it keeps the number of SVG elements that change small:
// - Fills are drawn as one <Path> per color (colors snap to a small palette in
//   conditions.ts), so ~20–40 elements instead of one polygon per hex.
// - Each label is its own memoized component and only re-renders when its
//   number changes; all wind arrows share one <Path>.
// - Downloaded samples live in HexLayer, not the map screen, so new data
//   re-renders only this overlay.

const RADIUS = HEX_WIDTH_PX / Math.sqrt(3);
const f = (n: number) => n.toFixed(1);

/** SVG path for a pointy-top hex. */
function hexPath(cx: number, cy: number) {
  let d = '';
  for (let k = 0; k < 6; k++) {
    const angle = (Math.PI / 3) * k + Math.PI / 6;
    d += `${k === 0 ? 'M' : 'L'}${f(cx + RADIUS * Math.cos(angle))},${f(cy + RADIUS * Math.sin(angle))}`;
  }
  return `${d}Z`;
}

/** Arrow pointing the way the wind blows ("from" + 180°), sitting in the hex's upper half. */
function arrowPath(cx: number, cy: number, fromDeg: number) {
  const b = ((fromDeg + 180) % 360) * (Math.PI / 180);
  // Screen y points down, and north is always up.
  const dir = (angle: number): [number, number] => [Math.sin(angle), -Math.cos(angle)];
  const half = RADIUS * 0.38;
  const head = RADIUS * 0.26;
  const mid: [number, number] = [cx, cy - RADIUS * 0.22];
  const [ux, uy] = dir(b);
  const tail = [mid[0] - ux * half, mid[1] - uy * half];
  const tip = [mid[0] + ux * half, mid[1] + uy * half];
  const [lx, ly] = dir(b + Math.PI - 0.5);
  const [rx, ry] = dir(b + Math.PI + 0.5);
  return (
    `M${f(tail[0])},${f(tail[1])}L${f(tip[0])},${f(tip[1])}` +
    `M${f(tip[0] + lx * head)},${f(tip[1] + ly * head)}L${f(tip[0])},${f(tip[1])}` +
    `L${f(tip[0] + rx * head)},${f(tip[1] + ry * head)}`
  );
}

/** Every hex of one color, as a single path. Re-renders only when its set of hexes changes. */
const FillGroup = memo(function FillGroup({
  d,
  color,
  fillOpacity,
  borderColor,
}: {
  d: string;
  color: string;
  fillOpacity: number;
  borderColor: string;
}) {
  return <Path d={d} fill={color} fillOpacity={fillOpacity} stroke={borderColor} strokeWidth={0.5} />;
});

/** One hex's number. Re-renders only when the number or its position changes. */
const HexLabel = memo(function HexLabel({
  x,
  y,
  label,
  color,
}: {
  x: number;
  y: number;
  label: string;
  color: string;
}) {
  return (
    <SvgText x={x} y={y} fontSize={11} fontWeight="600" textAnchor="middle" fill={color}>
      {label}
    </SvgText>
  );
});

const Arrows = memo(function Arrows({ d, color }: { d: string; color: string }) {
  if (!d) return null;
  return (
    <Path
      d={d}
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />
  );
});

type HexOverlayProps = {
  condition: GridCondition;
  samples: SampleCache | undefined;
  view: MapViewStore;
  fillOpacity: number;
  borderColor: string;
  labelColor: string;
};

/**
 * A honeycomb fixed to the screen, drawn over the map. The hexes never move;
 * as the map pans and zooms underneath, each one is re-shaded from whatever
 * samples are cached: color blended from nearby samples, number and wind
 * arrow from the nearest one. Touches pass straight through to the map.
 */
export function HexOverlay({
  condition,
  samples,
  view,
  fillOpacity,
  borderColor,
  labelColor,
}: HexOverlayProps) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const mapView = useSyncExternalStore(view.subscribe, view.get, view.get);

  const hexes = useMemo(
    () =>
      screenHexes(size.width, size.height).map((hex) => ({
        ...hex,
        path: hexPath(hex.cx, hex.cy),
      })),
    [size.width, size.height]
  );

  const shades = useMemo(
    () => shadeHexes(condition, samples, mapView, size.width, size.height, hexes),
    [condition, samples, mapView, size.width, size.height, hexes]
  );

  // Group fills by color and join all arrows into one path.
  const { fills, arrows } = useMemo(() => {
    const byColor = new Map<string, string>();
    let arrowD = '';
    shades.forEach((shade, i) => {
      if (!shade) return;
      const hex = hexes[i];
      byColor.set(shade.color, (byColor.get(shade.color) ?? '') + hex.path);
      if (shade.direction != null) arrowD += arrowPath(hex.cx, hex.cy, shade.direction);
    });
    return { fills: [...byColor], arrows: arrowD };
  }, [shades, hexes]);

  return (
    <View
      style={styles.overlay}
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        if (width !== size.width || height !== size.height) setSize({ width, height });
      }}>
      {size.width > 0 && (
        <Svg width={size.width} height={size.height}>
          {fills.map(([color, d]) => (
            <FillGroup
              key={color}
              d={d}
              color={color}
              fillOpacity={fillOpacity}
              borderColor={borderColor}
            />
          ))}
          <Arrows d={arrows} color={labelColor} />
          {hexes.map((hex, i) => {
            const shade = shades[i];
            if (!shade) return null;
            return (
              <HexLabel
                key={i}
                x={hex.cx}
                y={shade.direction != null ? hex.cy + RADIUS * 0.62 : hex.cy + 4}
                label={shade.label}
                color={labelColor}
              />
            );
          })}
        </Svg>
      )}
    </View>
  );
}

export type HexStatus = { loading: boolean; error: string };

const IDLE: HexStatus = { loading: false, error: '' };

type HexLayerProps = Omit<HexOverlayProps, 'condition' | 'samples'> & {
  condition: Condition | null;
  bounds: Bounds;
  zoom: number;
  /** Called when loading or error changes, for the legend card. */
  onStatusChange: (status: HexStatus) => void;
};

/**
 * Owns the downloaded samples and draws the overlay for grid conditions.
 * Keep it mounted even when no grid condition is active, so the cache
 * survives switching to another layer and back.
 */
export function HexLayer({ condition, bounds, zoom, onStatusChange, ...overlay }: HexLayerProps) {
  const { samples, loading, error } = useConditionSamples(condition, bounds, zoom);

  useEffect(() => {
    onStatusChange({ loading, error });
  }, [loading, error, onStatusChange]);
  useEffect(() => () => onStatusChange(IDLE), [onStatusChange]);

  if (condition?.kind !== 'grid') return null;
  return <HexOverlay condition={condition} samples={samples} {...overlay} />;
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    pointerEvents: 'none',
  },
});
