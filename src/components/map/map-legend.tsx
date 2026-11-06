import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import type { Condition } from '@/lib/conditions';

type Props = {
  bottom: number;
  condition: Condition | null;
  conditionLoading: boolean;
  conditionError: string;
  planeCount: number | null;
  planeError: string;
};

/** Small info card, bottom-left, showing the active overlay's legend and data credits. */
export function MapLegend({
  bottom,
  condition,
  conditionLoading,
  conditionError,
  planeCount,
  planeError,
}: Props) {
  if (!condition && planeCount === null) return null;

  return (
    <View style={[styles.card, { bottom }]} pointerEvents="none">
      {condition && (
        <View style={styles.section}>
          <View style={styles.titleRow}>
            <Text style={styles.title}>{condition.label}</Text>
            {conditionLoading && <ActivityIndicator size="small" color="#f87171" />}
          </View>
          <View style={styles.swatches}>
            {condition.legend.map((item) => (
              <View key={item.label} style={styles.swatchItem}>
                <View style={[styles.swatch, { backgroundColor: item.color }]} />
                <Text style={styles.swatchLabel}>{item.label}</Text>
              </View>
            ))}
          </View>
          <Text style={styles.source}>{condition.source}</Text>
          {!!conditionError && <Text style={styles.error}>{conditionError}</Text>}
        </View>
      )}

      {planeCount !== null && (
        <View style={styles.section}>
          <Text style={styles.title}>{planeCount.toLocaleString()} aircraft in view</Text>
          <Text style={styles.source}>Aircraft data: adsb.fi</Text>
          {!!planeError && <Text style={styles.error}>{planeError}</Text>}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    position: 'absolute',
    left: 12,
    // Leaves room for the helper buttons on the right.
    right: 76,
    maxWidth: 320,
    backgroundColor: '#101820ee',
    borderRadius: 12,
    padding: 10,
    gap: 10,
  },
  section: {
    gap: 4,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    color: 'white',
    fontWeight: '700',
    fontSize: 14,
  },
  swatches: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  swatchItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  swatch: {
    width: 12,
    height: 12,
    borderRadius: 3,
  },
  swatchLabel: {
    color: '#e2e8f0',
    fontSize: 11,
  },
  source: {
    color: '#94a3b8',
    fontSize: 11,
  },
  error: {
    color: '#fca5a5',
    fontSize: 11,
  },
});
