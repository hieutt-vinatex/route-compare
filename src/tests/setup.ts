import '@testing-library/jest-dom/vitest';
// Dexie's liveQuery relies on the global indexedDB/IDBKeyRange (as in a real browser), so the
// fake is installed globally; UI tests use a unique database name per test for isolation.
import 'fake-indexeddb/auto';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Vitest runs without globals, so Testing Library cannot register its auto-cleanup.
afterEach(() => {
  cleanup();
});
