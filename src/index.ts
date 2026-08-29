#!/usr/bin/env node

import { randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import {
  editMachineFile,
  fileInfo,
  findFiles,
  imageInfo,
  listDirectory,
  readMachineFile,
  saveImageFromUrl,
  searchCode,
  updateMachineFile,
  writeMachineFile,
} from './file-tools.js';
import { applyFilePatch, runShellCommand, type MachineAccess, type ShellKind } from './shell-tools.js';
import { processStatus, readProcessOutput, startProcess, stopProcess } from './process-tools.js';
import { gitDiff, gitStatus } from './git-tools.js';

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
        `  --check                       Print configuration and exit\n`);
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

function createMcpServer(options: Options): Server {
  const access: MachineAccess = {
    root: options.root,
    unrestricted: options.dangerouslyOpenMachine,
  };
  const server = new Server(
    { name: 'chatgpt-machine-mcp', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'machine_status',
        description: 'Show the bridge access mode, default workspace, and platform.',
        inputSchema: { type: 'object', properties: {} },
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },
      {
        name: 'read_file',
        description: 'Read a UTF-8 text file with line and byte limits.',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'File path relative to the workspace or an allowed absolute path.' },
            start_line: { type: 'integer', minimum: 1, description: 'First line to return (1-based).' },
            max_lines: { type: 'integer', minimum: 1, maximum: 10000, description: 'Maximum lines to return.' },
            max_bytes: { type: 'integer', minimum: 1, maximum: 1048576, description: 'Maximum UTF-8 bytes to return.' },
          },
          required: ['path'],
        },
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },
      {
        name: 'list_directory',
        description: 'List files, directories, and symlinks without running a shell command.',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Directory path; defaults to the workspace root.' },
            max_entries: { type: 'integer', minimum: 1, maximum: 5000, description: 'Maximum returned entries.' },
            include_hidden: { type: 'boolean', description: 'Include names beginning with a dot; defaults to false.' },
          },
        },
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },
      {
        name: 'find_files',
        description: 'Find files recursively by glob without reading their contents or running a shell command.',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Directory to search; defaults to the workspace root.' },
            glob: { type: 'string', description: 'Glob such as **/*.ts; defaults to **/*.' },
            max_results: { type: 'integer', minimum: 1, maximum: 5000, description: 'Maximum returned paths.' },
            max_depth: { type: 'integer', minimum: 1, maximum: 100, description: 'Maximum recursive directory depth.' },
            include_hidden: { type: 'boolean', description: 'Traverse names beginning with a dot; defaults to false.' },
          },
        },
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },
      {
        name: 'file_info',
        description: 'Get file or directory metadata and an optional SHA-256 hash for regular files.',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Path to inspect.' },
            include_hash: { type: 'boolean', description: 'Calculate SHA-256 for regular files; defaults to true.' },
          },
          required: ['path'],
        },
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },
      {
        name: 'image_info',
        description: 'Inspect a local PNG, JPEG, or WebP image and return dimensions, size, and SHA-256.',
        inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'Image path to inspect.' } }, required: ['path'] },
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },
      {
        name: 'save_image_from_url',
        description: 'Download an HTTPS PNG, JPEG, or WebP image to the machine. Blocks local/private hosts, limits redirects and size, and does not send cookies or credentials.',
        inputSchema: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'HTTPS image URL.' },
            path: { type: 'string', description: 'Destination image path.' },
            overwrite: { type: 'boolean', description: 'Allow replacing an existing file; defaults to false.' },
          },
          required: ['url', 'path'],
        },
        annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
      },
      {
        name: 'search_code',
        description: 'Search file contents with ripgrep and return structured path, line, column, and text matches.',
        inputSchema: {
          type: 'object',
          properties: {
            pattern: { type: 'string', description: 'Regular expression or literal text to search for.' },
            path: { type: 'string', description: 'File or directory to search; defaults to the workspace.' },
            globs: { type: 'array', items: { type: 'string' }, description: 'Optional ripgrep include/exclude globs.' },
            case_sensitive: { type: 'boolean', description: 'Use case-sensitive matching; defaults to true.' },
            literal: { type: 'boolean', description: 'Treat pattern as literal text instead of a regular expression.' },
            max_results: { type: 'integer', minimum: 1, maximum: 2000, description: 'Maximum returned matches.' },
            timeout_ms: { type: 'integer', minimum: 1, maximum: 60000, description: 'Search timeout in milliseconds.' },
          },
          required: ['pattern'],
        },
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },
      {
        name: 'write_file',
        description: 'Create a UTF-8 text file, or replace it only when overwrite is explicitly true.',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Destination file path.' },
            content: { type: 'string', description: 'Complete UTF-8 file content.' },
            overwrite: { type: 'boolean', description: 'Allow replacing an existing file; defaults to false.' },
          },
          required: ['path', 'content'],
        },
        annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
      },
      {
        name: 'edit_file',
        description: 'Replace exact text in an existing UTF-8 file; ambiguous matches are rejected unless replace_all is true.',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Existing text file path.' },
            old_text: { type: 'string', description: 'Exact text to find.' },
            new_text: { type: 'string', description: 'Replacement text.' },
            replace_all: { type: 'boolean', description: 'Replace every occurrence; defaults to false.' },
          },
          required: ['path', 'old_text', 'new_text'],
        },
        annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
      },
      {
        name: 'update_file',
        description: 'Replace an inclusive 1-based line range in an existing UTF-8 text file.',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Existing text file path.' },
            start_line: { type: 'integer', minimum: 1, description: 'First line to replace (1-based).' },
            end_line: { type: 'integer', minimum: 1, description: 'Last line to replace (inclusive).' },
            content: { type: 'string', description: 'Replacement content; an empty string deletes the selected lines.' },
          },
          required: ['path', 'start_line', 'end_line', 'content'],
        },
        annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
      },
      {
        name: 'shell_command',
        description: options.dangerouslyOpenMachine
          ? 'Run an arbitrary shell command anywhere on this machine. This tool has unrestricted machine access.'
          : 'Run a shell command inside the configured workspace root.',
        inputSchema: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'Command to execute.' },
            workdir: { type: 'string', description: 'Absolute path or path relative to the default workspace.' },
            shell: { type: 'string', enum: ['auto', 'powershell', 'cmd', 'bash'] },
            timeout_ms: { type: 'number', description: 'Timeout in milliseconds.' },
            max_output_bytes: { type: 'number', description: 'Maximum combined stdout/stderr bytes (1024-4194304).' },
          },
          required: ['command'],
        },
        annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
      },
      {
        name: 'start_process',
        description: options.dangerouslyOpenMachine ? 'Start a background PowerShell, cmd, or Bash process anywhere on this machine and return its PID.' : 'Start a background process inside the configured workspace and return its PID.',
        inputSchema: {
          type: 'object', properties: {
            command: { type: 'string', description: 'Command to run in the background.' },
            workdir: { type: 'string', description: 'Working directory.' },
            shell: { type: 'string', enum: ['auto', 'powershell', 'cmd', 'bash'] },
          }, required: ['command'],
        },
        annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
      },
      {
        name: 'process_status',
        description: 'Get the status and exit information for a managed background process.',
        inputSchema: { type: 'object', properties: { pid: { type: 'integer', minimum: 1, description: 'Process ID returned by start_process.' } }, required: ['pid'] },
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },
      {
        name: 'read_process_output',
        description: 'Read captured stdout and stderr from a managed background process.',
        inputSchema: { type: 'object', properties: { pid: { type: 'integer', minimum: 1, description: 'Process ID returned by start_process.' } }, required: ['pid'] },
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },
      {
        name: 'stop_process',
        description: 'Stop a managed background process and its child tree by PID.',
        inputSchema: { type: 'object', properties: { pid: { type: 'integer', minimum: 1, description: 'Process ID returned by start_process.' } }, required: ['pid'] },
        annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
      },
      {
        name: 'apply_patch',
        description: options.dangerouslyOpenMachine
          ? 'Add, update, move, or delete files anywhere on this machine using Codex patch format.'
          : 'Add, update, move, or delete files inside the configured workspace using Codex patch format.',
        inputSchema: {
          type: 'object',
          properties: {
            patch: {
              type: 'string',
              description: 'Patch beginning with *** Begin Patch and ending with *** End Patch.',
            },
            dry_run: { type: 'boolean', description: 'Validate and report changes without writing files.' },
          },
          required: ['patch'],
        },
        annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
      },
      {
        name: 'git_status',
        description: 'Read the current Git branch and working-tree status without running a shell command.',
        inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'Git repository directory; defaults to the workspace.' } } },
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },
      {
        name: 'git_diff',
        description: 'Read Git working-tree or staged diff without running a shell command.',
        inputSchema: {
          type: 'object', properties: {
            path: { type: 'string', description: 'Git repository directory; defaults to the workspace.' },
            staged: { type: 'boolean', description: 'Read the staged diff instead of the working-tree diff.' },
            stat_only: { type: 'boolean', description: 'Return only diff statistics.' },
            max_bytes: { type: 'integer', minimum: 1024, maximum: 4194304, description: 'Maximum diff bytes.' },
          },
        },
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;
    try {
      if (name === 'machine_status') {
        return textResult({
          ok: true,
          platform: process.platform,
          defaultWorkspace: options.root,
          accessMode: options.dangerouslyOpenMachine ? 'UNRESTRICTED_MACHINE' : 'WORKSPACE_ONLY',
          pid: process.pid,
          node: process.version,
          maxTimeoutMs: options.maxTimeoutMs,
          tools: [
            'machine_status',
            'read_file',
            'list_directory',
            'find_files',
            'file_info',
            'image_info',
            'save_image_from_url',
            'search_code',
            'write_file',
            'edit_file',
            'update_file',
            'shell_command',
            'start_process',
            'process_status',
            'read_process_output',
            'stop_process',
            'git_status',
            'git_diff',
            'apply_patch',
          ],
        });
      }
      if (name === 'read_file') {
        return textResult(await readMachineFile({
          ...access,
          filePath: String(args.path ?? ''),
          startLine: args.start_line === undefined ? undefined : Number(args.start_line),
          maxLines: args.max_lines === undefined ? undefined : Number(args.max_lines),
          maxBytes: args.max_bytes === undefined ? undefined : Number(args.max_bytes),
        }));
      }
      if (name === 'list_directory') {
        return textResult(await listDirectory({
          ...access,
          directoryPath: args.path === undefined ? undefined : String(args.path),
          maxEntries: args.max_entries === undefined ? undefined : Number(args.max_entries),
          includeHidden: args.include_hidden === true,
        }));
      }
      if (name === 'find_files') {
        return textResult(await findFiles({
          ...access,
          directoryPath: args.path === undefined ? undefined : String(args.path),
          glob: args.glob === undefined ? undefined : String(args.glob),
          maxResults: args.max_results === undefined ? undefined : Number(args.max_results),
          maxDepth: args.max_depth === undefined ? undefined : Number(args.max_depth),
          includeHidden: args.include_hidden === true,
        }));
      }
      if (name === 'file_info') {
        return textResult(await fileInfo({
          ...access,
          filePath: String(args.path ?? ''),
          includeHash: args.include_hash === undefined ? true : args.include_hash === true,
        }));
      }
      if (name === 'image_info') {
        return textResult(await imageInfo({
          ...access,
          filePath: String(args.path ?? ''),
        }));
      }
      if (name === 'save_image_from_url') {
        return textResult(await saveImageFromUrl({
          ...access,
          url: String(args.url ?? ''),
          filePath: String(args.path ?? ''),
          overwrite: args.overwrite === true,
        }));
      }
      if (name === 'search_code') {
        return textResult(await searchCode({
          ...access,
          pattern: String(args.pattern ?? ''),
          searchPath: args.path === undefined ? undefined : String(args.path),
          globs: Array.isArray(args.globs) ? args.globs.map(String) : undefined,
          caseSensitive: args.case_sensitive === undefined ? true : args.case_sensitive === true,
          literal: args.literal === true,
          maxResults: args.max_results === undefined ? undefined : Number(args.max_results),
          timeoutMs: args.timeout_ms === undefined ? undefined : Number(args.timeout_ms),
        }));
      }
      if (name === 'write_file') {
        return textResult(await writeMachineFile({
          ...access,
          filePath: String(args.path ?? ''),
          content: String(args.content ?? ''),
          overwrite: args.overwrite === true,
        }));
      }
      if (name === 'edit_file') {
        return textResult(await editMachineFile({
          ...access,
          filePath: String(args.path ?? ''),
          oldText: String(args.old_text ?? ''),
          newText: String(args.new_text ?? ''),
          replaceAll: args.replace_all === true,
        }));
      }
      if (name === 'update_file') {
        return textResult(await updateMachineFile({
          ...access,
          filePath: String(args.path ?? ''),
          startLine: Number(args.start_line),
          endLine: Number(args.end_line),
          content: String(args.content ?? ''),
        }));
      }
      if (name === 'shell_command') {
        const result = await runShellCommand({
          ...access,
          command: String(args.command ?? ''),
          workdir: args.workdir === undefined ? undefined : String(args.workdir),
          shell: args.shell === undefined ? 'auto' : String(args.shell) as ShellKind,
          timeoutMs: args.timeout_ms === undefined ? undefined : Number(args.timeout_ms),
          maxTimeoutMs: options.maxTimeoutMs,
          maxOutputBytes: args.max_output_bytes === undefined ? undefined : Number(args.max_output_bytes),
        });
        return textResult(result, result.exitCode !== 0 || result.timedOut);
      }
      if (name === 'start_process') {
        return textResult(await startProcess({
          ...access,
          command: String(args.command ?? ''),
          workdir: args.workdir === undefined ? undefined : String(args.workdir),
          shell: args.shell === undefined ? 'auto' : String(args.shell) as ShellKind,
        }));
      }
      if (name === 'process_status') {
        return textResult(await processStatus({ ...access, pid: Number(args.pid) }));
      }
      if (name === 'read_process_output') {
        return textResult(await readProcessOutput({ ...access, pid: Number(args.pid) }));
      }
      if (name === 'stop_process') {
        return textResult(await stopProcess({ ...access, pid: Number(args.pid) }));
      }
      if (name === 'git_status') {
        return textResult(await gitStatus({ ...access, path: args.path === undefined ? undefined : String(args.path) }));
      }
      if (name === 'git_diff') {
        return textResult(await gitDiff({
          ...access,
          path: args.path === undefined ? undefined : String(args.path),
          staged: args.staged === true,
          statOnly: args.stat_only === true,
          maxBytes: args.max_bytes === undefined ? undefined : Number(args.max_bytes),
        }));
      }
      if (name === 'apply_patch') {
        const dryRun = args.dry_run === true;
        return textResult({ changed: await applyFilePatch(access, String(args.patch ?? ''), dryRun), dryRun });
      }
      return textResult(`Unknown tool: ${name}`, true);
    } catch (error: unknown) {
      return textResult(error instanceof Error ? error.message : String(error), true);
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
    process.stdout.write(JSON.stringify({
      ok: true,
      root: options.root,
      accessMode: options.dangerouslyOpenMachine ? 'UNRESTRICTED_MACHINE' : 'WORKSPACE_ONLY',
      transport: options.http ? 'streamable-http' : 'stdio',
      endpoint: options.http ? `http://${options.httpHost}:${options.httpPort}/mcp` : undefined,
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
