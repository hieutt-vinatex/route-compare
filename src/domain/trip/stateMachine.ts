/**
 * Trip state machine — docs/02-SRS.md §6.
 *
 * IDLE --START--> STARTING --GPS_OK--> RECORDING
 *                   |  RECORDING --PAUSE--> PAUSED --RESUME--> RECORDING
 *                   |  RECORDING/PAUSED --END--> FINALIZING --FINALIZED--> COMPLETED
 *                   |  RECORDING/PAUSED --FATAL_ERROR--> INTERRUPTED
 *                   |--START_FAILED/CANCEL--> IDLE
 * INTERRUPTED --CONTINUE--> RECORDING (new segment) | --END--> FINALIZING
 * FINALIZING --FINALIZE_FAILED--> INTERRUPTED (track kept, never deleted)
 *
 * PAGE_HIDDEN / GPS gaps are NOT transitions: the trip stays RECORDING and the
 * missing interval is UNKNOWN.
 */
import type { TripStatus } from '../models/types';

export type TripCommand =
  | 'START'
  | 'GPS_OK'
  | 'START_FAILED'
  | 'CANCEL'
  | 'PAUSE'
  | 'RESUME'
  | 'END'
  | 'FATAL_ERROR'
  | 'CONTINUE'
  | 'FINALIZED'
  | 'FINALIZE_FAILED'
  | 'RESET'
  // Reload recovery (FR-12): re-enter the persisted state of an unfinished trip.
  | 'RESTORE_STARTING'
  | 'RESTORE_RECORDING'
  | 'RESTORE_PAUSED'
  // Another tab took over the recorder lock: this tab stops writing at once (RT-206).
  | 'ABANDON';

const TRANSITIONS: Readonly<
  Record<TripStatus, Readonly<Partial<Record<TripCommand, TripStatus>>>>
> = {
  IDLE: {
    START: 'STARTING',
    RESTORE_STARTING: 'STARTING',
    RESTORE_RECORDING: 'RECORDING',
    RESTORE_PAUSED: 'PAUSED',
  },
  STARTING: { GPS_OK: 'RECORDING', START_FAILED: 'IDLE', CANCEL: 'IDLE', ABANDON: 'IDLE' },
  RECORDING: {
    PAUSE: 'PAUSED',
    END: 'FINALIZING',
    FATAL_ERROR: 'INTERRUPTED',
    ABANDON: 'IDLE',
  },
  PAUSED: { RESUME: 'RECORDING', END: 'FINALIZING', FATAL_ERROR: 'INTERRUPTED', ABANDON: 'IDLE' },
  INTERRUPTED: { CONTINUE: 'RECORDING', END: 'FINALIZING', ABANDON: 'IDLE' },
  FINALIZING: { FINALIZED: 'COMPLETED', FINALIZE_FAILED: 'INTERRUPTED', ABANDON: 'IDLE' },
  COMPLETED: { RESET: 'IDLE' },
};

/** Next status, or null when the command is not allowed from `status`. */
export function nextStatus(status: TripStatus, command: TripCommand): TripStatus | null {
  return TRANSITIONS[status][command] ?? null;
}

export function canTransition(status: TripStatus, command: TripCommand): boolean {
  return nextStatus(status, command) !== null;
}

/** States in which a trip exists and is not yet completed. */
export const ACTIVE_STATUSES: readonly TripStatus[] = [
  'STARTING',
  'RECORDING',
  'PAUSED',
  'FINALIZING',
  'INTERRUPTED',
];

export function isActiveStatus(status: TripStatus): boolean {
  return ACTIVE_STATUSES.includes(status);
}
