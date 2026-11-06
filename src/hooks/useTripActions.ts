/** Rename / delete a finished trip through the repository port (components never touch storage). */
import { useCallback } from 'react';
import { useServices } from './useServices';

export function useTripActions(): {
  rename: (id: string, name: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
} {
  const { repository, clock } = useServices();
  const rename = useCallback(
    (id: string, name: string) => repository.renameTrip(id, name, clock.now()),
    [repository, clock],
  );
  // One transaction over trip + points + events (FR-14).
  const remove = useCallback((id: string) => repository.deleteTripCascade(id), [repository]);
  return { rename, remove };
}
