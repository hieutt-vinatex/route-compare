export type PersistenceStatus = 'persistent' | 'best-effort' | 'denied' | 'unsupported' | 'error';

type StorageApi = Partial<Pick<StorageManager, 'persist' | 'persisted'>>;

/** Only inspect on mount. A persistence request must come from an explicit user action. */
export async function readPersistence(
  storage: StorageApi | null | undefined = navigator.storage,
): Promise<PersistenceStatus> {
  try {
    if (typeof storage?.persisted !== 'function' || typeof storage.persist !== 'function') {
      return 'unsupported';
    }
    return (await storage.persisted()) ? 'persistent' : 'best-effort';
  } catch {
    return 'error';
  }
}

export async function requestPersistence(
  storage: StorageApi | null | undefined = navigator.storage,
): Promise<PersistenceStatus> {
  const current = await readPersistence(storage);
  if (current !== 'best-effort') return current;
  try {
    return (await storage?.persist?.()) ? 'persistent' : 'denied';
  } catch {
    return 'error';
  }
}
