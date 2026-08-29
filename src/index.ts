#!/usr/bin/env node

import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import {
  acceptedContent,
  createMcpHandler,
  createRequestStateCodec,
  inputRequired,
  inputResponse,
  Server,
  type RequestStateCodec,
} from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { context as otelContext, propagation } from '@opentelemetry/api';
import {
  createApprovalRequestState,
  matchesApprovalRequestState,
  type ApprovalRequestState,
} from './approval-state.js';
import { AuditLogger, defaultAuditPath } from './audit.js';
import { describeError, ToolError } from './errors.js';
import { evaluatePolicy, loadPolicy, type PolicyConfig } from './policy.js';
import { withToolSpan } from './telemetry.js';
import { createToolSpecs, type ToolSpec } from './tools.js';

interface Options {
  root: string;
  dangerouslyOpenMachine: boolean;
  maxTimeoutMs: number;
  http: boolean;
  httpHost: string;
  httpPort: number;
  httpToken?: string;
  policy: string;
  approvalMode: 'mrtr' | 'deny';
  auditFile?: string;
  check: boolean;
}

interface Runtime {
  options: Options;
  policy: PolicyConfig;
  audit: AuditLogger;
  approvalState: RequestStateCodec<ApprovalRequestState>;
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
    policy: process.env.MCP_POLICY ?? 'admin',
    approvalMode: 'mrtr',
    auditFile: process.env.MCP_AUDIT_FILE,
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
    else if (arg === '--policy') options.policy = valueAfter(args, index++, arg);
    else if (arg === '--approval-mode') options.approvalMode = valueAfter(args, index++, arg) as Options['approvalMode'];
    else if (arg === '--audit-file') options.auditFile = valueAfter(args, index++, arg);
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
        `  --policy <profile|file>       admin (default), developer, readonly, or a JSON policy file\n` +
        `  --approval-mode <mode>        mrtr (default) or deny when a policy requires approval\n` +
        `  --audit-file <path>           NDJSON audit log (default: <root>/.chatgpt-machine/audit.ndjson)\n` +
        `  --check                       Print configuration and the tool list, then exit\n`);
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  options.root = path.resolve(options.root);
  if (options.auditFile) options.auditFile = path.resolve(options.root, options.auditFile);
  if (!Number.isInteger(options.maxTimeoutMs) || options.maxTimeoutMs < 1_000) {
    throw new Error('--max-timeout must be an integer of at least 1000 milliseconds.');
  }
  if (!Number.isInteger(options.httpPort) || options.httpPort < 1 || options.httpPort > 65_535) {
    throw new Error('--http-port must be an integer between 1 and 65535.');
  }
  if (!['mrtr', 'deny'].includes(options.approvalMode)) throw new Error('--approval-mode must be one of: mrtr, deny.');
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

function createMcpServer(runtime: Runtime): Server {
  const { options, policy, audit, approvalState } = runtime;
  const specs = createToolSpecs({
    root: options.root,
    unrestricted: options.dangerouslyOpenMachine,
    maxTimeoutMs: options.maxTimeoutMs,
    policyName: policy.name,
    approvalMode: options.approvalMode,
    audit,
  });
  const byName = new Map<string, ToolSpec>(specs.map((spec) => [spec.name, spec]));
  const server = new Server(
    { name: 'chatgpt-machine-mcp', version: '0.3.0' },
    {
      capabilities: { tools: {} },
      cacheHints: {
        'tools/list': { ttlMs: 30_000, cacheScope: 'private' },
      },
      requestState: {
        verify: (state, ctx) => approvalState.verify(state, ctx),
      },
    },
  );

  server.setRequestHandler('tools/list', async () => ({
    tools: specs.map(({ name, description, inputSchema, annotations }) => ({
      name,
      description,
      inputSchema,
      annotations,
    })),
  }));

  server.setRequestHandler('tools/call', async (request, ctx) => {
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
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;
    return withToolSpan(name, {
      'mcp.tool.name': name,
      'mcp.tool.read_only': spec.annotations.readOnlyHint,
      'mcp.tool.open_world': spec.annotations.openWorldHint,
      'mcp.policy.name': policy.name,
    }, async (traceId) => {
      const startedAt = Date.now();
      const decision = evaluatePolicy(policy, spec, args, options.root);
      if (!decision.allowed) {
        const error = new ToolError('POLICY_DENIED', decision.reason ?? `Tool ${name} was denied by policy.`);
        await audit.write({ traceId, tool: name, policy: policy.name, decision: 'denied', status: 'error', durationMs: Date.now() - startedAt, args, errorCode: error.code });
        return errorResult(name, error);
      }

      if (decision.requiresApproval) {
        if (options.approvalMode === 'deny') {
          const error = new ToolError('APPROVAL_REQUIRED', `Tool ${name} requires approval under policy ${policy.name}.`, 'Restart with --approval-mode mrtr to request approval interactively.');
          await audit.write({ traceId, tool: name, policy: policy.name, decision: 'approval_required', status: 'error', durationMs: Date.now() - startedAt, args, errorCode: error.code });
          return errorResult(name, error);
        }

        const view = inputResponse(ctx.mcpReq.inputResponses, 'approval');
        if (view.kind === 'elicit' && view.action !== 'accept') {
          const error = new ToolError('APPROVAL_REQUIRED', `Approval for ${name} was ${view.action}d.`);
          await audit.write({ traceId, tool: name, policy: policy.name, decision: 'approval_required', status: 'error', durationMs: Date.now() - startedAt, args, errorCode: error.code });
          return errorResult(name, error);
        }
        const approval = acceptedContent<{ approve?: boolean }>(ctx.mcpReq.inputResponses, 'approval');
        if (!approval) {
          await audit.write({ traceId, tool: name, policy: policy.name, decision: 'approval_required', status: 'input_required', durationMs: Date.now() - startedAt, args });
          return inputRequired({
            requestState: await approvalState.mint(createApprovalRequestState(name, args)),
            inputRequests: {
              approval: inputRequired.elicit({
                message: `Approve machine tool "${name}" under policy "${policy.name}"?`,
                requestedSchema: {
                  type: 'object',
                  properties: { approve: { type: 'boolean', title: 'Approve' } },
                  required: ['approve'],
                },
              }),
            },
          });
        }
        const verifiedState = ctx.mcpReq.requestState<ApprovalRequestState>();
        if (!matchesApprovalRequestState(verifiedState, name, args)) {
          const error = new ToolError('APPROVAL_REQUIRED', `Approval state for ${name} is missing, expired, or does not match this tool call.`);
          await audit.write({ traceId, tool: name, policy: policy.name, decision: 'approval_required', status: 'error', durationMs: Date.now() - startedAt, args, errorCode: error.code });
          return errorResult(name, error);
        }
        if (approval.approve !== true) {
          const error = new ToolError('APPROVAL_REQUIRED', `Approval for ${name} was denied.`);
          await audit.write({ traceId, tool: name, policy: policy.name, decision: 'approval_required', status: 'error', durationMs: Date.now() - startedAt, args, errorCode: error.code });
          return errorResult(name, error);
        }
      }

      try {
        const result = await spec.handler(args);
        const failed = name === 'shell_command'
          && ((result as { exitCode?: number | null }).exitCode !== 0 || (result as { timedOut?: boolean }).timedOut === true);
        await audit.write({
          traceId,
          tool: name,
          policy: policy.name,
          decision: decision.requiresApproval ? 'approval_required' : 'allowed',
          status: failed ? 'error' : 'success',
          durationMs: Date.now() - startedAt,
          args,
          errorCode: failed ? 'COMMAND_FAILED' : undefined,
        });
        return failed ? textResult({ ok: false, ...(result as Record<string, unknown>) }, true) : successResult(result);
      } catch (error: unknown) {
        const described = describeError(error);
        await audit.write({ traceId, tool: name, policy: policy.name, decision: decision.requiresApproval ? 'approval_required' : 'allowed', status: 'error', durationMs: Date.now() - startedAt, args, errorCode: described.code });
        return errorResult(name, error);
      }
    });
  });

  return server;
}

function addCorsHeaders(res: ServerResponse): void {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-headers', [
    'authorization',
    'content-type',
    'mcp-method',
    'mcp-name',
    'mcp-protocol-version',
    'traceparent',
    'tracestate',
    'baggage',
    'last-event-id',
  ].join(', '));
  res.setHeader('access-control-allow-methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('access-control-expose-headers', 'mcp-protocol-version, last-event-id');
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
  const policy = loadPolicy(options.policy, options.root);
  const audit = new AuditLogger(options.auditFile ?? defaultAuditPath(options.root));
  const approvalState = createRequestStateCodec<ApprovalRequestState>({
    key: randomBytes(32),
    ttlSeconds: 5 * 60,
  });
  const runtime: Runtime = { options, policy, audit, approvalState };
  if (options.check) {
    const specs = createToolSpecs({
      root: options.root,
      unrestricted: options.dangerouslyOpenMachine,
      maxTimeoutMs: options.maxTimeoutMs,
      policyName: policy.name,
      approvalMode: options.approvalMode,
      audit,
    });
    process.stdout.write(JSON.stringify({
      ok: true,
      root: options.root,
      accessMode: options.dangerouslyOpenMachine ? 'UNRESTRICTED_MACHINE' : 'WORKSPACE_ONLY',
      transport: options.http ? 'streamable-http' : 'stdio',
      endpoint: options.http ? `http://${options.httpHost}:${options.httpPort}/mcp` : undefined,
      policy: policy.name,
      approvalMode: options.approvalMode,
      auditFile: audit.filePath,
      tools: specs.map((spec) => spec.name),
    }, null, 2) + '\n');
    return;
  }

  let closeMcp: (() => Promise<void>) | undefined;
  let closeHttpServer: (() => Promise<void>) | undefined;

  if (options.http) {
    const handler = createMcpHandler(() => createMcpServer(runtime), {
      legacy: 'stateless',
      responseMode: 'json',
      onerror: (error) => console.error('[chatgpt-machine-mcp] MCP error:', error.message),
    });
    const handleMcpRequest = toNodeHandler(handler, {
      onerror: (error) => console.error('[chatgpt-machine-mcp] HTTP adapter error:', error.message),
    });
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
        const carrier = Object.fromEntries(
          Object.entries(req.headers).flatMap(([key, value]) => typeof value === 'string' ? [[key, value]] : []),
        );
        const extracted = propagation.extract(otelContext.active(), carrier);
        await otelContext.with(extracted, () => handleMcpRequest(req, res));
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
    console.error(`[chatgpt-machine-mcp] policy: ${policy.name} (approval=${options.approvalMode})`);
    closeMcp = () => handler.close();
    closeHttpServer = () => new Promise<void>((resolve, reject) => {
      httpServer.close((error) => error ? reject(error) : resolve());
    });
  } else {
    const handle = serveStdio(() => createMcpServer(runtime), {
      legacy: 'serve',
      onerror: (error) => console.error('[chatgpt-machine-mcp] stdio MCP error:', error.message),
    });
    closeMcp = () => handle.close();
  }

  const cleanup = async () => {
    await closeMcp?.();
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
