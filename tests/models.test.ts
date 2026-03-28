import { describe, it, expect } from 'vitest';
import {
  DEFAULT_MODEL,
  MODEL_ALIASES,
  KNOWN_MODELS,
  resolveModelAlias,
} from '../src/models.js';

// ── DEFAULT_MODEL ──────────────────────────────────────────────

describe('DEFAULT_MODEL', () => {
  it('is claude-sonnet-4-20250514', () => {
    expect(DEFAULT_MODEL).toBe('claude-sonnet-4-20250514');
  });

  it('is a known model', () => {
    expect(KNOWN_MODELS.has(DEFAULT_MODEL)).toBe(true);
  });
});

// ── MODEL_ALIASES ──────────────────────────────────────────────

describe('MODEL_ALIASES', () => {
  it('maps sonnet to claude-sonnet-4-20250514', () => {
    expect(MODEL_ALIASES['sonnet']).toBe('claude-sonnet-4-20250514');
  });

  it('maps opus to claude-opus-4-20250514', () => {
    expect(MODEL_ALIASES['opus']).toBe('claude-opus-4-20250514');
  });

  it('maps haiku to claude-haiku-4-20250514', () => {
    expect(MODEL_ALIASES['haiku']).toBe('claude-haiku-4-20250514');
  });

  it('all alias targets are in KNOWN_MODELS', () => {
    for (const modelId of Object.values(MODEL_ALIASES)) {
      expect(KNOWN_MODELS.has(modelId)).toBe(true);
    }
  });
});

// ── KNOWN_MODELS ───────────────────────────────────────────────

describe('KNOWN_MODELS', () => {
  it('contains exactly three models', () => {
    expect(KNOWN_MODELS.size).toBe(3);
  });

  it('contains all expected model IDs', () => {
    expect(KNOWN_MODELS.has('claude-sonnet-4-20250514')).toBe(true);
    expect(KNOWN_MODELS.has('claude-opus-4-20250514')).toBe(true);
    expect(KNOWN_MODELS.has('claude-haiku-4-20250514')).toBe(true);
  });
});

// ── resolveModelAlias ──────────────────────────────────────────

describe('resolveModelAlias', () => {
  it('resolves "sonnet" to full model ID', () => {
    expect(resolveModelAlias('sonnet')).toBe('claude-sonnet-4-20250514');
  });

  it('resolves "opus" to full model ID', () => {
    expect(resolveModelAlias('opus')).toBe('claude-opus-4-20250514');
  });

  it('resolves "haiku" to full model ID', () => {
    expect(resolveModelAlias('haiku')).toBe('claude-haiku-4-20250514');
  });

  it('is case-insensitive', () => {
    expect(resolveModelAlias('SONNET')).toBe('claude-sonnet-4-20250514');
    expect(resolveModelAlias('Opus')).toBe('claude-opus-4-20250514');
    expect(resolveModelAlias('HaIkU')).toBe('claude-haiku-4-20250514');
  });

  it('trims whitespace', () => {
    expect(resolveModelAlias('  sonnet  ')).toBe('claude-sonnet-4-20250514');
  });

  it('passes through full model IDs unchanged', () => {
    expect(resolveModelAlias('claude-sonnet-4-20250514')).toBe('claude-sonnet-4-20250514');
  });

  it('passes through unknown model strings unchanged', () => {
    expect(resolveModelAlias('gpt-4o')).toBe('gpt-4o');
    expect(resolveModelAlias('some-custom-model')).toBe('some-custom-model');
  });

  it('passes through unknown string with whitespace trimmed', () => {
    expect(resolveModelAlias('  gpt-4o  ')).toBe('gpt-4o');
  });
});
