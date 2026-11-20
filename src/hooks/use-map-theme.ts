import { MapColors, type MapPalette } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

/** Map screen colors for the current light / dark setting. */
export function useMapTheme(): MapPalette {
  const scheme = useColorScheme();
  return MapColors[scheme === 'dark' ? 'dark' : 'light'];
}
