#!/usr/bin/env node

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

interface JsonRpcMessage {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: unknown;
}

interface PendingRequest {
  timer: NodeJS.Timeout;
  method: string;
}

export interface SupervisorOptions {
  childEntry: string;
  childArgs: string[];
  requestTimeoutMs: number;
  restartDelayMs: number;
  stateFile?: string;
  stdio?: {
    input: NodeJS.ReadableStream;
    output: NodeJS.WritableStream;
    error: NodeJS.WritableStream;
  };
}

const REINIT_ID = '__chatgpt_machine_supervisor_reinitialize__';
const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;
const RESTART_DELAY_MS = 250;

function parseMessage(line: string): JsonRpcMessage | undefined {
  try {
    const value = JSON.parse(line) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRpcMessage : undefined;
  } catch {
    return undefined;
  }
}

function responseFor(id: JsonRpcMessage['id'], message: string, data?: Record<string, unknown>): string {
  return JSON.stringify({
    jsonrpc: '2.0',
    id,
    error: { code: -32001, message, ...(data ? { data } : {}) },
  }) + '\n';
}

function requestDeadline(message: JsonRpcMessage, fallbackMs: number): number {
  if (message.method !== 'tools/call') return Math.min(fallbackMs, 30_000);
  const params = message.params as { arguments?: Record<string, unknown> } | undefined;
  const toolTimeout = params?.arguments?.timeout_ms;
  if (typeof toolTimeout === 'number' && Number.isFinite(toolTimeout) && toolTimeout > 0) {
    return Math.max(5_000, Math.min(11 * 60_000, toolTimeout + 15_000));
  }
  return fallbackMs;
}

export class McpSupervisor {
  private child?: ChildProcessWithoutNullStreams;
  private childGeneration = 0;
  private stopping = false;
  private restarting = false;
  private pending = new Map<string | number | null, PendingRequest>();
  private queuedLines: string[] = [];
  private initializeMessage?: JsonRpcMessage;
  private initializedNotification?: JsonRpcMessage;
  private reinitializing = false;
  private restarts = 0;
  private lastRestartReason?: string;
  private readonly startedAt = new Date().toISOString();
  private readonly input: NodeJS.ReadableStream;
  private readonly output: NodeJS.WritableStream;
  private readonly error: NodeJS.WritableStream;

  constructor(private readonly options: SupervisorOptions) {
    this.input = options.stdio?.input ?? process.stdin;
    this.output = options.stdio?.output ?? process.stdout;
    this.error = options.stdio?.error ?? process.stderr;
  }

  start(): void {
    this.spawnChild();
    const inputLines = createInterface({ input: this.input, crlfDelay: Infinity });
    inputLines.on('line', (line) => this.onParentLine(line));
    inputLines.on('close', () => this.stop());
  }

  stop(): void {
    if (this.stopping) return;
    this.stopping = true;
    for (const item of this.pending.values()) clearTimeout(item.timer);
    this.pending.clear();
    this.child?.kill();
    this.writeState(false);
  }

  private writeState(ready: boolean): void {
    if (!this.options.stateFile) return;
    const destination = this.options.stateFile;
    const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(temporary, JSON.stringify({
      version: 1,
      supervisorPid: process.pid,
      workerPid: this.child?.pid ?? null,
      workerGeneration: this.childGeneration,
      ready,
      restarts: this.restarts,
      lastRestartReason: this.lastRestartReason ?? null,
      startedAt: this.startedAt,
      updatedAt: new Date().toISOString(),
    }, null, 2) + '\n', 'utf8');
    renameSync(temporary, destination);
  }

  private spawnChild(): void {
    if (this.stopping) return;
    const generation = ++this.childGeneration;
    const child = spawn(process.execPath, [this.options.childEntry, ...this.options.childArgs], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env, MCP_SUPERVISED: '1', MCP_WORKER_GENERATION: String(generation) },
    });
    this.child = child;
    this.writeState(!this.reinitializing && generation === 1);
    this.error.write(`[chatgpt-machine-supervisor] worker started generation=${generation} pid=${child.pid ?? 'unknown'}\n`);

    const stdoutLines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    stdoutLines.on('line', (line) => this.onChildLine(line, generation));
    child.stderr.on('data', (chunk) => this.error.write(chunk));
    child.once('error', (error) => this.handleWorkerFailure(`worker error: ${error.message}`, generation));
    child.once('exit', (code, signal) => {
      if (!this.stopping && this.childGeneration === generation) {
        this.handleWorkerFailure(`worker exited code=${code ?? 'null'} signal=${signal ?? 'null'}`, generation);
      }
    });

    if (this.initializeMessage && generation > 1) {
      this.reinitializing = true;
      const replay = { ...this.initializeMessage, id: REINIT_ID };
      child.stdin.write(JSON.stringify(replay) + '\n');
    }
  }

  private onParentLine(line: string): void {
    const message = parseMessage(line);
    if (!message) {
      this.error.write('[chatgpt-machine-supervisor] ignored malformed parent JSON line\n');
      return;
    }
    if (message.method === 'initialize' && message.id !== undefined) this.initializeMessage = message;
    if (message.method === 'notifications/initialized') this.initializedNotification = message;

    if (this.reinitializing || !this.child || this.child.killed) {
      this.queuedLines.push(line);
      return;
    }
    this.forwardToChild(line, message);
  }

  private forwardToChild(line: string, message: JsonRpcMessage): void {
    if (!this.child || this.child.killed) {
      this.queuedLines.push(line);
      return;
    }
    if (message.id !== undefined && message.method) {
      const timeoutMs = requestDeadline(message, this.options.requestTimeoutMs);
      const timer = setTimeout(() => this.onRequestTimeout(message.id!, message.method!, timeoutMs), timeoutMs);
      this.pending.set(message.id, { timer, method: message.method });
    }
    this.child.stdin.write(line + '\n');
  }

  private onChildLine(line: string, generation: number): void {
    if (generation !== this.childGeneration) return;
    const message = parseMessage(line);
    if (!message) {
      this.error.write('[chatgpt-machine-supervisor] worker emitted malformed JSON line\n');
      return;
    }

    if (message.id === REINIT_ID && (message.result !== undefined || message.error !== undefined)) {
      if (message.error !== undefined) {
        this.handleWorkerFailure('worker reinitialization failed', generation);
        return;
      }
      if (this.initializedNotification && this.child && !this.child.killed) {
        this.child.stdin.write(JSON.stringify(this.initializedNotification) + '\n');
      }
      this.reinitializing = false;
      this.writeState(true);
      const queued = this.queuedLines.splice(0);
      for (const queuedLine of queued) {
        const queuedMessage = parseMessage(queuedLine);
        if (queuedMessage) this.forwardToChild(queuedLine, queuedMessage);
      }
      this.error.write(`[chatgpt-machine-supervisor] worker ready generation=${generation}\n`);
      return;
    }

    if (message.id !== undefined && (message.result !== undefined || message.error !== undefined)) {
      const item = this.pending.get(message.id);
      if (item) {
        clearTimeout(item.timer);
        this.pending.delete(message.id);
      }
    }
    this.output.write(line + '\n');
  }

  private onRequestTimeout(id: string | number | null, method: string, timeoutMs: number): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(id);
    this.output.write(responseFor(id, `MCP worker did not answer ${method} within ${timeoutMs} ms.`, {
      reason: 'worker_timeout',
      workerGeneration: this.childGeneration,
      recoverable: true,
    }));
    this.restartWorker(`request timeout method=${method}`);
  }

  private handleWorkerFailure(reason: string, generation: number): void {
    if (this.stopping || generation !== this.childGeneration) return;
    this.restartWorker(reason);
  }

  private restartWorker(reason: string): void {
    if (this.stopping || this.restarting) return;
    this.restarting = true;
    this.reinitializing = Boolean(this.initializeMessage);
    this.restarts++;
    this.lastRestartReason = reason;
    this.writeState(false);
    this.error.write(`[chatgpt-machine-supervisor] restarting worker: ${reason}\n`);
    for (const [id, item] of this.pending) {
      clearTimeout(item.timer);
      this.output.write(responseFor(id, 'MCP worker restarted before the request completed.', {
        reason: 'worker_restarted',
        workerGeneration: this.childGeneration,
        recoverable: true,
      }));
    }
    this.pending.clear();
    const current = this.child;
    this.child = undefined;
    current?.kill();
    setTimeout(() => {
      this.restarting = false;
      this.spawnChild();
    }, this.options.restartDelayMs).unref();
  }
}

export function parseSupervisorArgs(args: string[]): { requestTimeoutMs: number; childArgs: string[] } {
  let requestTimeoutMs = Number(process.env.MCP_SUPERVISOR_TIMEOUT_MS ?? DEFAULT_REQUEST_TIMEOUT_MS);
  const childArgs: string[] = [];
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--supervisor-timeout') {
      const raw = args[++index];
      if (!raw) throw new Error('--supervisor-timeout requires a value.');
      requestTimeoutMs = Number(raw);
    } else {
      childArgs.push(args[index]);
    }
  }
  if (!Number.isInteger(requestTimeoutMs) || requestTimeoutMs < 5_000 || requestTimeoutMs > 11 * 60_000) {
    throw new Error('--supervisor-timeout must be an integer between 5000 and 660000 milliseconds.');
  }
  return { requestTimeoutMs, childArgs };
}

export function main(): void {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const { requestTimeoutMs, childArgs } = parseSupervisorArgs(process.argv.slice(2));
  const childEntry = process.env.MCP_SUPERVISOR_CHILD_ENTRY ?? path.join(here, 'index.js');
  const stateFile = process.env.MCP_SUPERVISOR_STATE_FILE ?? path.join(here, '..', '.chatgpt-machine', 'supervisor.json');
  const supervisor = new McpSupervisor({ childEntry, childArgs, requestTimeoutMs, restartDelayMs: RESTART_DELAY_MS, stateFile });
  process.once('SIGINT', () => supervisor.stop());
  process.once('SIGTERM', () => supervisor.stop());
  supervisor.start();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`[chatgpt-machine-supervisor] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
