import { describe, expect, test } from 'vitest';

import { isSensitiveString, redactContent, sanitizeContent } from './privacy';

describe('redactContent', () => {
  test('redacts API key pairs', () => {
    const input = 'API_KEY=sk-abc123def456 secret stuff';
    expect(redactContent(input)).not.toContain('sk-abc123def456');
  });

  test('redacts GitHub tokens', () => {
    const input = 'Token is ghp_abcdefghijklmnopqrstuvwxyz12345';
    const result = redactContent(input);
    expect(result).toContain('[REDACTED]');
    expect(result).not.toContain('ghp_');
  });

  test('redacts SSH private keys', () => {
    const input = `Some file had -----BEGIN OPENSSH PRIVATE KEY-----
xxxxyyyyzzzz
-----END OPENSSH PRIVATE KEY----- in it`;
    const result = redactContent(input);
    expect(result).toContain('[REDACTED]');
    expect(result).not.toContain('OPENSSH PRIVATE KEY');
  });

  test('redacts Slack tokens', () => {
    const input = 'Use xoxb-1234567890-abcdef for bot';
    const result = redactContent(input);
    expect(result).toContain('[REDACTED]');
    expect(result).not.toContain('xoxb-');
  });

  test('redacts bare API key prefixes', () => {
    const input = 'Use sk-proj-abcdef1234567890ab as the key';
    const result = redactContent(input);
    expect(result).toContain('[REDACTED]');
    expect(result).not.toContain('sk-proj');
  });

  test('preserves normal content', () => {
    const input = 'The user asked about authentication flow in the login handler.';
    expect(redactContent(input)).toBe(input);
  });
});

describe('sanitizeContent', () => {
  test('truncates long content', () => {
    const input = `The quick brown fox jumps over the lazy dog. `.repeat(3000);
    const result = sanitizeContent(input, 2000);
    expect(result.length).toBeLessThan(2100);
    expect(result).toContain('[truncated');
  });
});

describe('isSensitiveString', () => {
  test('detects bare API key prefix', () => {
    expect(isSensitiveString('sk-proj-abcdef1234567890ab')).toBe(true);
  });

  test('detects GitHub token', () => {
    expect(isSensitiveString('ghp_abcdefghijklmnopqrstuvwxyz')).toBe(true);
  });

  test('returns false for normal text', () => {
    expect(isSensitiveString('hello world')).toBe(false);
  });
});
