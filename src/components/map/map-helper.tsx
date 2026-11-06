import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useMapTheme } from '@/hooks/use-map-theme';
import { CONDITIONS, type ConditionId } from '@/lib/conditions';

type Props = {
  bottom: number;
  showPlanes: boolean;
  showFires: boolean;
  condition: ConditionId | null;
  onTogglePlanes: () => void;
  onToggleFires: () => void;
  onSelectCondition: (id: ConditionId | null) => void;
  /** Lets the screen hide other overlays while the conditions menu is open. */
  onExpandedChange?: (expanded: boolean) => void;
};

/**
 * Floating map controls, bottom-right just above the tab bar:
 *  1. Planes on/off   2. Fires on/off   3. Area conditions (expands a menu)
 */
export function MapHelper({
  bottom,
  showPlanes,
  showFires,
  condition,
  onTogglePlanes,
  onToggleFires,
  onSelectCondition,
  onExpandedChange,
}: Props) {
  const map = useMapTheme();
  const [expanded, setExpandedState] = useState(false);

  const setExpanded = (value: boolean) => {
    setExpandedState(value);
    onExpandedChange?.(value);
  };

  const select = (id: ConditionId) => {
    // Tapping the active condition again turns it off.
    onSelectCondition(condition === id ? null : id);
  };

  const clear = () => {
    onSelectCondition(null);
    setExpanded(false);
  };

  return (
    <View style={[styles.root, { bottom }]} pointerEvents="box-none">
      {expanded && (
        <View style={[styles.menu, { backgroundColor: map.panelSolid, borderColor: map.border }]}>
          <Text style={[styles.menuTitle, { color: map.textSubtle }]}>Area conditions</Text>
          {CONDITIONS.map((c) => {
            const active = condition === c.id;
            return (
              <Pressable
                key={c.id}
                onPress={() => select(c.id)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={({ pressed }) => [
                  styles.menuItem,
                  active && { backgroundColor: map.active },
                  pressed && styles.pressed,
                ]}>
                <SymbolView name={c.icon} size={18} tintColor={active ? map.onActive : map.text} />
                <Text style={[styles.menuLabel, { color: active ? map.onActive : map.text }]}>{c.label}</Text>
              </Pressable>
            );
          })}
          <Pressable
            onPress={clear}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.menuItem,
              styles.clearItem,
              { borderTopColor: map.divider },
              pressed && styles.pressed,
            ]}>
            <SymbolView
              name={{ ios: 'xmark.circle', android: 'layers_clear', web: 'layers_clear' }}
              size={18}
              tintColor={map.error}
            />
            <Text style={[styles.menuLabel, { color: map.error }]}>Clear</Text>
          </Pressable>
        </View>
      )}

      <View style={styles.stack}>
        <HelperButton
          label="Toggle aircraft"
          icon={{ ios: 'airplane', android: 'flight', web: 'flight' }}
          active={showPlanes}
          onPress={onTogglePlanes}
        />
        <HelperButton
          label="Toggle fires"
          icon={{ ios: 'flame.fill', android: 'local_fire_department', web: 'local_fire_department' }}
          active={showFires}
          onPress={onToggleFires}
        />
        <HelperButton
          label="Area conditions"
          icon={{ ios: 'square.3.layers.3d', android: 'layers', web: 'layers' }}
          active={expanded || condition !== null}
          onPress={() => setExpanded(!expanded)}
        />
      </View>
    </View>
  );
}

function HelperButton({
  label,
  icon,
  active,
  onPress,
}: {
  label: string;
  icon: SymbolViewProps['name'];
  active: boolean;
  onPress: () => void;
}) {
  const map = useMapTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      hitSlop={4}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: active ? map.active : map.panel, borderColor: map.border },
        pressed && styles.pressed,
      ]}>
      <SymbolView name={icon} size={22} tintColor={active ? map.onActive : map.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    right: 12,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  stack: {
    gap: 10,
  },
  button: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  menu: {
    borderRadius: 14,
    padding: 8,
    gap: 2,
    minWidth: 170,
    borderWidth: 1,
  },
  menuTitle: {
    fontSize: 12,
    fontWeight: '600',
    paddingHorizontal: 8,
    paddingTop: 4,
    paddingBottom: 6,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 9,
    paddingHorizontal: 10,
    borderRadius: 10,
  },
  clearItem: {
    marginTop: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderRadius: 0,
  },
  menuLabel: {
    fontSize: 15,
  },
  pressed: {
    opacity: 0.7,
  },
});
