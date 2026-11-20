import type { MapView } from '@/lib/conditions';

/** Most often the overlay re-shades while the map is moving (~20 per second). */
const MIN_INTERVAL_MS = 50;

export type MapViewStore = {
  get: () => MapView;
  /** `immediate` skips the throttle, e.g. for the final position after a gesture. */
  set: (view: MapView, immediate?: boolean) => void;
  subscribe: (listener: () => void) => () => void;
};

/**
 * Holds where the map is looking, outside React state, so the map's many
 * per-frame region events update only the components that subscribe (with
 * `useSyncExternalStore`) instead of re-rendering the whole map screen.
 */
export function createMapViewStore(initial: MapView): MapViewStore {
  let latest = initial;
  let published = initial;
  let lastEmit = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const listeners = new Set<() => void>();

  const emit = () => {
    timer = null;
    lastEmit = Date.now();
    published = latest;
    listeners.forEach((listener) => listener());
  };

  return {
    get: () => published,
    set(view, immediate = false) {
      latest = view;
      if (immediate) {
        if (timer) clearTimeout(timer);
        emit();
        return;
      }
      if (timer) return;
      const wait = MIN_INTERVAL_MS - (Date.now() - lastEmit);
      if (wait <= 0) emit();
      else timer = setTimeout(emit, wait);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
