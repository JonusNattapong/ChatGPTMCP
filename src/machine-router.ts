import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ToolError } from './errors.js';
import type { ToolSpec } from './tools.js';

export interface MachineRegistryEntry {
  id: string;
  endpoint: string;
  name?: string;
  hostname?: string;
  aliases?: string[];
  tokenEnv?: string;
  enabled?: boolean;
}

export interface MachineRegistryDocument {
  version: 1;
  machines: MachineRegistryEntry[];
}

interface RouterOptions {
  machinesFile?: string;
  timeoutMs: number;
}

const ROUTER_TOOLS = new Set(['machines_list', 'machine_probe', 'machine_tools', 'machine_call']);

export function machinesConfigPath(projectRoot: string): string {
  return path.join(projectRoot, '.chatgpt-machine', 'machines.json');
}

function privateIpv4(host: string): boolean {
  const p = host.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = p;
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
}

function allowsPlainHttp(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return host === 'localhost' || host === '::1' || host.endsWith('.local') || (!host.includes('.') && !host.includes(':')) || privateIpv4(host) || host.startsWith('fe80:') || host.startsWith('fd') || host.startsWith('fc');
}

export function normalizeMachineEndpoint(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new ToolError('INVALID_ARGUMENT', 'Machine endpoint must be a non-empty string.');
  const raw = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  let url: URL;
  try { url = new URL(raw); } catch { throw new ToolError('INVALID_ARGUMENT', `Invalid machine endpoint: ${input}`); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new ToolError('INVALID_ARGUMENT', 'Machine endpoint must use http:// or https://.');
  if (url.username || url.password) throw new ToolError('INVALID_ARGUMENT', 'Credentials must not be embedded in a machine endpoint URL.');
  if (url.search || url.hash) throw new ToolError('INVALID_ARGUMENT', 'Machine endpoint must not contain a query string or fragment.');
  if (url.protocol === 'http:' && !allowsPlainHttp(url.hostname)) throw new ToolError('INVALID_ARGUMENT', `Refusing plaintext HTTP to non-private host ${url.hostname}. Use HTTPS or a private LAN/Tailscale address.`);
  if (url.pathname === '/' || url.pathname === '') url.pathname = '/mcp';
  return url.toString().replace(/\/$/, '');
}

function validateEntry(raw: unknown, index: number): MachineRegistryEntry {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ToolError('INVALID_ARGUMENT', `machines[${index}] must be an object.`);
  const v = raw as Record<string, unknown>;
  if (typeof v.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(v.id)) throw new ToolError('INVALID_ARGUMENT', `machines[${index}].id is invalid.`);
  if (typeof v.endpoint !== 'string') throw new ToolError('INVALID_ARGUMENT', `machines[${index}].endpoint is required.`);
  const aliases = v.aliases;
  if (aliases !== undefined && (!Array.isArray(aliases) || aliases.some((x) => typeof x !== 'string' || x.length === 0))) throw new ToolError('INVALID_ARGUMENT', `machines[${index}].aliases must be an array of non-empty strings.`);
  if (v.tokenEnv !== undefined && (typeof v.tokenEnv !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(v.tokenEnv))) throw new ToolError('INVALID_ARGUMENT', `machines[${index}].tokenEnv must be a valid environment variable name.`);
  if (v.name !== undefined && typeof v.name !== 'string') throw new ToolError('INVALID_ARGUMENT', `machines[${index}].name must be a string.`);
  if (v.hostname !== undefined && typeof v.hostname !== 'string') throw new ToolError('INVALID_ARGUMENT', `machines[${index}].hostname must be a string.`);
  if (v.enabled !== undefined && typeof v.enabled !== 'boolean') throw new ToolError('INVALID_ARGUMENT', `machines[${index}].enabled must be a boolean.`);
  return { id: v.id, endpoint: normalizeMachineEndpoint(v.endpoint), name: v.name as string | undefined, hostname: v.hostname as string | undefined, aliases: aliases as string[] | undefined, tokenEnv: v.tokenEnv as string | undefined, enabled: v.enabled as boolean | undefined };
}

export function readMachineRegistry(file?: string): MachineRegistryDocument {
  if (!file || !existsSync(file)) return { version: 1, machines: [] };
  let parsed: unknown;
  try { parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown; } catch (error) { throw new ToolError('INVALID_ARGUMENT', `Could not parse machine registry ${file}: ${error instanceof Error ? error.message : String(error)}`); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new ToolError('INVALID_ARGUMENT', 'Machine registry must be a JSON object.');
  const doc = parsed as Record<string, unknown>;
  if (doc.version !== 1) throw new ToolError('INVALID_ARGUMENT', `Unsupported machine registry version: ${String(doc.version)}.`);
  if (!Array.isArray(doc.machines)) throw new ToolError('INVALID_ARGUMENT', 'Machine registry must contain a machines array.');
  const machines = doc.machines.map(validateEntry);
  const ids = new Set<string>();
  for (const machine of machines) { const key = machine.id.toLowerCase(); if (ids.has(key)) throw new ToolError('AMBIGUOUS_MATCH', `Duplicate machine id: ${machine.id}`); ids.add(key); }
  return { version: 1, machines };
}

export function writeMachineRegistry(file: string, registry: MachineRegistryDocument): void {
  const validated: MachineRegistryDocument = { version: 1, machines: registry.machines.map(validateEntry) };
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(validated, null, 2)}\n`, 'utf8');
}

export function upsertMachine(file: string, entry: MachineRegistryEntry): MachineRegistryEntry {
  const registry = readMachineRegistry(file);
  const validated = validateEntry(entry, registry.machines.length);
  const i = registry.machines.findIndex((m) => m.id.toLowerCase() === validated.id.toLowerCase());
  if (i >= 0) registry.machines[i] = validated; else registry.machines.push(validated);
  writeMachineRegistry(file, registry);
  return validated;
}

export function removeMachine(file: string, id: string): boolean {
  const registry = readMachineRegistry(file);
  const before = registry.machines.length;
  registry.machines = registry.machines.filter((m) => m.id.toLowerCase() !== id.toLowerCase());
  if (registry.machines.length === before) return false;
  writeMachineRegistry(file, registry);
  return true;
}

function selectors(machine: MachineRegistryEntry): string[] {
  const url = new URL(machine.endpoint);
  return [machine.id, machine.name, machine.hostname, url.hostname.replace(/^\[|\]$/g, ''), url.host, ...(machine.aliases ?? [])].filter((x): x is string => typeof x === 'string' && x.length > 0).map((x) => x.toLowerCase());
}

export function resolveMachine(registry: MachineRegistryDocument, selector: string): MachineRegistryEntry {
  const needle = selector.trim().toLowerCase();
  if (!needle) throw new ToolError('INVALID_ARGUMENT', 'machine selector is required.');
  const matches = registry.machines.filter((m) => m.enabled !== false && selectors(m).includes(needle));
  if (matches.length === 0) throw new ToolError('NOT_FOUND', `No registered machine matches "${selector}".`, 'Use machines_list to see registered machine ids, names, hostnames, and IP addresses.');
  if (matches.length > 1) throw new ToolError('AMBIGUOUS_MATCH', `Machine selector "${selector}" matches more than one registered machine.`, 'Use the unique machine id.', { matches: matches.map((m) => m.id) });
  return matches[0];
}

function publicMachine(machine: MachineRegistryEntry) {
  const url = new URL(machine.endpoint);
  return { id: machine.id, name: machine.name, hostname: machine.hostname, endpoint: machine.endpoint, address: url.hostname.replace(/^\[|\]$/g, ''), aliases: machine.aliases ?? [], enabled: machine.enabled !== false, authentication: machine.tokenEnv ? (process.env[machine.tokenEnv] ? 'configured' : 'missing') : 'none', tokenEnv: machine.tokenEnv };
}

function authHeaders(machine: MachineRegistryEntry): Record<string, string> {
  if (!machine.tokenEnv) return {};
  const token = process.env[machine.tokenEnv];
  if (!token) throw new ToolError('PRECONDITION_FAILED', `Environment variable ${machine.tokenEnv} is not set for machine ${machine.id}.`, `Set ${machine.tokenEnv} before starting the tunnel/gateway.`);
  return { authorization: `Bearer ${token}` };
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...init, signal: controller.signal }); }
  catch (error) { if (controller.signal.aborted) throw new ToolError('TIMEOUT', `Remote machine request timed out after ${timeoutMs} ms.`); throw new ToolError('NETWORK', error instanceof Error ? error.message : String(error)); }
  finally { clearTimeout(timer); }
}

async function rpc(machine: MachineRegistryEntry, method: string, params: Record<string, unknown> | undefined, timeoutMs: number): Promise<unknown> {
  const response = await fetchWithTimeout(machine.endpoint, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json', ...authHeaders(machine) }, body: JSON.stringify({ jsonrpc: '2.0', id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, method, ...(params ? { params } : {}) }) }, timeoutMs);
  const text = await response.text();
  if (!response.ok) throw new ToolError('NETWORK', `Machine ${machine.id} returned HTTP ${response.status}.`, undefined, { status: response.status, body: text.slice(0, 2048) });
  let payload: Record<string, unknown>;
  try { payload = JSON.parse(text) as Record<string, unknown>; } catch { throw new ToolError('NETWORK', `Machine ${machine.id} returned a non-JSON MCP response.`, undefined, { body: text.slice(0, 2048) }); }
  if (payload.error) throw new ToolError('REMOTE_ERROR', `Remote MCP error from ${machine.id}.`, undefined, { remote: payload.error as Record<string, unknown> });
  if (!('result' in payload)) throw new ToolError('REMOTE_ERROR', `Remote MCP response from ${machine.id} did not contain a result.`);
  return payload.result;
}

function decodeToolResult(result: unknown): unknown {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return result;
  const content = (result as Record<string, unknown>).content;
  if (Array.isArray(content) && content.length === 1) {
    const item = content[0] as Record<string, unknown> | undefined;
    if (item?.type === 'text' && typeof item.text === 'string') { try { return JSON.parse(item.text) as unknown; } catch { return item.text; } }
  }
  return result;
}

async function probe(machine: MachineRegistryEntry, timeoutMs: number) {
  const startedAt = Date.now();
  const health = new URL('/healthz', machine.endpoint).toString();
  try {
    const response = await fetchWithTimeout(health, { headers: { accept: 'application/json', ...authHeaders(machine) } }, timeoutMs);
    const body = await response.text(); let details: unknown = body; try { details = JSON.parse(body) as unknown; } catch {}
    return { ...publicMachine(machine), online: response.ok, latencyMs: Date.now() - startedAt, statusCode: response.status, health: details };
  } catch (error) { return { ...publicMachine(machine), online: false, latencyMs: Date.now() - startedAt, error: error instanceof Error ? error.message : String(error) }; }
}

export function createMachineRoutingSpecs(options: RouterOptions): ToolSpec[] {
  const registry = () => readMachineRegistry(options.machinesFile);
  const timeout = Math.max(1_000, Math.min(options.timeoutMs, 60_000));
  return [
    { name: 'machines_list', description: 'List registered remote machines. Selectors may be id, name, hostname, alias, IP address, or host:port. This call does not contact remote machines.', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }, handler: async () => ({ registryFile: options.machinesFile, machines: registry().machines.map(publicMachine) }) },
    { name: 'machine_probe', description: 'Check health and latency of one registered remote machine selected by id, name, hostname, alias, IP address, or host:port.', inputSchema: { type: 'object', properties: { machine: { type: 'string' }, timeout_ms: { type: 'integer', minimum: 1000, maximum: 60000 } }, required: ['machine'] }, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true }, handler: async (args) => { if (typeof args.machine !== 'string' || !args.machine) throw new ToolError('INVALID_ARGUMENT', '"machine" is required.'); const t = typeof args.timeout_ms === 'number' && Number.isInteger(args.timeout_ms) ? args.timeout_ms : timeout; return probe(resolveMachine(registry(), args.machine), t); } },
    { name: 'machine_tools', description: 'List tool names and annotations exposed by one registered remote machine.', inputSchema: { type: 'object', properties: { machine: { type: 'string' } }, required: ['machine'] }, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true }, handler: async (args) => { if (typeof args.machine !== 'string' || !args.machine) throw new ToolError('INVALID_ARGUMENT', '"machine" is required.'); const machine = resolveMachine(registry(), args.machine); const result = await rpc(machine, 'tools/list', undefined, timeout) as { tools?: Array<Record<string, unknown>> }; return { machine: publicMachine(machine), tools: (result.tools ?? []).map((tool) => ({ name: tool.name, description: tool.description, annotations: tool.annotations })) }; } },
    { name: 'machine_call', description: 'Run one MCP tool on a registered remote machine. The remote machine still enforces its own policy, workspace boundary, approvals, and audit log.', inputSchema: { type: 'object', properties: { machine: { type: 'string' }, tool: { type: 'string' }, arguments: { type: 'object' }, timeout_ms: { type: 'integer', minimum: 1000, maximum: 60000 } }, required: ['machine', 'tool'] }, annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true }, handler: async (args) => { if (typeof args.machine !== 'string' || !args.machine) throw new ToolError('INVALID_ARGUMENT', '"machine" is required.'); if (typeof args.tool !== 'string' || !args.tool) throw new ToolError('INVALID_ARGUMENT', '"tool" is required.'); if (ROUTER_TOOLS.has(args.tool)) throw new ToolError('INVALID_ARGUMENT', `Routing tool ${args.tool} cannot be called through machine_call.`); if (args.arguments !== undefined && (!args.arguments || typeof args.arguments !== 'object' || Array.isArray(args.arguments))) throw new ToolError('INVALID_ARGUMENT', '"arguments" must be an object.'); const t = typeof args.timeout_ms === 'number' && Number.isInteger(args.timeout_ms) ? args.timeout_ms : timeout; const machine = resolveMachine(registry(), args.machine); const raw = await rpc(machine, 'tools/call', { name: args.tool, arguments: (args.arguments as Record<string, unknown> | undefined) ?? {} }, t); const decoded = decodeToolResult(raw); if ((raw as { isError?: boolean } | undefined)?.isError === true || (decoded && typeof decoded === 'object' && !Array.isArray(decoded) && (decoded as Record<string, unknown>).ok === false)) throw new ToolError('REMOTE_ERROR', `Remote tool ${args.tool} failed on machine ${machine.id}.`, undefined, { machine: machine.id, tool: args.tool, result: decoded as Record<string, unknown> }); return { machine: publicMachine(machine), tool: args.tool, result: decoded }; } },
  ];
}
