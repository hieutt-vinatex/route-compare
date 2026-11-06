/**
 * Home location preview (FR-01). Permission is only requested on a user action (BR-02):
 * we auto-locate only when the Permissions API already reports `granted`.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { hasSufficientAccuracy, hasValidRange } from '@/domain/geo/trackProcessor';
import type { GeoPermissionState, GpsError, RawGpsSample } from '@/domain/models/types';
import { useServices } from './useServices';

export type LocationPreviewStatus =
  | 'checking'
  | 'unsupported'
  | 'insecure'
  | 'needs-permission'
  | 'locating'
  | 'ready'
  | 'low-accuracy'
  | 'denied'
  | 'unavailable'
  | 'timeout';

export interface LocationPreview {
  readonly status: LocationPreviewStatus;
  readonly fix: RawGpsSample | null;
  readonly permission: GeoPermissionState;
  /** A fix exists that passed the range check (Start may be enabled). */
  readonly hasValidFix: boolean;
  readonly locate: () => void;
}

interface State {
  readonly status: LocationPreviewStatus;
  readonly fix: RawGpsSample | null;
  readonly permission: GeoPermissionState;
}

function errorStatus(error: unknown): LocationPreviewStatus {
  const code = (error as Partial<GpsError> | null)?.code;
  switch (code) {
    case 'PERMISSION_DENIED':
      return 'denied';
    case 'TIMEOUT':
      return 'timeout';
    case 'INSECURE_CONTEXT':
      return 'insecure';
    case 'UNSUPPORTED':
      return 'unsupported';
    default:
      return 'unavailable';
  }
}

export function useCurrentLocation(): LocationPreview {
  const { geolocation, config, isSecureContext } = useServices();
  const blocked: LocationPreviewStatus | null = !geolocation.isSupported()
    ? 'unsupported'
    : !isSecureContext
      ? 'insecure'
      : null;
  const [state, setState] = useState<State>(() => ({
    status: blocked ?? 'checking',
    fix: null,
    permission: 'unknown',
  }));
  const requestId = useRef(0);

  const locate = useCallback(() => {
    if (blocked !== null) return;
    requestId.current += 1;
    const id = requestId.current;
    setState((s) => ({ ...s, status: 'locating' }));
    geolocation
      .getCurrentPosition()
      .then((fix) => {
        if (id !== requestId.current) return;
        if (!hasValidRange(fix)) {
          setState((s) => ({ ...s, status: 'unavailable' }));
          return;
        }
        setState((s) => ({
          ...s,
          fix,
          permission: 'granted',
          status: hasSufficientAccuracy(fix, config) ? 'ready' : 'low-accuracy',
        }));
      })
      .catch((error: unknown) => {
        if (id !== requestId.current) return;
        const status = errorStatus(error);
        setState((s) => ({
          ...s,
          status,
          permission: status === 'denied' ? 'denied' : s.permission,
        }));
      });
  }, [blocked, geolocation, config]);

  useEffect(() => {
    if (blocked !== null) return;
    let cancelled = false;
    const applyPermission = (permission: GeoPermissionState): void => {
      setState((s) => {
        if (permission === 'denied') return { ...s, permission, status: 'denied' };
        if (s.status === 'checking' || s.status === 'denied') {
          return {
            ...s,
            permission,
            status: permission === 'granted' ? 'locating' : 'needs-permission',
          };
        }
        return { ...s, permission };
      });
    };
    void geolocation.queryPermission().then((permission) => {
      if (cancelled) return;
      applyPermission(permission);
      if (permission === 'granted') locate();
    });
    const unsubscribe = geolocation.onPermissionChange((permission) => {
      applyPermission(permission);
      if (permission === 'granted') locate();
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [blocked, geolocation, locate]);

  return {
    ...state,
    hasValidFix:
      state.fix !== null && (state.status === 'ready' || state.status === 'low-accuracy'),
    locate,
  };
}
