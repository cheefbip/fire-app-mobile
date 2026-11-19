import type { LocationObject } from 'expo-location';
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { watchMapLocation, type MapLocationError } from '@/lib/map-location';

export function useMapLocation() {
  const [position, setPosition] = useState<LocationObject | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<MapLocationError | null>(null);
  const [attempt, setAttempt] = useState(0);
  const handledAttempt = useRef(0);

  useFocusEffect(useCallback(() => {
    let stop: (() => void) | undefined;
    let background = AppState.currentState === 'background';

    const start = () => {
      stop?.();
      setPosition(null);
      setError(null);
      setLoading(true);
      const requestPermission = attempt !== handledAttempt.current;
      handledAttempt.current = attempt;
      stop = watchMapLocation(
        (next) => {
          setPosition(next);
          setLoading(false);
        },
        (failure) => {
          setPosition(null);
          setError(failure);
          setLoading(false);
        },
        requestPermission,
      );
    };

    if (!background) start();
    const listener = AppState.addEventListener('change', (state) => {
      if (state === 'background') {
        background = true;
        stop?.();
        setPosition(null);
      } else if (state === 'active' && background) {
        background = false;
        start();
      }
      // An iOS permission dialog temporarily makes the app inactive; let it finish.
    });

    return () => {
      stop?.();
      listener.remove();
    };
  }, [attempt]));

  const retry = useCallback(() => {
    setAttempt((value) => value + 1);
  }, []);
  return { position, loading, error, retry };
}
