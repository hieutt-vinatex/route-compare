import { describe, expect, it } from 'vitest';
import { TRIP_STATUSES } from '../models/types';
import { canTransition, isActiveStatus, nextStatus, type TripCommand } from './stateMachine';

describe('trip state machine (SRS §6)', () => {
  it.each<[Parameters<typeof nextStatus>[0], TripCommand, ReturnType<typeof nextStatus>]>([
    ['IDLE', 'START', 'STARTING'],
    ['STARTING', 'GPS_OK', 'RECORDING'],
    ['STARTING', 'START_FAILED', 'IDLE'],
    ['STARTING', 'CANCEL', 'IDLE'],
    ['RECORDING', 'PAUSE', 'PAUSED'],
    ['PAUSED', 'RESUME', 'RECORDING'],
    ['RECORDING', 'END', 'FINALIZING'],
    ['PAUSED', 'END', 'FINALIZING'],
    ['RECORDING', 'FATAL_ERROR', 'INTERRUPTED'],
    ['INTERRUPTED', 'CONTINUE', 'RECORDING'],
    ['INTERRUPTED', 'END', 'FINALIZING'],
    ['FINALIZING', 'FINALIZED', 'COMPLETED'],
    ['FINALIZING', 'FINALIZE_FAILED', 'INTERRUPTED'],
    ['COMPLETED', 'RESET', 'IDLE'],
    ['IDLE', 'RESTORE_STARTING', 'STARTING'],
    ['IDLE', 'RESTORE_RECORDING', 'RECORDING'],
    ['IDLE', 'RESTORE_PAUSED', 'PAUSED'],
  ])('%s --%s--> %s', (from, command, to) => {
    expect(nextStatus(from, command)).toBe(to);
  });

  it.each<[Parameters<typeof nextStatus>[0], TripCommand]>([
    ['IDLE', 'END'],
    ['STARTING', 'END'], // no COMPLETED trip without a valid start fix
    ['STARTING', 'PAUSE'],
    ['COMPLETED', 'START'],
    ['FINALIZING', 'START'],
    ['RECORDING', 'START'],
  ])('rejects %s --%s-->', (from, command) => {
    expect(canTransition(from, command)).toBe(false);
  });

  it('hidden page / GPS gap are not transitions (no PAGE_HIDDEN command exists)', () => {
    for (const status of TRIP_STATUSES) {
      expect(nextStatus(status, 'PAGE_HIDDEN' as TripCommand)).toBeNull();
    }
  });

  it('classifies active statuses', () => {
    expect(isActiveStatus('RECORDING')).toBe(true);
    expect(isActiveStatus('INTERRUPTED')).toBe(true);
    expect(isActiveStatus('IDLE')).toBe(false);
    expect(isActiveStatus('COMPLETED')).toBe(false);
  });
});
