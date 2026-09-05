import { createHash, randomUUID } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ToolError } from './errors.js';

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(',')}}`;
  return JSON.stringify(value);
}


interface Entry { fingerprint: string; state: 'pending' | 'complete' | 'unknown'; result?: unknown }
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

/** Durable receipts, not a job queue. An interrupted mutation is never replayed blindly. */
export class IdempotencyStore {
  private readonly entries = new Map<string, Entry>();
  private readonly active = new Map<string, { fingerprint: string; result: Promise<unknown> }>();
  constructor(private readonly directory?: string) {}

  private filename(key: string): string { return path.join(this.directory!, `${digest(key)}.json`); }
  private fingerprint(tool: string, args: Record<string, unknown>): string { return digest(`${tool}:${stable(args)}`); }
  private read(key: string): Entry | undefined {
    if (!this.directory) return this.entries.get(key);
    try {
      const raw = readFileSync(this.filename(key));
      if (raw.length > 5 * 1024 * 1024) throw new Error('Receipt too large');
      const entry = JSON.parse(raw.toString('utf8')) as Entry;
      if (!/^[a-f0-9]{64}$/.test(entry.fingerprint) || !['pending', 'complete', 'unknown'].includes(entry.state)) throw new Error('Invalid receipt');
      return entry;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw new ToolError('IDEMPOTENCY_UNKNOWN', 'Cannot read the durable receipt; execution is blocked.', 'Inspect the receipt and reconcile the operation before retrying.');
    }
  }
  private write(key: string, entry: Entry, exclusive = false): void {
    if (!this.directory) { this.entries.set(key, entry); return; }
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const destination = this.filename(key);
    const temporary = exclusive ? destination : `${destination}.${randomUUID()}.tmp`;
    const fd = openSync(temporary, 'wx', 0o600);
    try { writeFileSync(fd, JSON.stringify(entry)); fsyncSync(fd); } finally { closeSync(fd); }
    if (!exclusive) renameSync(temporary, destination);
  }
  lookup(key: string, tool: string, args: Record<string, unknown>): unknown | undefined {
    const entry = this.read(key);
    if (!entry) return undefined;
    if (entry.fingerprint !== this.fingerprint(tool, args)) throw new ToolError('IDEMPOTENCY_CONFLICT', 'This idempotency_key was already used with different tool arguments.');
    if (entry.state !== 'complete') throw new ToolError('IDEMPOTENCY_UNKNOWN', 'A prior execution is in progress or its outcome is unknown.', 'Inspect audit/process/file state. Do not automatically submit a new key.');
    return entry.result;
  }
  store(key: string, tool: string, args: Record<string, unknown>, result: unknown): void {
    const fingerprint = this.fingerprint(tool, args);
    const old = this.read(key);
    if (old && old.fingerprint !== fingerprint) throw new ToolError('IDEMPOTENCY_CONFLICT', 'Conflicting receipt.');
    // Keep the tombstone if the response cannot be retained within the receipt budget.
    const entry: Entry = Buffer.byteLength(JSON.stringify(result)) > 4 * 1024 * 1024
      ? { fingerprint, state: 'unknown' } : { fingerprint, state: 'complete', result };
    this.write(key, entry);
  }
  async run<T>(key: string, tool: string, args: Record<string, unknown>, execute: () => Promise<T>): Promise<T> {
    const fingerprint = this.fingerprint(tool, args);
    const active = this.active.get(key);
    if (active) {
      if (active.fingerprint !== fingerprint) throw new ToolError('IDEMPOTENCY_CONFLICT', 'Conflicting in-flight request.');
      return active.result as Promise<T>;
    }
    const cached = this.lookup(key, tool, args);
    if (cached !== undefined) return cached as T;
    try { this.write(key, { fingerprint, state: 'pending' }, true); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return this.lookup(key, tool, args) as T;
      throw new ToolError('IDEMPOTENCY_UNKNOWN', 'Cannot persist the execution receipt; operation was not started.');
    }
    // Defer execution until the in-flight promise is visible to concurrent requests.
    const result = Promise.resolve().then(execute).then(value => {
      this.store(key, tool, args, value);
      return value;
    });
    this.active.set(key, { fingerprint, result });
    try { return await result; } finally { this.active.delete(key); }
  }
}

