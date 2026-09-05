import { createHash, randomUUID } from 'node:crypto';
import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';

export interface AuditRecord {
  id?: string;
  timestamp?: string;
  traceId: string;
  tool: string;
  policy: string;
  decision: 'allowed' | 'denied' | 'approval_required';
  status: 'success' | 'error' | 'input_required';
  durationMs: number;
  args?: Record<string, unknown>;
  errorCode?: string;
  targetMachine?: string;
  remoteTool?: string;
}

const SECRET_KEY = /(password|passwd|secret|token|authorization|cookie|credential|api[_-]?key|private[_-]?key)/i;
const LARGE_TEXT_KEY = /^(content|old_text|new_text|patch|stdin|input|text|expression)$/i;
const SECRET_VALUE = /\b(?:sk-proj-[A-Za-z0-9_-]{16,}|sk-ant-[A-Za-z0-9_-]{16,}|sk-[A-Za-z0-9_-]{12,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{22,}|AKIA[A-Z0-9]{16}|xox[baprs]-[A-Za-z0-9-]{12,}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})\b/g;
const PRIVATE_KEY_BLOCK = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g;

/** Redact common credentials from output before it crosses the tunnel boundary. */
export function redactSecrets(value: string): string {
  return value.replace(PRIVATE_KEY_BLOCK, '[REDACTED_PRIVATE_KEY]').replace(SECRET_VALUE, '[REDACTED_SECRET]');
}

function digestText(value: string): string {
  const hash = createHash('sha256').update(value).digest('hex').slice(0, 16);
  return `[text ${value.length} chars sha256:${hash}]`;
}

export function redactCommandForStorage(value: string): string {
  return value
    .replace(/((?:--?|\/)(?:token|password|secret|api[-_]?key|authorization)\s*[=:]?\s*)([^\s"']+|"[^"]*"|'[^']*')/gi, '$1[REDACTED]')
    .slice(0, 2000);
}

function redactUrlForStorage(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return digestText(value);
  }

  if (url.protocol === 'data:' || url.protocol === 'blob:') return `[${url.protocol.slice(0, -1)} URL ${digestText(value)}]`;
  if (url.protocol === 'about:') return url.href.slice(0, 2000);

  url.username = '';
  url.password = '';
  url.hash = '';
  for (const key of [...new Set(url.searchParams.keys())]) {
    url.searchParams.delete(key);
    url.searchParams.append(key, '[REDACTED]');
  }
  return redactSecrets(url.href).slice(0, 2000);
}

function sanitize(value: unknown, key = '', depth = 0): unknown {
  if (depth > 5) return '[max-depth]';
  if (SECRET_KEY.test(key)) return '[REDACTED]';
  if (typeof value === 'string') {
    if (LARGE_TEXT_KEY.test(key)) return digestText(value);
    if (key === 'command') return redactCommandForStorage(value);
    if (key === 'url') return redactUrlForStorage(value);
    const redacted = redactSecrets(value);
    return redacted.length > 2000 ? `${redacted.slice(0, 2000)}…` : redacted;
  }
  if (Array.isArray(value)) return value.slice(0, 100).map((entry) => sanitize(entry, key, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([childKey, child]) => [childKey, sanitize(child, childKey, depth + 1)]),
    );
  }
  return value;
}

export class AuditLogger {
  readonly filePath: string;
  private queue: Promise<void> = Promise.resolve();

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  sanitizeArgs(args: Record<string, unknown>): Record<string, unknown> {
    return sanitize(args) as Record<string, unknown>;
  }

  write(record: AuditRecord): Promise<void> {
    const targetMachine = record.targetMachine ?? (typeof record.args?.machine === 'string' ? record.args.machine.slice(0, 256) : undefined);
    const remoteTool = record.remoteTool ?? (typeof record.args?.tool === 'string' ? record.args.tool.slice(0, 256) : undefined);
    const finalized = {
      ...record,
      targetMachine,
      remoteTool,
      id: record.id ?? randomUUID(),
      timestamp: record.timestamp ?? new Date().toISOString(),
      args: record.args ? this.sanitizeArgs(record.args) : undefined,
    };
    this.queue = this.queue.then(async () => {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      await fs.appendFile(this.filePath, `${JSON.stringify(finalized)}\n`, 'utf8');
    }).catch((error) => {
      console.error('[chatgpt-machine-mcp] audit write failed:', error instanceof Error ? error.message : String(error));
    });
    return this.queue;
  }

  async recent(limit = 50): Promise<unknown[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error('Audit limit must be between 1 and 500.');
    try {
      const text = await fs.readFile(this.filePath, 'utf8');
      return text.split(/\r?\n/).filter(Boolean).slice(-limit).map((line) => JSON.parse(line));
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return [];
      throw error;
    }
  }

  async search(query: string, limit = 100): Promise<unknown[]> {
    const needle = query.toLowerCase();
    const recent = await this.recent(500);
    return recent.filter((entry) => JSON.stringify(entry).toLowerCase().includes(needle)).slice(-limit);
  }
}

export function defaultAuditPath(root: string): string {
  const pilotDir = path.join(root, '.pilot');
  const legacyDir = path.join(root, '.chatgpt-machine');
  if (!existsSync(pilotDir) && existsSync(legacyDir)) {
    return path.join(legacyDir, 'audit.ndjson');
  }
  return path.join(pilotDir, 'audit.ndjson');
}
