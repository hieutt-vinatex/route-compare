/** DEV-only entry point, loaded with a dynamic import so it never ships in production builds. */
import type { Clock, GeolocationAdapter } from '@/domain/ports';
import { buildDemoRoute } from './demoRoute';
import { ReplayGeolocationAdapter } from './ReplayGeolocationAdapter';

export function createDemoGeolocation(clock: Clock): GeolocationAdapter {
  return new ReplayGeolocationAdapter(buildDemoRoute(), clock);
}
