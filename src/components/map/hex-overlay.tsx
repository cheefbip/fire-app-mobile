import { memo, useMemo, useState, useSyncExternalStore } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Path, Polygon, Text as SvgText } from 'react-native-svg';

import {
  HEX_WIDTH_PX,
  screenHexes,
  shadeHexes,
  type GridCondition,
  type SampleCache,
} from '@/lib/conditions';
import type { MapViewStore } from '@/lib/map-view-store';

type HexOverlayProps = {
  condition: GridCondition;
  samples: SampleCache | undefined;
  view: MapViewStore;
  fillOpacity: number;
  borderColor: string;
  labelColor: string;
};

const RADIUS = HEX_WIDTH_PX / Math.sqrt(3);

/** SVG points for a pointy-top hex. */
function hexPoints(cx: number, cy: number) {
  const corners: string[] = [];
  for (let k = 0; k < 6; k++) {
    const angle = (Math.PI / 3) * k + Math.PI / 6;
    corners.push(`${(cx + RADIUS * Math.cos(angle)).toFixed(1)},${(cy + RADIUS * Math.sin(angle)).toFixed(1)}`);
  }
  return corners.join(' ');
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
  const f = (n: number) => n.toFixed(1);
  return (
    `M${f(tail[0])},${f(tail[1])}L${f(tip[0])},${f(tip[1])}` +
    `M${f(tip[0] + lx * head)},${f(tip[1] + ly * head)}L${f(tip[0])},${f(tip[1])}` +
    `L${f(tip[0] + rx * head)},${f(tip[1] + ry * head)}`
  );
}

type HexCellProps = {
  cx: number;
  cy: number;
  points: string;
  color: string | null;
  label: string | null;
  direction: number | null;
  fillOpacity: number;
  borderColor: string;
  labelColor: string;
};

// Memoized on plain values, so hexes whose color and number didn't change skip re-rendering.
const HexCell = memo(function HexCell({
  cx,
  cy,
  points,
  color,
  label,
  direction,
  fillOpacity,
  borderColor,
  labelColor,
}: HexCellProps) {
  if (color == null) return null;
  return (
    <>
      <Polygon
        points={points}
        fill={color}
        fillOpacity={fillOpacity}
        stroke={borderColor}
        strokeWidth={0.5}
      />
      {direction != null && (
        <Path
          d={arrowPath(cx, cy, direction)}
          stroke={labelColor}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      )}
      <SvgText
        x={cx}
        y={direction != null ? cy + RADIUS * 0.62 : cy + 4}
        fontSize={11}
        fontWeight="600"
        textAnchor="middle"
        fill={labelColor}>
        {label}
      </SvgText>
    </>
  );
});

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
        points: hexPoints(hex.cx, hex.cy),
      })),
    [size.width, size.height]
  );

  const shades = useMemo(
    () => shadeHexes(condition, samples, mapView, size.width, size.height, hexes),
    [condition, samples, mapView, size.width, size.height, hexes]
  );

  return (
    <View
      style={styles.overlay}
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        if (width !== size.width || height !== size.height) setSize({ width, height });
      }}>
      {size.width > 0 && (
        <Svg width={size.width} height={size.height}>
          {hexes.map((hex, i) => (
            <HexCell
              key={i}
              cx={hex.cx}
              cy={hex.cy}
              points={hex.points}
              color={shades[i]?.color ?? null}
              label={shades[i]?.label ?? null}
              direction={shades[i]?.direction ?? null}
              fillOpacity={fillOpacity}
              borderColor={borderColor}
              labelColor={labelColor}
            />
          ))}
        </Svg>
      )}
    </View>
  );
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
