import type { Clock, IdGenerator, Timers } from '@/domain/ports';

export const systemClock: Clock = {
  now: () => Date.now(),
};

/**
 * UUID v4. crypto.randomUUID only exists in secure contexts, so fall back to getRandomValues
 * (available everywhere) — the app must still load over plain HTTP to show the HTTPS warning.
 */
export function uuidV4(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export const uuidGenerator: IdGenerator = {
  next: uuidV4,
};

/** Browser timers for the TrackingController UI tick (injected so the domain stays pure). */
export const browserTimers: Timers = {
  setInterval: (callback, ms) => window.setInterval(callback, ms),
  clearInterval: (handle) => {
    window.clearInterval(handle as number);
  },
  setTimeout: (callback, ms) => window.setTimeout(callback, ms),
  clearTimeout: (handle) => {
    window.clearTimeout(handle as number);
  },
};

/** Internal-error sink. Messages only — callers never pass coordinates. */
export const consoleLogger = {
  error: (message: string): void => {
    console.error(message);
  },
};
