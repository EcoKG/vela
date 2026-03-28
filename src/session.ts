import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { getDb } from './db.js';
import { findProjectRoot } from './config.js';

// ── Types ──────────────────────────────────────────────────────────

export interface ChatSession {
  id: string;
  title: string | null;
  model: string;
  system: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChatMessageRow {
  id: number;
  session_id: string;
  role: string;
  display: string;
  content: unknown; // parsed JSON — ContentBlockParam[], string, etc.
  created_at: string;
}

export interface CreateSessionInput {
  model: string;
  system?: string | null;
  title?: string | null;
}

export interface UpdateSessionInput {
  title?: string;
  updated_at?: string;
}

export interface AddMessageInput {
  session_id: string;
  role: string;
  display: string;
  content: unknown; // will be JSON-stringified for storage
}

// ── Schema ─────────────────────────────────────────────────────────

/**
 * Creates session tables idempotently.
 * Safe to call on every connection open.
 */
export function ensureSessionSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_sessions (
      id         TEXT PRIMARY KEY,
      title      TEXT,
      model      TEXT NOT NULL,
      system     TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
      role       TEXT NOT NULL,
      display    TEXT NOT NULL,
      content    TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
}

// ── DB lifecycle ───────────────────────────────────────────────────

/**
 * Opens the session database.
 * - With velaDir: creates <velaDir>/sessions.db (file-backed, WAL mode)
 * - Without velaDir: in-memory database (for tests)
 * Tries to locate .vela/ via findProjectRoot when no velaDir is given
 * and a project root exists — but falls back to in-memory gracefully.
 *
 * Always enables foreign keys and runs schema creation.
 */
export function openSessionDb(velaDir?: string): Database.Database {
  let db: Database.Database;

  if (velaDir) {
    mkdirSync(velaDir, { recursive: true });
    const dbPath = join(velaDir, 'sessions.db');
    db = getDb(dbPath);
  } else {
    db = getDb(); // in-memory
  }

  db.pragma('foreign_keys = ON');
  ensureSessionSchema(db);
  return db;
}

// ── Session CRUD ───────────────────────────────────────────────────

/**
 * Creates a new chat session. Generates UUID id and timestamps.
 */
export function createSession(
  db: Database.Database,
  input: CreateSessionInput,
): ChatSession {
  const now = new Date().toISOString();
  const row: ChatSession = {
    id: randomUUID(),
    title: input.title ?? null,
    model: input.model,
    system: input.system ?? null,
    created_at: now,
    updated_at: now,
  };

  db.prepare(`
    INSERT INTO chat_sessions (id, title, model, system, created_at, updated_at)
    VALUES (@id, @title, @model, @system, @created_at, @updated_at)
  `).run(row);

  return row;
}

/**
 * Retrieves a session by id. Returns undefined if not found.
 */
export function getSession(
  db: Database.Database,
  id: string,
): ChatSession | undefined {
  return db.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(id) as
    | ChatSession
    | undefined;
}

/**
 * Lists sessions ordered by updated_at DESC.
 * Default limit is 20.
 */
export function listSessions(
  db: Database.Database,
  opts?: { limit?: number },
): ChatSession[] {
  const limit = opts?.limit ?? 20;
  return db
    .prepare('SELECT * FROM chat_sessions ORDER BY updated_at DESC LIMIT ?')
    .all(limit) as ChatSession[];
}

/**
 * Updates a session with the provided fields. Automatically updates `updated_at`.
 * Returns undefined if not found.
 */
export function updateSession(
  db: Database.Database,
  id: string,
  data: UpdateSessionInput,
): ChatSession | undefined {
  const existing = getSession(db, id);
  if (!existing) return undefined;

  const setClauses: string[] = [];
  const params: Record<string, unknown> = { id };

  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;
    setClauses.push(`${key} = @${key}`);
    params[key] = value;
  }

  // Always bump updated_at unless caller explicitly provided it
  if (!data.updated_at) {
    setClauses.push('updated_at = @updated_at');
    params.updated_at = new Date().toISOString();
  }

  if (setClauses.length === 0) return existing;

  db.prepare(
    `UPDATE chat_sessions SET ${setClauses.join(', ')} WHERE id = @id`,
  ).run(params);

  return getSession(db, id);
}

/**
 * Deletes a session by id. CASCADE removes associated messages.
 */
export function deleteSession(db: Database.Database, id: string): void {
  db.prepare('DELETE FROM chat_sessions WHERE id = ?').run(id);
}

/**
 * Returns the most recently updated session, or undefined if none exist.
 */
export function getLatestSession(
  db: Database.Database,
): ChatSession | undefined {
  return db
    .prepare('SELECT * FROM chat_sessions ORDER BY updated_at DESC LIMIT 1')
    .get() as ChatSession | undefined;
}

// ── Message CRUD ───────────────────────────────────────────────────

/**
 * Adds a message to a session. JSON-stringifies content.
 * Also bumps the session's updated_at timestamp.
 */
export function addMessage(
  db: Database.Database,
  input: AddMessageInput,
): ChatMessageRow {
  const now = new Date().toISOString();

  const result = db
    .prepare(
      `INSERT INTO chat_messages (session_id, role, display, content, created_at)
       VALUES (@session_id, @role, @display, @content, @created_at)`,
    )
    .run({
      session_id: input.session_id,
      role: input.role,
      display: input.display,
      content: JSON.stringify(input.content),
      created_at: now,
    });

  // Bump session updated_at
  db.prepare(
    'UPDATE chat_sessions SET updated_at = ? WHERE id = ?',
  ).run(now, input.session_id);

  return {
    id: Number(result.lastInsertRowid),
    session_id: input.session_id,
    role: input.role,
    display: input.display,
    content: input.content,
    created_at: now,
  };
}

/**
 * Returns all messages for a session ordered by id ASC.
 * Parses content JSON back into objects.
 */
export function getMessages(
  db: Database.Database,
  sessionId: string,
): ChatMessageRow[] {
  const rows = db
    .prepare(
      'SELECT * FROM chat_messages WHERE session_id = ? ORDER BY id ASC',
    )
    .all(sessionId) as Array<Record<string, unknown>>;

  return rows.map((row) => ({
    id: row.id as number,
    session_id: row.session_id as string,
    role: row.role as string,
    display: row.display as string,
    content: JSON.parse(row.content as string) as unknown,
    created_at: row.created_at as string,
  }));
}
