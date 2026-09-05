import { describe, expect, test } from 'vitest';

import { summarizeContent } from './summarize';

describe('summarizeContent', () => {
  test('returns undefined for short content', () => {
    expect(summarizeContent('Keep this concise.')).toBeUndefined();
  });

  test('keeps the first important sentences for long prose', () => {
    const important = [
      'The agent found the authentication bug.',
      'It verified the failing path through the login handler.',
      'The fix belongs at the validation boundary.',
      'The final response should avoid unrelated refactors.',
      'Regression coverage should prove the original invariant.',
    ].join(' ');
    const content = `${important} ${'Extra detail should be skipped. '.repeat(50)}`;

    expect(summarizeContent(content)).toContain('authentication bug');
    expect(summarizeContent(content)).toContain('validation boundary');
    expect(summarizeContent(content)).not.toContain('Extra detail');
  });

  test('falls back to a bounded slice when sentence splitting finds nothing', () => {
    const content = 'a'.repeat(2000);
    const summary = summarizeContent(content);

    expect(summary).toBeDefined();
    expect(summary?.length).toBeLessThanOrEqual(1200);
  });
});
