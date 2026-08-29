import { createHash } from 'node:crypto';
import { ToolError } from './errors.js';

const MAX_ENTRIES = 200;

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(',')}}`;
  return JSON.stringify(value);
}

export class IdempotencyStore {
  private readonly entries = new Map<string, { fingerprint: string; result: unknown }>();

  lookup(key: string, tool: string, args: Record<string, unknown>): unknown | undefined {
    const fingerprint = createHash('sha256').update(`${tool}:${stable(args)}`).digest('hex');
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.fingerprint !== fingerprint) throw new ToolError('IDEMPOTENCY_CONFLICT', 'This idempotency_key was already used with different tool arguments.');
    this.entries.delete(key); this.entries.set(key, entry);
    return entry.result;
  }

  store(key: string, tool: string, args: Record<string, unknown>, result: unknown): void {
    const fingerprint = createHash('sha256').update(`${tool}:${stable(args)}`).digest('hex');
    this.entries.set(key, { fingerprint, result });
    while (this.entries.size > MAX_ENTRIES) this.entries.delete(this.entries.keys().next().value!);
  }
}
