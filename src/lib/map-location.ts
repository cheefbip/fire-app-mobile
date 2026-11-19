import * as Location from 'expo-location';

export type MapLocationError = { message: string; openSettings: boolean };

/** A foreground-only watch. The returned cleanup also cancels pending setup. */
export function watchMapLocation(
  onPosition: (position: Location.LocationObject) => void,
  onError: (error: MapLocationError) => void,
  requestPermission = false,
) {
  let stopped = false;
  let subscription: Location.LocationSubscription | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;

  const stop = () => {
    stopped = true;
    clearTimeout(timeout);
    subscription?.remove();
    subscription = undefined;
  };

  const fail = (message: string, openSettings = false) => {
    if (stopped) return;
    stop();
    onError({ message, openSettings });
  };

  const start = async () => {
    try {
      let permission = await Location.getForegroundPermissionsAsync();
      if (stopped) return;
      if (permission.status === 'undetermined' ||
          (!permission.granted && permission.canAskAgain && requestPermission)) {
        permission = await Location.requestForegroundPermissionsAsync();
      }
      if (stopped) return;
      if (!permission.granted) {
        fail('Allow location access to show your position on the map.', !permission.canAskAgain);
        return;
      }

      const enabled = await Location.hasServicesEnabledAsync();
      if (stopped) return;
      if (!enabled) {
        fail('Turn on your device’s location services, then try again.');
        return;
      }

      timeout = setTimeout(() => {
        fail('Your location could not be found. Move somewhere with a clear signal and try again.');
      }, 15000);

      const watch = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, distanceInterval: 10, timeInterval: 5000 },
        (position) => {
          if (stopped) return;
          const { longitude, latitude } = position.coords;
          // Ignore invalid or old cached fixes rather than centering on stale data.
          if (!Number.isFinite(longitude) || !Number.isFinite(latitude) ||
              Math.abs(longitude) > 180 || Math.abs(latitude) > 90 ||
              !Number.isFinite(position.timestamp) || Date.now() - position.timestamp > 30000) return;
          clearTimeout(timeout);
          onPosition(position);
        },
        () => fail('Location updates are unavailable. Check your location settings and try again.'),
      );
      if (stopped) watch.remove();
      else subscription = watch;
    } catch {
      fail('Unable to access your location. Check your location settings and try again.');
    }
  };

  void start();
  return stop;
}
