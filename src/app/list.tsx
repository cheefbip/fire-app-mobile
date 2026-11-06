import { StyleSheet, View } from 'react-native';

import { TabPlaceholder } from '@/components/tab-placeholder';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

const SORT_OPTIONS = ['Name', 'State', 'Size', 'Distance', 'Date'];

export default function ListScreen() {
  return (
    <TabPlaceholder
      title="Fire List"
      icon={{ ios: 'list.bullet', android: 'list', web: 'list' }}
      description="Recent and ongoing fires will be listed here."
      planned={[
        'Recent and ongoing fire incidents in one list',
        'Sort by name, state, size, distance or date',
        'Tap a fire to open it on the map',
      ]}>
      {/* Preview of the sort bar; not wired up yet. */}
      <View style={styles.sortRow}>
        <ThemedText type="small" themeColor="textSecondary">
          Sort by
        </ThemedText>
        {SORT_OPTIONS.map((option) => (
          <ThemedView key={option} type="backgroundElement" style={styles.chip}>
            <ThemedText type="small" themeColor="textSecondary">
              {option}
            </ThemedText>
          </ThemedView>
        ))}
      </View>
    </TabPlaceholder>
  );
}

const styles = StyleSheet.create({
  sortRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    opacity: 0.6,
  },
  chip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    borderRadius: Spacing.three,
  },
});
