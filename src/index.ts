#!/usr/bin/env node

import { randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { describeError } from './errors.js';
import { createToolSpecs, type ToolSpec } from './tools.js';

interface Options {
  root: string;
  dangerouslyOpenMachine: boolean;
  maxTimeoutMs: number;
  http: boolean;
  httpHost: string;
  httpPort: number;
  httpToken?: string;
  check: boolean;
}

function valueAfter(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value.`);
  return value;
}

export function parseOptions(args: string[]): Options {
  const options: Options = {
    root: process.cwd(),
    dangerouslyOpenMachine: false,
    maxTimeoutMs: 10 * 60_000,
    http: false,
    httpHost: '127.0.0.1',
    httpPort: 8787,
    httpToken: process.env.MCP_HTTP_TOKEN,
    check: false,
  };

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--root') options.root = valueAfter(args, index++, arg);
    else if (arg === '--dangerously-open-machine') options.dangerouslyOpenMachine = true;
    else if (arg === '--max-timeout') options.maxTimeoutMs = Number(valueAfter(args, index++, arg));
    else if (arg === '--http') options.http = true;
    else if (arg === '--http-host') options.httpHost = valueAfter(args, index++, arg);
    else if (arg === '--http-port') options.httpPort = Number(valueAfter(args, index++, arg));
    else if (arg === '--http-token') options.httpToken = valueAfter(args, index++, arg);
    else if (arg === '--check') options.check = true;
    else if (arg === '--help' || arg === '-h') {
      process.stdout.write(`chatgpt-machine-mcp\n\n` +
        `  --root <path>                 Default workspace and safe-mode boundary\n` +
        `  --dangerously-open-machine    Allow absolute paths, arbitrary shell, and unrestricted Codex\n` +
        `  --max-timeout <ms>            Maximum tool timeout (default: 600000)\n` +
        `  --http                        Use Streamable HTTP instead of stdio\n` +
        `  --http-host <host>            HTTP bind host (default: 127.0.0.1)\n` +
        `  --http-port <port>            HTTP port (default: 8787)\n` +
        `  --http-token <token>          Optional Bearer token; required off loopback\n` +
        `  --check                       Print configuration and the tool list, then exit\n`);
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  options.root = path.resolve(options.root);
  if (!Number.isInteger(options.maxTimeoutMs) || options.maxTimeoutMs < 1_000) {
    throw new Error('--max-timeout must be an integer of at least 1000 milliseconds.');
  }
  if (!Number.isInteger(options.httpPort) || options.httpPort < 1 || options.httpPort > 65_535) {
    throw new Error('--http-port must be an integer between 1 and 65535.');
  }
  if (options.http && !['127.0.0.1', 'localhost', '::1'].includes(options.httpHost) && !options.httpToken) {
    throw new Error('HTTP binding outside loopback requires --http-token or MCP_HTTP_TOKEN.');
  }
  return options;
}

function textResult(value: unknown, isError = false) {
  return {
    content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
    ...(isError ? { isError: true } : {}),
  };
}

/**
 * Every tool answers with the same envelope. A caller can branch on "ok" and, on
 * failure, on a stable "error.code" instead of pattern-matching prose.
 */
function successResult(value: unknown) {
  return textResult({ ok: true, ...(value as Record<string, unknown>) });
}

function errorResult(toolName: string, error: unknown) {
  return textResult({ ok: false, tool: toolName, error: describeError(error) }, true);
}

function createMcpServer(options: Options): Server {
  const specs = createToolSpecs({
    root: options.root,
    unrestricted: options.dangerouslyOpenMachine,
    maxTimeoutMs: options.maxTimeoutMs,
  });
  const byName = new Map<string, ToolSpec>(specs.map((spec) => [spec.name, spec]));
  const server = new Server(
    { name: 'chatgpt-machine-mcp', version: '0.2.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: specs.map(({ name, description, inputSchema, annotations }) => ({
      name,
      description,
      inputSchema,
      annotations,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    const spec = byName.get(name);
    if (!spec) {
      return textResult({
        ok: false,
        tool: name,
        error: {
          code: 'UNKNOWN_TOOL',
          message: `Unknown tool: ${name}`,
          details: { available: specs.map((entry) => entry.name) },
        },
      }, true);
    }
    try {
      const result = await spec.handler((request.params.arguments ?? {}) as Record<string, unknown>);
      // A finished command that failed is a successful tool call reporting a failure,
      // but callers rely on isError to notice it, so surface both.
      const failed = name === 'shell_command'
        && ((result as { exitCode?: number | null }).exitCode !== 0 || (result as { timedOut?: boolean }).timedOut === true);
      return failed ? textResult({ ok: false, ...(result as Record<string, unknown>) }, true) : successResult(result);
    } catch (error: unknown) {
      return errorResult(name, error);
    }
  });

  return server;
}

function addCorsHeaders(res: ServerResponse): void {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-headers', 'authorization, content-type, mcp-session-id, mcp-protocol-version, last-event-id');
  res.setHeader('access-control-allow-methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('access-control-expose-headers', 'mcp-session-id, mcp-protocol-version, last-event-id');
}

function hasValidBearerToken(req: IncomingMessage, expectedToken?: string): boolean {
  if (!expectedToken) return true;
  const value = req.headers.authorization;
  if (!value?.startsWith('Bearer ')) return false;
  const actual = Buffer.from(value.slice('Bearer '.length));
  const expected = Buffer.from(expectedToken);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  if (options.check) {
    const specs = createToolSpecs({
      root: options.root,
      unrestricted: options.dangerouslyOpenMachine,
      maxTimeoutMs: options.maxTimeoutMs,
    });
    process.stdout.write(JSON.stringify({
      ok: true,
      root: options.root,
      accessMode: options.dangerouslyOpenMachine ? 'UNRESTRICTED_MACHINE' : 'WORKSPACE_ONLY',
      transport: options.http ? 'streamable-http' : 'stdio',
      endpoint: options.http ? `http://${options.httpHost}:${options.httpPort}/mcp` : undefined,
      tools: specs.map((spec) => spec.name),
    }, null, 2) + '\n');
    return;
  }

  const server = createMcpServer(options);
  let closeTransport: (() => Promise<void>) | undefined;
  let closeHttpServer: (() => Promise<void>) | undefined;

  if (options.http) {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      enableJsonResponse: true,
    });
    await server.connect(transport);
    const httpServer = createServer(async (req, res) => {
      addCorsHeaders(res);
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }
      const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
      if ((pathname === '/healthz' || pathname === '/readyz') && req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          service: 'chatgpt-machine-mcp',
          accessMode: options.dangerouslyOpenMachine ? 'UNRESTRICTED_MACHINE' : 'WORKSPACE_ONLY',
          endpoint: '/mcp',
        }));
        return;
      }
      if (pathname !== '/mcp') {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
        return;
      }
      if (!hasValidBearerToken(req, options.httpToken)) {
        res.writeHead(401, { 'content-type': 'application/json', 'www-authenticate': 'Bearer' });
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }
      try {
        await transport.handleRequest(req, res);
      } catch (error: unknown) {
        if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
        if (!res.writableEnded) {
          res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
        }
      }
    });
    await new Promise<void>((resolve, reject) => {
      httpServer.once('error', reject);
      httpServer.listen(options.httpPort, options.httpHost, resolve);
    });
    console.error(`[chatgpt-machine-mcp] listening at http://${options.httpHost}:${options.httpPort}/mcp`);
    console.error(`[chatgpt-machine-mcp] access mode: ${options.dangerouslyOpenMachine ? 'UNRESTRICTED_MACHINE' : 'WORKSPACE_ONLY'}`);
    closeTransport = () => transport.close();
    closeHttpServer = () => new Promise<void>((resolve, reject) => {
      httpServer.close((error) => error ? reject(error) : resolve());
    });
  } else {
    const transport = new StdioServerTransport();
    await server.connect(transport);
  }

  const cleanup = async () => {
    await closeTransport?.();
    await closeHttpServer?.();
    process.exit(0);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
