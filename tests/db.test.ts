import { describe, it, expect } from 'vitest';
import { getDb, closeDb } from '../src/db.js';

describe('better-sqlite3 ESM interop', () => {
  it('creates in-memory database', () => {
    const db = getDb();
    expect(db).toBeTruthy();

    const result = db.pragma('journal_mode');
    expect(result).toBeDefined();
    expect(result.length).toBeGreaterThan(0);

    closeDb(db);
  });

  it('opens and closes without error', () => {
    const db = getDb();
    closeDb(db);
  });
});
