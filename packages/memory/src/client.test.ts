import { afterEach, describe, expect, test } from 'vitest';

import { detectClient, getDatabasePath, getWorkspaceRoot, resolveTreePath } from './client';

const originalEnv = process.env;

afterEach(() => {
  process.env = originalEnv;
});

describe('client detection', () => {
  test('detects claudecode from CLAUDE_PROJECT_DIR', () => {
    process.env = {
      ...originalEnv,
      CLAUDE_PROJECT_DIR: '/tmp/claude-project',
      CLEW_PROJECT_DIR: undefined,
      OURBOOK_MEMORY_DB: undefined,
      OURBOOK_MEMORY_SCOPE: undefined,
    };

    expect(detectClient()).toBe('claudecode');
    expect(getWorkspaceRoot()).toBe('/tmp/claude-project');
  });

  test('detects clewcode from CLEW_PROJECT_DIR', () => {
    process.env = {
      ...originalEnv,
      CLAUDE_PROJECT_DIR: undefined,
      CLEW_PROJECT_DIR: '/tmp/clew-project',
      OURBOOK_MEMORY_DB: undefined,
      OURBOOK_MEMORY_SCOPE: undefined,
    };

    expect(detectClient()).toBe('clewcode');
    expect(getWorkspaceRoot()).toBe('/tmp/clew-project');
  });

  test('detects opencode from OPENCODE_PROJECT_DIR', () => {
    process.env = {
      ...originalEnv,
      OPENCODE_PROJECT_DIR: '/tmp/opencode-project',
    };
    expect(detectClient()).toBe('opencode');
  });

  test('detects codex from CODEX_PROJECT_DIR', () => {
    process.env = {
      ...originalEnv,
      CODEX_PROJECT_DIR: '/tmp/codex-project',
    };
    expect(detectClient()).toBe('codex');
  });

  test('detects openclaw from OPENCLAW_PROJECT_DIR', () => {
    process.env = {
      ...originalEnv,
      OPENCLAW_PROJECT_DIR: '/tmp/openclaw-project',
    };
    expect(detectClient()).toBe('openclaw');
  });

  test('detects hermes-agent from HERMES_AGENT_PROJECT_DIR', () => {
    process.env = {
      ...originalEnv,
      HERMES_AGENT_PROJECT_DIR: '/tmp/hermes-project',
    };
    expect(detectClient()).toBe('hermes-agent');
  });

  test('uses global persistent memory by default', () => {
    process.env = {
      ...originalEnv,
      CLAUDE_PROJECT_DIR: undefined,
      CLEW_PROJECT_DIR: '/tmp/clew-project',
      OURBOOK_MEMORY_DB: undefined,
      OURBOOK_MEMORY_SCOPE: undefined,
    };

    expect(getDatabasePath()).toMatch(/[/\\]\.ourbook[/\\]memory\.db$/);
    expect(getDatabasePath()).not.toContain('clew-project');
  });

  test('supports explicit project-local isolation', () => {
    process.env = {
      ...originalEnv,
      CLAUDE_PROJECT_DIR: undefined,
      CLEW_PROJECT_DIR: '/tmp/clew-project',
      OURBOOK_MEMORY_DB: undefined,
      OURBOOK_MEMORY_SCOPE: 'project',
    };

    expect(getDatabasePath()).toContain('clew-project');
    expect(getDatabasePath()).toMatch(/[/\\]\.ourbook[/\\]memory\.db$/);
  });

  test('lets OURBOOK_MEMORY_DB override detected project memory', () => {
    process.env = {
      ...originalEnv,
      CLAUDE_PROJECT_DIR: '/tmp/claude-project',
      CLEW_PROJECT_DIR: undefined,
      OURBOOK_MEMORY_DB: '/custom/memory.db',
      OURBOOK_MEMORY_SCOPE: 'global',
    };

    expect(getDatabasePath()).toBe('/custom/memory.db');
  });
});

describe('resolveTreePath', () => {
  test('exact CLI names without name return single-segment', () => {
    expect(resolveTreePath({ client: 'claudecode' })).toEqual(['claudecode']);
    expect(resolveTreePath({ client: 'clewcode' })).toEqual(['clewcode']);
    expect(resolveTreePath({ client: 'opencode' })).toEqual(['opencode']);
    expect(resolveTreePath({ client: 'codex' })).toEqual(['codex']);
  });

  test('exact CLI names with name return [client, name]', () => {
    expect(resolveTreePath({ client: 'claudecode', name: 'my-app' })).toEqual([
      'claudecode',
      'my-app',
    ]);
    expect(resolveTreePath({ client: 'codex', name: 'api' })).toEqual(['codex', 'api']);
  });

  test('old claude-code alias is normalized', () => {
    expect(resolveTreePath({ client: 'claude-code', name: 'proj' })).toEqual([
      'claudecode',
      'proj',
    ]);
  });

  test('openclaw uses name as tree root', () => {
    expect(resolveTreePath({ client: 'openclaw', name: 'my-project' })).toEqual(['my-project']);
  });

  test('hermes-agent uses name as tree root', () => {
    expect(resolveTreePath({ client: 'hermes-agent', name: 'agent-x' })).toEqual(['agent-x']);
  });

  test('openclaw falls back to client when no name provided', () => {
    const path = resolveTreePath({ client: 'openclaw' });
    expect(path).toContain('openclaw');
  });

  test('unknown client with project returns [client, project]', () => {
    expect(resolveTreePath({ client: 'unknown', project: 'my-app' })).toEqual([
      'unknown',
      'my-app',
    ]);
  });

  test('unknown client without project returns [client]', () => {
    expect(resolveTreePath({ client: 'unknown' })).toEqual(['unknown']);
  });

  test('name falls back to project for tree-root clients', () => {
    expect(resolveTreePath({ client: 'openclaw', project: 'proj-x' })).toEqual(['proj-x']);
  });

  test('appends OURBOOK_MEMORY_BRANCH as last segment', () => {
    const orig = process.env.OURBOOK_MEMORY_BRANCH;
    process.env.OURBOOK_MEMORY_BRANCH = 'feature-x';
    try {
      expect(resolveTreePath({ client: 'claudecode', name: 'app' })).toEqual([
        'claudecode',
        'app',
        'feature-x',
      ]);
      expect(resolveTreePath({ client: 'unknown', project: 'p' })).toEqual([
        'unknown',
        'p',
        'feature-x',
      ]);
    } finally {
      process.env.OURBOOK_MEMORY_BRANCH = orig;
    }
  });
});
