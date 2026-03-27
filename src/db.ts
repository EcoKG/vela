import Database from 'better-sqlite3';

/**
 * Opens a SQLite database at the given path.
 * Uses :memory: if no path is provided.
 * Sets WAL journal mode when a file path is given.
 */
export function getDb(dbPath?: string): Database.Database {
  const effectivePath = dbPath ?? ':memory:';
  const db = new Database(effectivePath);

  if (effectivePath !== ':memory:') {
    db.pragma('journal_mode = WAL');
  }

  return db;
}

/**
 * Closes the database connection.
 */
export function closeDb(db: Database.Database): void {
  db.close();
}
