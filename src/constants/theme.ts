/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#000000',
    background: '#ffffff',
    backgroundElement: '#F0F0F3',
    backgroundSelected: '#E0E1E6',
    textSecondary: '#60646C',
  },
  dark: {
    text: '#ffffff',
    background: '#000000',
    backgroundElement: '#212225',
    backgroundSelected: '#2E3135',
    textSecondary: '#B0B4BA',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

/**
 * Colors for the map screen: the basemap, floating panels over the map, and
 * labels drawn on the map itself. Kept apart from `Colors` because panels sit
 * on top of map imagery and need translucency and stronger contrast.
 */
export const MapColors = {
  light: {
    basemap: 'https://tiles.openfreemap.org/styles/liberty',
    /** Shown behind the map before tiles load. */
    screen: '#e5e7eb',
    /** Header, legend, idle helper buttons. */
    panel: '#ffffffee',
    /** Detail cards and the conditions menu. */
    panelSolid: '#fffffff7',
    border: '#0f172a1f',
    divider: '#0f172a26',
    text: '#0f172a',
    textBody: '#1e293b',
    textMuted: '#475569',
    textSubtle: '#64748b',
    button: '#e2e8f0',
    buttonStrong: '#cbd5e1',
    /** Highlight text, e.g. "Show technical details". */
    accent: '#b45309',
    error: '#b91c1c',
    active: '#dc2626',
    onActive: '#ffffff',
    spinner: '#dc2626',
    /** Text and wind arrows drawn on the map. */
    mapLabel: '#0f172a',
    mapLabelHalo: '#ffffffcc',
    gridOpacity: 0.38,
  },
  dark: {
    basemap: 'https://tiles.openfreemap.org/styles/dark',
    screen: '#101820',
    panel: '#101820ee',
    panelSolid: '#101820f5',
    border: '#ffffff22',
    divider: '#ffffff33',
    text: '#ffffff',
    textBody: '#e2e8f0',
    textMuted: '#cbd5e1',
    textSubtle: '#94a3b8',
    button: '#334155',
    buttonStrong: '#475569',
    accent: '#ffd166',
    error: '#fca5a5',
    active: '#dc2626',
    onActive: '#ffffff',
    spinner: '#f87171',
    mapLabel: '#f1f5f9',
    mapLabelHalo: '#0f172acc',
    // Colored cells read stronger on dark tiles, so they need less opacity.
    gridOpacity: 0.32,
  },
} as const;

export type MapPalette = (typeof MapColors)['light' | 'dark'];

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80, web: 64 }) ?? 0;
export const MaxContentWidth = 800;
