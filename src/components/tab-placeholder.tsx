import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  title: string;
  icon: SymbolViewProps['name'];
  description: string;
  /** Short list of what this tab will do once it's built. */
  planned: string[];
  children?: ReactNode;
};

/** Temporary screen shown for tabs that aren't built yet. */
export function TabPlaceholder({ title, icon, description, planned, children }: Props) {
  const insets = useSafeAreaInsets();
  const theme = useTheme();

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.background }}
      contentContainerStyle={[
        styles.content,
        {
          paddingTop: insets.top + Spacing.five,
          paddingBottom: insets.bottom + BottomTabInset + Spacing.four,
        },
      ]}>
      <View style={styles.header}>
        <ThemedView type="backgroundElement" style={styles.iconBadge}>
          <SymbolView name={icon} size={30} tintColor={theme.text} />
        </ThemedView>
        <ThemedText type="subtitle">{title}</ThemedText>
        <ThemedView type="backgroundSelected" style={styles.comingSoon}>
          <ThemedText type="smallBold">Coming soon</ThemedText>
        </ThemedView>
        <ThemedText themeColor="textSecondary" style={styles.center}>
          {description}
        </ThemedText>
      </View>

      {children}

      <ThemedView type="backgroundElement" style={styles.card}>
        <ThemedText type="smallBold">Planned</ThemedText>
        {planned.map((item) => (
          <ThemedText key={item} type="small" themeColor="textSecondary">
            {'•  '}
            {item}
          </ThemedText>
        ))}
      </ThemedView>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: Spacing.four,
    gap: Spacing.four,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  header: {
    alignItems: 'center',
    gap: Spacing.three,
  },
  iconBadge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  comingSoon: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    borderRadius: Spacing.three,
  },
  center: {
    textAlign: 'center',
  },
  card: {
    padding: Spacing.three,
    borderRadius: Spacing.three,
    gap: Spacing.two,
  },
});
