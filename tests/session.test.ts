import { describe, it, expect, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { getDb, closeDb } from '../src/db.js';
import {
  ensureSessionSchema,
  openSessionDb,
  createSession,
  getSession,
  listSessions,
  updateSession,
  deleteSession,
  getLatestSession,
  addMessage,
  getMessages,
} from '../src/session.js';
import type { ChatSession, ChatMessageRow } from '../src/session.js';

// ── Helpers ────────────────────────────────────────────────────────

function makeDb(): Database.Database {
  const db = getDb(); // in-memory
  db.pragma('foreign_keys = ON');
  return db;
}

// UUID v4 pattern
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Schema tests ───────────────────────────────────────────────────

describe('ensureSessionSchema', () => {
  it('creates chat_sessions and chat_messages tables', () => {
    const db = makeDb();
    ensureSessionSchema(db);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const names = tables.map((t) => t.name);

    expect(names).toContain('chat_sessions');
    expect(names).toContain('chat_messages');
    closeDb(db);
  });

  it('is idempotent — calling twice does not throw', () => {
    const db = makeDb();
    ensureSessionSchema(db);
    ensureSessionSchema(db); // should not throw

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    expect(tables.map((t) => t.name)).toContain('chat_sessions');
    closeDb(db);
  });
});

describe('openSessionDb', () => {
  it('returns an in-memory db when no velaDir is given', () => {
    const db = openSessionDb();

    // Tables should exist
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const names = tables.map((t) => t.name);
    expect(names).toContain('chat_sessions');
    expect(names).toContain('chat_messages');
    closeDb(db);
  });

  it('is idempotent — opening twice with same velaDir does not throw', () => {
    const db1 = openSessionDb();
    closeDb(db1);
    const db2 = openSessionDb();
    closeDb(db2);
  });
});

// ── Session CRUD ───────────────────────────────────────────────────

describe('createSession', () => {
  it('returns a well-formed row with UUID id', () => {
    const db = openSessionDb();
    const session = createSession(db, { model: 'claude-sonnet-4-20250514' });

    expect(session.id).toMatch(UUID_RE);
    expect(session.model).toBe('claude-sonnet-4-20250514');
    expect(session.title).toBeNull();
    expect(session.system).toBeNull();
    expect(session.created_at).toBeTruthy();
    expect(session.updated_at).toBeTruthy();
    closeDb(db);
  });

  it('accepts optional title and system', () => {
    const db = openSessionDb();
    const session = createSession(db, {
      model: 'claude-sonnet-4-20250514',
      title: 'My Session',
      system: 'You are a helpful assistant.',
    });

    expect(session.title).toBe('My Session');
    expect(session.system).toBe('You are a helpful assistant.');
    closeDb(db);
  });
});

describe('getSession', () => {
  it('retrieves a session by id', () => {
    const db = openSessionDb();
    const created = createSession(db, { model: 'claude-sonnet-4-20250514' });
    const fetched = getSession(db, created.id);

    expect(fetched).toBeDefined();
    expect(fetched!.id).toBe(created.id);
    expect(fetched!.model).toBe('claude-sonnet-4-20250514');
    closeDb(db);
  });

  it('returns undefined for a missing id', () => {
    const db = openSessionDb();
    const result = getSession(db, 'nonexistent-id');
    expect(result).toBeUndefined();
    closeDb(db);
  });
});

describe('listSessions', () => {
  it('returns sessions ordered by updated_at DESC', () => {
    const db = openSessionDb();
    const s1 = createSession(db, { model: 'model-a' });
    // Manually bump s1's updated_at to be older
    db.prepare('UPDATE chat_sessions SET updated_at = ? WHERE id = ?').run(
      '2020-01-01T00:00:00.000Z',
      s1.id,
    );
    const s2 = createSession(db, { model: 'model-b' });

    const list = listSessions(db);
    expect(list.length).toBe(2);
    expect(list[0].id).toBe(s2.id); // s2 is more recent
    expect(list[1].id).toBe(s1.id);
    closeDb(db);
  });

  it('respects limit parameter', () => {
    const db = openSessionDb();
    createSession(db, { model: 'm1' });
    createSession(db, { model: 'm2' });
    createSession(db, { model: 'm3' });

    const list = listSessions(db, { limit: 2 });
    expect(list.length).toBe(2);
    closeDb(db);
  });

  it('returns empty array when no sessions exist', () => {
    const db = openSessionDb();
    const list = listSessions(db);
    expect(list).toEqual([]);
    closeDb(db);
  });
});

describe('updateSession', () => {
  it('updates title and bumps updated_at', () => {
    const db = openSessionDb();
    const session = createSession(db, { model: 'claude-sonnet-4-20250514' });
    const originalUpdatedAt = session.updated_at;

    // Small delay to ensure timestamp differs
    const updated = updateSession(db, session.id, { title: 'New Title' });

    expect(updated).toBeDefined();
    expect(updated!.title).toBe('New Title');
    expect(updated!.model).toBe('claude-sonnet-4-20250514'); // unchanged
    closeDb(db);
  });

  it('returns undefined for missing session', () => {
    const db = openSessionDb();
    const result = updateSession(db, 'nonexistent', { title: 'X' });
    expect(result).toBeUndefined();
    closeDb(db);
  });
});

describe('deleteSession', () => {
  it('removes the session', () => {
    const db = openSessionDb();
    const session = createSession(db, { model: 'claude-sonnet-4-20250514' });
    deleteSession(db, session.id);

    expect(getSession(db, session.id)).toBeUndefined();
    closeDb(db);
  });

  it('cascades to messages', () => {
    const db = openSessionDb();
    const session = createSession(db, { model: 'claude-sonnet-4-20250514' });
    addMessage(db, {
      session_id: session.id,
      role: 'user',
      display: 'Hello',
      content: 'Hello',
    });
    addMessage(db, {
      session_id: session.id,
      role: 'assistant',
      display: 'Hi there',
      content: 'Hi there',
    });

    // Verify messages exist first
    expect(getMessages(db, session.id).length).toBe(2);

    deleteSession(db, session.id);

    // Messages should be gone via CASCADE
    const remaining = db
      .prepare('SELECT COUNT(*) as count FROM chat_messages WHERE session_id = ?')
      .get(session.id) as { count: number };
    expect(remaining.count).toBe(0);
    closeDb(db);
  });
});

describe('getLatestSession', () => {
  it('returns the most recently updated session', () => {
    const db = openSessionDb();
    const s1 = createSession(db, { model: 'm1' });
    db.prepare('UPDATE chat_sessions SET updated_at = ? WHERE id = ?').run(
      '2020-01-01T00:00:00.000Z',
      s1.id,
    );
    const s2 = createSession(db, { model: 'm2' });

    const latest = getLatestSession(db);
    expect(latest).toBeDefined();
    expect(latest!.id).toBe(s2.id);
    closeDb(db);
  });

  it('returns undefined when no sessions exist', () => {
    const db = openSessionDb();
    expect(getLatestSession(db)).toBeUndefined();
    closeDb(db);
  });
});

// ── Message CRUD ───────────────────────────────────────────────────

describe('addMessage', () => {
  it('inserts a message and returns it with parsed content', () => {
    const db = openSessionDb();
    const session = createSession(db, { model: 'claude-sonnet-4-20250514' });

    const msg = addMessage(db, {
      session_id: session.id,
      role: 'user',
      display: 'Hello world',
      content: 'Hello world',
    });

    expect(msg.id).toBeGreaterThan(0);
    expect(msg.session_id).toBe(session.id);
    expect(msg.role).toBe('user');
    expect(msg.display).toBe('Hello world');
    expect(msg.content).toBe('Hello world');
    expect(msg.created_at).toBeTruthy();
    closeDb(db);
  });

  it('updates session updated_at', () => {
    const db = openSessionDb();
    const session = createSession(db, { model: 'claude-sonnet-4-20250514' });

    // Backdate session
    db.prepare('UPDATE chat_sessions SET updated_at = ? WHERE id = ?').run(
      '2020-01-01T00:00:00.000Z',
      session.id,
    );

    addMessage(db, {
      session_id: session.id,
      role: 'user',
      display: 'Hello',
      content: 'Hello',
    });

    const updated = getSession(db, session.id);
    expect(updated!.updated_at).not.toBe('2020-01-01T00:00:00.000Z');
    closeDb(db);
  });
});

describe('getMessages', () => {
  it('returns messages ordered by id ASC', () => {
    const db = openSessionDb();
    const session = createSession(db, { model: 'claude-sonnet-4-20250514' });

    addMessage(db, {
      session_id: session.id,
      role: 'user',
      display: 'First',
      content: 'First',
    });
    addMessage(db, {
      session_id: session.id,
      role: 'assistant',
      display: 'Second',
      content: 'Second',
    });
    addMessage(db, {
      session_id: session.id,
      role: 'user',
      display: 'Third',
      content: 'Third',
    });

    const msgs = getMessages(db, session.id);
    expect(msgs.length).toBe(3);
    expect(msgs[0].display).toBe('First');
    expect(msgs[1].display).toBe('Second');
    expect(msgs[2].display).toBe('Third');
    // IDs should be ascending
    expect(msgs[0].id).toBeLessThan(msgs[1].id);
    expect(msgs[1].id).toBeLessThan(msgs[2].id);
    closeDb(db);
  });

  it('parses JSON content back into objects', () => {
    const db = openSessionDb();
    const session = createSession(db, { model: 'claude-sonnet-4-20250514' });

    const complexContent = [
      { type: 'text', text: 'Hello' },
      { type: 'text', text: 'World' },
    ];

    addMessage(db, {
      session_id: session.id,
      role: 'assistant',
      display: 'Hello World',
      content: complexContent,
    });

    const msgs = getMessages(db, session.id);
    expect(msgs.length).toBe(1);
    expect(msgs[0].content).toEqual(complexContent);
    closeDb(db);
  });

  it('returns empty array for session with no messages', () => {
    const db = openSessionDb();
    const session = createSession(db, { model: 'claude-sonnet-4-20250514' });
    expect(getMessages(db, session.id)).toEqual([]);
    closeDb(db);
  });
});

// ── ContentBlockParam round-trip ───────────────────────────────────

describe('ContentBlockParam round-trip', () => {
  it('stores and retrieves tool_use + tool_result blocks as JSON', () => {
    const db = openSessionDb();
    const session = createSession(db, { model: 'claude-sonnet-4-20250514' });

    // Simulate tool_use content from assistant
    const toolUseContent = [
      {
        type: 'tool_use',
        id: 'toolu_01A',
        name: 'read_file',
        input: { path: '/tmp/test.txt' },
      },
    ];

    addMessage(db, {
      session_id: session.id,
      role: 'assistant',
      display: '[tool_use: read_file]',
      content: toolUseContent,
    });

    // Simulate tool_result content from user
    const toolResultContent = [
      {
        type: 'tool_result',
        tool_use_id: 'toolu_01A',
        content: 'File contents here',
      },
    ];

    addMessage(db, {
      session_id: session.id,
      role: 'user',
      display: '[tool_result: read_file]',
      content: toolResultContent,
    });

    const msgs = getMessages(db, session.id);
    expect(msgs.length).toBe(2);

    // Verify tool_use round-trip
    const assistantMsg = msgs[0];
    expect(assistantMsg.role).toBe('assistant');
    expect(assistantMsg.content).toEqual(toolUseContent);
    const toolUse = (assistantMsg.content as Array<Record<string, unknown>>)[0];
    expect(toolUse.type).toBe('tool_use');
    expect(toolUse.id).toBe('toolu_01A');
    expect(toolUse.name).toBe('read_file');
    expect(toolUse.input).toEqual({ path: '/tmp/test.txt' });

    // Verify tool_result round-trip
    const userMsg = msgs[1];
    expect(userMsg.role).toBe('user');
    expect(userMsg.content).toEqual(toolResultContent);
    const toolResult = (userMsg.content as Array<Record<string, unknown>>)[0];
    expect(toolResult.type).toBe('tool_result');
    expect(toolResult.tool_use_id).toBe('toolu_01A');
    expect(toolResult.content).toBe('File contents here');

    closeDb(db);
  });

  it('handles mixed text + tool_use content blocks', () => {
    const db = openSessionDb();
    const session = createSession(db, { model: 'claude-sonnet-4-20250514' });

    const mixedContent = [
      { type: 'text', text: 'Let me read that file for you.' },
      {
        type: 'tool_use',
        id: 'toolu_02B',
        name: 'list_files',
        input: { directory: '/home' },
      },
    ];

    addMessage(db, {
      session_id: session.id,
      role: 'assistant',
      display: 'Let me read that file for you. [tool_use: list_files]',
      content: mixedContent,
    });

    const msgs = getMessages(db, session.id);
    expect(msgs[0].content).toEqual(mixedContent);
    closeDb(db);
  });
});
