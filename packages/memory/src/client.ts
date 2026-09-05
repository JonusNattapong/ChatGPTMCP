import { homedir } from 'node:os';
import { resolve } from 'node:path';

export type MemoryClient =
  | 'opencode'
  | 'claudecode'
  | 'clewcode'
  | 'codex'
  | 'openclaw'
  | 'hermes-agent'
  | 'claude-code'
  | 'unknown';

/** Clients whose exact name is used as the tree path (single segment). */
const EXACT_CLIENTS = new Set<string>(['opencode', 'claudecode', 'clewcode', 'codex']);

/** Clients that use the user-provided name as the tree root. */
const TREE_ROOT_CLIENTS = new Set<string>(['openclaw', 'hermes-agent']);

/** Backwards-compatible alias map for old client names. */
const CLIENT_ALIASES: Record<string, string> = {
  'claude-code': 'claudecode',
};

export function normalizeClient(client: string): string {
  return CLIENT_ALIASES[client] ?? client;
}

export type TreePathInput = {
  name?: string | null | undefined;
  project?: string | null | undefined;
  client?: string | null | undefined;
};

/**
 * Resolve the tree path segments for a memory.
 *
 * - Exact CLI names (opencode, claudecode, clewcode, codex) → `["<client>", "<name>"]`
 * - Tree-root clients (openclaw, hermes-agent) → `["<user-name>"]`
 * - Fallback → `["<client>", "<project>"]`
 *
 * Also appends `OURBOOK_MEMORY_BRANCH` env var as the last segment if set.
 */
export function resolveTreePath(input: TreePathInput): string[] {
  const client = normalizeClient(input.client ?? detectClient());
  const name = input.name?.trim() || input.project?.trim();
  const project = input.project?.trim();
  const branch = process.env.OURBOOK_MEMORY_BRANCH?.trim();

  let segments: string[];

  if (EXACT_CLIENTS.has(client)) {
    segments = name ? [client, name] : [client];
  } else if (TREE_ROOT_CLIENTS.has(client)) {
    segments = name ? [name] : [client];
  } else {
    segments = [client];
    if (project) segments.push(project);
  }

  if (branch) segments.push(branch);
  return segments;
}

export function detectClient(): MemoryClient {
  if (process.env.CLAUDE_PROJECT_DIR) {
    return 'claudecode';
  }

  if (process.env.CLEW_PROJECT_DIR) {
    return 'clewcode';
  }

  if (process.env.OPENCODE_PROJECT_DIR) {
    return 'opencode';
  }

  if (process.env.CODEX_PROJECT_DIR) {
    return 'codex';
  }

  if (process.env.OPENCLAW_PROJECT_DIR) {
    return 'openclaw';
  }

  if (process.env.HERMES_AGENT_PROJECT_DIR) {
    return 'hermes-agent';
  }

  return 'unknown';
}

export function getWorkspaceRoot() {
  if (process.env.CLAUDE_PROJECT_DIR) {
    return process.env.CLAUDE_PROJECT_DIR;
  }

  if (process.env.CLEW_PROJECT_DIR) {
    return process.env.CLEW_PROJECT_DIR;
  }

  if (process.env.OPENCODE_PROJECT_DIR) {
    return process.env.OPENCODE_PROJECT_DIR;
  }

  if (process.env.CODEX_PROJECT_DIR) {
    return process.env.CODEX_PROJECT_DIR;
  }

  if (process.env.OPENCLAW_PROJECT_DIR) {
    return process.env.OPENCLAW_PROJECT_DIR;
  }

  if (process.env.HERMES_AGENT_PROJECT_DIR) {
    return process.env.HERMES_AGENT_PROJECT_DIR;
  }

  return process.cwd();
}

export function getDatabasePath() {
  if (process.env.OURBOOK_MEMORY_DB) {
    return process.env.OURBOOK_MEMORY_DB;
  }

  const workspaceRoot = getWorkspaceRoot();
  if (process.env.OURBOOK_MEMORY_SCOPE === 'project') {
    return resolve(workspaceRoot, '.ourbook', 'memory.db');
  }

  // Persistent Second Brain is global by default so memories survive sessions and projects.
  return resolve(homedir(), '.ourbook', 'memory.db');
}
