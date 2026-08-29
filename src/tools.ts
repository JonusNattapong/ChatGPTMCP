import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { Tool } from '@modelcontextprotocol/server';
import { AuditLogger, defaultAuditPath } from './audit.js';
import { ToolError } from './errors.js';
import {
  editMachineFile,
  editMachineFileTransaction,
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
import {
  listManagedProcesses,
  processStatus,
  readProcessOutput,
  startProcess,
  stopProcess,
  writeProcessInput,
} from './process-tools.js';
import {
  gitAdd,
  gitBranch,
  gitCheckout,
  gitCommit,
  gitDiff,
  gitLog,
  gitPush,
  gitShow,
  gitStatus,
} from './git-tools.js';
import { diskInfo, environmentInfo, listPorts, listProcesses, networkInfo, systemInfo } from './system-tools.js';

const execFileAsync = promisify(execFile);

export interface ToolContext extends MachineAccess {
  maxTimeoutMs: number;
  policyName?: string;
  approvalMode?: string;
  audit?: AuditLogger;
}

export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: Tool['inputSchema'];
  annotations: {
    readOnlyHint: boolean;
    destructiveHint: boolean;
    openWorldHint: boolean;
  };
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

/*
 * Argument coercion.
 *
 * The previous implementation used String(args.x ?? '') and Number(args.x),
 * which turned a missing or mistyped argument into an empty path or NaN and
 * produced a confusing downstream failure. These helpers fail immediately with
 * the argument name, so the caller can correct the call in one step.
 */

function requireString(args: Record<string, unknown>, name: string): string {
  const value = args[name];
  if (typeof value !== 'string' || value.length === 0) {
    throw new ToolError('INVALID_ARGUMENT', `"${name}" is required and must be a non-empty string.`);
  }
  return value;
}

function optionalString(args: Record<string, unknown>, name: string): string | undefined {
  const value = args[name];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new ToolError('INVALID_ARGUMENT', `"${name}" must be a string.`);
  return value;
}

function requireText(args: Record<string, unknown>, name: string): string {
  const value = args[name];
  if (typeof value !== 'string') throw new ToolError('INVALID_ARGUMENT', `"${name}" is required and must be a string.`);
  return value;
}

function optionalInteger(args: Record<string, unknown>, name: string): number | undefined {
  const value = args[name];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new ToolError('INVALID_ARGUMENT', `"${name}" must be an integer.`);
  }
  return value;
}

function optionalBoolean(args: Record<string, unknown>, name: string): boolean | undefined {
  const value = args[name];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'boolean') throw new ToolError('INVALID_ARGUMENT', `"${name}" must be a boolean.`);
  return value;
}

function optionalStringArray(args: Record<string, unknown>, name: string): string[] | undefined {
  const value = args[name];
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new ToolError('INVALID_ARGUMENT', `"${name}" must be an array of strings.`);
  }
  return value as string[];
}

function optionalStringRecord(args: Record<string, unknown>, name: string): Record<string, string> | undefined {
  const value = args[name];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new ToolError('INVALID_ARGUMENT', `"${name}" must be an object of string values.`);
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.some(([, entry]) => typeof entry !== 'string')) {
    throw new ToolError('INVALID_ARGUMENT', `"${name}" values must be strings.`);
  }
  return Object.fromEntries(entries) as Record<string, string>;
}

function optionalShell(args: Record<string, unknown>): ShellKind {
  const value = args.shell;
  if (value === undefined || value === null) return 'auto';
  if (typeof value !== 'string' || !['auto', 'powershell', 'cmd', 'bash'].includes(value)) {
    throw new ToolError('INVALID_ARGUMENT', '"shell" must be one of: auto, powershell, cmd, bash.');
  }
  return value as ShellKind;
}

/**
 * External-tool probes are cached for the process lifetime: machine_status is
 * called often, and a missing binary does not appear mid-session.
 */
const probeCache = new Map<string, Promise<string | null>>();

function probeVersion(executable: string, args: string[]): Promise<string | null> {
  const key = `${executable} ${args.join(' ')}`;
  const cached = probeCache.get(key);
  if (cached) return cached;
  const probe = execFileAsync(executable, args, { windowsHide: true, timeout: 5_000 })
    .then(({ stdout }) => stdout.split('\n')[0]?.trim() ?? null)
    .catch(() => null);
  probeCache.set(key, probe);
  return probe;
}

const PATH_PROPERTY = {
  type: 'string',
  description: 'Path relative to the workspace root, or an allowed absolute path.',
} as const;

const EXPECTED_SHA256_PROPERTY = {
  type: 'string',
  description: 'Optional SHA-256 returned by a previous read or write. The call fails if the file changed since then.',
} as const;

export function createToolSpecs(context: ToolContext): ToolSpec[] {
  const access: MachineAccess = { root: context.root, unrestricted: context.unrestricted };
  const open = context.unrestricted;
  const audit = context.audit ?? new AuditLogger(defaultAuditPath(context.root));

  const specs: ToolSpec[] = [
    {
      name: 'machine_status',
      description: 'Report the access mode, workspace root, platform, available external tools (git, ripgrep, shells), and the background processes this session manages. Call this first when unsure what the bridge can do.',
      inputSchema: { type: 'object', properties: { include: { type: 'array', items: { type: 'string', enum: ['git', 'project'] }, description: 'Optional bootstrap sections.' } } },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      handler: async (args) => {
        const [git, ripgrep, bash, powershell] = await Promise.all([
          probeVersion('git', ['--version']),
          probeVersion('rg', ['--version']),
          probeVersion('bash', ['--version']),
          probeVersion(process.platform === 'win32' ? 'powershell.exe' : 'pwsh', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()']),
        ]);
        const include = optionalStringArray(args, 'include') ?? [];
        const project = include.includes('project') ? await readFile(path.join(context.root, 'package.json'), 'utf8').then((text) => {
          const pkg = JSON.parse(text) as { name?: string; scripts?: Record<string, string> };
          return { name: pkg.name, scripts: Object.fromEntries(Object.entries(pkg.scripts ?? {}).filter(([name]) => ['dev', 'test', 'build', 'lint', 'start'].includes(name))) };
        }).catch(() => undefined) : undefined;
        return {
          platform: process.platform,
          defaultWorkspace: context.root,
          accessMode: open ? 'UNRESTRICTED_MACHINE' : 'WORKSPACE_ONLY',
          pid: process.pid,
          node: process.version,
          maxTimeoutMs: context.maxTimeoutMs,
          available: {
            git,
            ripgrep,
            bash,
            powershell,
            // search_code still works without ripgrep, through a slower built-in scanner.
            searchEngine: ripgrep ? 'ripgrep' : 'builtin',
          },
          governance: {
            policy: context.policyName ?? 'admin',
            approvalMode: context.approvalMode ?? 'mrtr',
            auditFile: audit.filePath,
          },
          managedProcesses: await listManagedProcesses(access),
          tools: specs.map((spec) => spec.name),
          project,
        };
      },
    },
    {
      name: 'system_info',
      description: 'Read operating-system, CPU, memory, uptime, Node.js, and host identity information without invoking a shell.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      handler: async () => systemInfo(),
    },
    {
      name: 'list_processes',
      description: 'List operating-system processes with bounded structured results.',
      inputSchema: {
        type: 'object',
        properties: {
          filter: { type: 'string', description: 'Optional case-insensitive text filter.' },
          limit: { type: 'integer', minimum: 1, maximum: 2000, description: 'Maximum returned processes; defaults to 500.' },
        },
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      handler: async (args) => listProcesses({ filter: optionalString(args, 'filter'), limit: optionalInteger(args, 'limit') }),
    },
    {
      name: 'list_ports',
      description: 'List local TCP/UDP endpoints and owning PIDs, optionally filtered by port, PID, or protocol.',
      inputSchema: {
        type: 'object',
        properties: {
          port: { type: 'integer', minimum: 1, maximum: 65535 },
          pid: { type: 'integer', minimum: 1 },
          protocol: { type: 'string', enum: ['tcp', 'udp'] },
          limit: { type: 'integer', minimum: 1, maximum: 2000 },
        },
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      handler: async (args) => {
        const protocol = optionalString(args, 'protocol');
        if (protocol !== undefined && protocol !== 'tcp' && protocol !== 'udp') throw new ToolError('INVALID_ARGUMENT', '"protocol" must be tcp or udp.');
        return listPorts({ port: optionalInteger(args, 'port'), pid: optionalInteger(args, 'pid'), protocol, limit: optionalInteger(args, 'limit') });
      },
    },
    {
      name: 'environment_info',
      description: 'List environment variable names and optionally non-sensitive values. Secret-like variables are always redacted.',
      inputSchema: {
        type: 'object',
        properties: {
          include_values: { type: 'boolean', description: 'Include values for non-sensitive variables; defaults to false.' },
          filter: { type: 'string', description: 'Optional variable-name filter.' },
        },
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      handler: async (args) => environmentInfo({ includeValues: optionalBoolean(args, 'include_values'), filter: optionalString(args, 'filter') }),
    },
    {
      name: 'disk_info',
      description: 'Read filesystem capacity and free-space information for a path allowed by the current machine access policy.',
      inputSchema: { type: 'object', properties: { path: PATH_PROPERTY } },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      handler: async (args) => diskInfo(access, optionalString(args, 'path')),
    },
    {
      name: 'network_info',
      description: 'Read local network-interface addresses and metadata without making an outbound network request.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      handler: async () => networkInfo(),
    },
    {
      name: 'audit_recent',
      description: 'Read recent redacted machine-operation audit records.',
      inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 500 } } },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      handler: async (args) => ({ records: await audit.recent(optionalInteger(args, 'limit') ?? 50), path: audit.filePath }),
    },
    {
      name: 'audit_search',
      description: 'Search recent redacted audit records by text.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 100 },
        },
        required: ['query'],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      handler: async (args) => ({ records: await audit.search(requireString(args, 'query'), optionalInteger(args, 'limit') ?? 100), path: audit.filePath }),
    },
    {
      name: 'read_file',
      description: 'Read a UTF-8 text file with line and byte limits. Returns the file SHA-256; pass it back as "expected_sha256" when writing to detect concurrent changes.',
      inputSchema: {
        type: 'object',
        properties: {
          path: PATH_PROPERTY,
          start_line: { type: 'integer', minimum: 1, description: 'First line to return (1-based).' },
          max_lines: { type: 'integer', minimum: 1, maximum: 10000, description: 'Maximum lines to return.' },
          max_bytes: { type: 'integer', minimum: 1, maximum: 1048576, description: 'Maximum UTF-8 bytes to return.' },
          line_numbers: { type: 'boolean', description: 'Prefix each returned line with its 1-based number and a tab.' },
        },
        required: ['path'],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      handler: async (args) => readMachineFile({
        ...access,
        filePath: requireString(args, 'path'),
        startLine: optionalInteger(args, 'start_line'),
        maxLines: optionalInteger(args, 'max_lines'),
        maxBytes: optionalInteger(args, 'max_bytes'),
        lineNumbers: optionalBoolean(args, 'line_numbers'),
      }),
    },
    {
      name: 'list_directory',
      description: 'List files, directories, and symlinks with size and modification time, without running a shell command.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory path; defaults to the workspace root.' },
          max_entries: { type: 'integer', minimum: 1, maximum: 5000, description: 'Maximum returned entries.' },
          include_hidden: { type: 'boolean', description: 'Include names beginning with a dot; defaults to false.' },
        },
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      handler: async (args) => listDirectory({
        ...access,
        directoryPath: optionalString(args, 'path'),
        maxEntries: optionalInteger(args, 'max_entries'),
        includeHidden: optionalBoolean(args, 'include_hidden'),
      }),
    },
    {
      name: 'find_files',
      description: 'Find files recursively by glob. Build output and dependency directories such as node_modules, .git, dist, and target are skipped unless "include_ignored" is true.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory to search; defaults to the workspace root.' },
          glob: { type: 'string', description: 'Glob such as **/*.ts; defaults to **/*.' },
          max_results: { type: 'integer', minimum: 1, maximum: 5000, description: 'Maximum returned paths.' },
          max_depth: { type: 'integer', minimum: 1, maximum: 100, description: 'Maximum recursive directory depth.' },
          include_hidden: { type: 'boolean', description: 'Traverse names beginning with a dot; defaults to false.' },
          exclude: { type: 'array', items: { type: 'string' }, description: 'Extra directory names to skip.' },
          include_ignored: { type: 'boolean', description: 'Traverse the default-skipped build and dependency directories.' },
        },
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      handler: async (args) => findFiles({
        ...access,
        directoryPath: optionalString(args, 'path'),
        glob: optionalString(args, 'glob'),
        maxResults: optionalInteger(args, 'max_results'),
        maxDepth: optionalInteger(args, 'max_depth'),
        includeHidden: optionalBoolean(args, 'include_hidden'),
        exclude: optionalStringArray(args, 'exclude'),
        includeIgnored: optionalBoolean(args, 'include_ignored'),
      }),
    },
    {
      name: 'file_info',
      description: 'Get file or directory metadata and an optional SHA-256 hash for regular files.',
      inputSchema: {
        type: 'object',
        properties: {
          path: PATH_PROPERTY,
          include_hash: { type: 'boolean', description: 'Calculate SHA-256 for regular files; defaults to true.' },
        },
        required: ['path'],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      handler: async (args) => fileInfo({
        ...access,
        filePath: requireString(args, 'path'),
        includeHash: optionalBoolean(args, 'include_hash') ?? true,
      }),
    },
    {
      name: 'image_info',
      description: 'Inspect a local PNG, JPEG, or WebP image and return dimensions, size, and SHA-256.',
      inputSchema: { type: 'object', properties: { path: PATH_PROPERTY }, required: ['path'] },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      handler: async (args) => imageInfo({ ...access, filePath: requireString(args, 'path') }),
    },
    {
      name: 'save_image_from_url',
      description: 'Download an HTTPS PNG, JPEG, or WebP image to the machine. Blocks local and private hosts, limits redirects and size, and sends no cookies or credentials.',
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
      handler: async (args) => saveImageFromUrl({
        ...access,
        url: requireString(args, 'url'),
        filePath: requireString(args, 'path'),
        overwrite: optionalBoolean(args, 'overwrite'),
      }),
    },
    {
      name: 'search_code',
      description: 'Search file contents and return structured path, line, column, and text matches. Uses ripgrep when installed and falls back to a built-in scanner otherwise. Supports surrounding context lines, a per-file match cap, and a files-only mode for cheap surveys.',
      inputSchema: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Regular expression, or literal text when "literal" is true.' },
          path: { type: 'string', description: 'File or directory to search; defaults to the workspace.' },
          globs: {
            type: 'array',
            items: { type: 'string' },
            description: 'Include globs such as **/*.ts, or exclude globs prefixed with "!".',
          },
          case_sensitive: { type: 'boolean', description: 'Use case-sensitive matching; defaults to true.' },
          literal: { type: 'boolean', description: 'Treat pattern as literal text instead of a regular expression.' },
          max_results: { type: 'integer', minimum: 1, maximum: 2000, description: 'Maximum returned matches.' },
          max_matches_per_file: { type: 'integer', minimum: 1, maximum: 2000, description: 'Stop after this many matches in each file.' },
          context_lines: { type: 'integer', minimum: 0, maximum: 10, description: 'Lines of surrounding context to include with each match.' },
          files_only: { type: 'boolean', description: 'Return only the list of matching file paths.' },
          timeout_ms: { type: 'integer', minimum: 1, maximum: 60000, description: 'Search timeout in milliseconds.' },
        },
        required: ['pattern'],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      handler: async (args) => searchCode({
        ...access,
        pattern: requireString(args, 'pattern'),
        searchPath: optionalString(args, 'path'),
        globs: optionalStringArray(args, 'globs'),
        caseSensitive: optionalBoolean(args, 'case_sensitive') ?? true,
        literal: optionalBoolean(args, 'literal'),
        maxResults: optionalInteger(args, 'max_results'),
        maxMatchesPerFile: optionalInteger(args, 'max_matches_per_file'),
        contextLines: optionalInteger(args, 'context_lines'),
        filesOnly: optionalBoolean(args, 'files_only'),
        timeoutMs: optionalInteger(args, 'timeout_ms'),
      }),
    },
    {
      name: 'write_file',
      description: 'Create a UTF-8 text file, or replace one when "overwrite" is true. Prefer edit_file or update_file for changes to an existing file.',
      inputSchema: {
        type: 'object',
        properties: {
          path: PATH_PROPERTY,
          content: { type: 'string', description: 'Complete UTF-8 file content.' },
          overwrite: { type: 'boolean', description: 'Allow replacing an existing file; defaults to false.' },
          expected_sha256: EXPECTED_SHA256_PROPERTY,
        },
        required: ['path', 'content'],
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
      handler: async (args) => writeMachineFile({
        ...access,
        filePath: requireString(args, 'path'),
        content: requireText(args, 'content'),
        overwrite: optionalBoolean(args, 'overwrite'),
        expectedSha256: optionalString(args, 'expected_sha256'),
      }),
    },
    {
      name: 'edit_file',
      description: 'Replace exact text in an existing UTF-8 file. Supply either old_text/new_text or an edits array. Array edits are validated in memory then written atomically, so a failed edit never leaves a partial file.',
      inputSchema: {
        type: 'object',
        properties: {
          path: PATH_PROPERTY,
          old_text: { type: 'string', description: 'Exact text to find, copied verbatim from read_file output.' },
          new_text: { type: 'string', description: 'Replacement text.' },
          replace_all: { type: 'boolean', description: 'Replace every occurrence; defaults to false.' },
          expected_replacements: { type: 'integer', minimum: 1, description: 'Require exactly this many occurrences.' },
          expected_sha256: EXPECTED_SHA256_PROPERTY,
          dry_run: { type: 'boolean', description: 'Report what would change without writing the file.' },
          edits: { type: 'array', minItems: 1, items: { type: 'object', properties: { old_text: { type: 'string' }, new_text: { type: 'string' }, replace_all: { type: 'boolean' }, expected_replacements: { type: 'integer', minimum: 1 } }, required: ['old_text', 'new_text'] }, description: 'Transactional sequence of edits; all succeed or none are written.' },
        },
        required: ['path'],
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
      handler: async (args) => {
        const common = { ...access, filePath: requireString(args, 'path'), expectedSha256: optionalString(args, 'expected_sha256'), dryRun: optionalBoolean(args, 'dry_run') };
        if (args.edits !== undefined) {
          if (!Array.isArray(args.edits)) throw new ToolError('INVALID_ARGUMENT', '"edits" must be an array.');
          return editMachineFileTransaction({ ...common, edits: args.edits.map((item, index) => {
            if (!item || typeof item !== 'object' || Array.isArray(item)) throw new ToolError('INVALID_ARGUMENT', `edits[${index}] must be an object.`);
            const edit = item as Record<string, unknown>;
            return { oldText: requireText(edit, 'old_text'), newText: requireText(edit, 'new_text'), replaceAll: optionalBoolean(edit, 'replace_all'), expectedReplacements: optionalInteger(edit, 'expected_replacements') };
          }) });
        }
        return editMachineFile({ ...common, oldText: requireText(args, 'old_text'), newText: requireText(args, 'new_text'), replaceAll: optionalBoolean(args, 'replace_all'), expectedReplacements: optionalInteger(args, 'expected_replacements') });
      },
    },
    {
      name: 'update_file',
      description: 'Replace an inclusive 1-based line range in an existing UTF-8 text file. Line numbers shift after every edit, so read the file again between updates.',
      inputSchema: {
        type: 'object',
        properties: {
          path: PATH_PROPERTY,
          start_line: { type: 'integer', minimum: 1, description: 'First line to replace (1-based).' },
          end_line: { type: 'integer', minimum: 1, description: 'Last line to replace (inclusive).' },
          content: { type: 'string', description: 'Replacement content; an empty string deletes the selected lines.' },
          expected_sha256: EXPECTED_SHA256_PROPERTY,
        },
        required: ['path', 'start_line', 'end_line', 'content'],
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
      handler: async (args) => updateMachineFile({
        ...access,
        filePath: requireString(args, 'path'),
        startLine: optionalInteger(args, 'start_line') ?? Number.NaN,
        endLine: optionalInteger(args, 'end_line') ?? Number.NaN,
        content: requireText(args, 'content'),
        expectedSha256: optionalString(args, 'expected_sha256'),
      }),
    },
    {
      name: 'shell_command',
      description: open
        ? 'Run an arbitrary shell command anywhere on this machine and wait for it to finish. This tool has unrestricted machine access. Use start_process for anything long-running.'
        : 'Run a shell command inside the configured workspace root and wait for it to finish. Use start_process for anything long-running.',
      inputSchema: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Command to execute.' },
          workdir: { type: 'string', description: 'Absolute path or path relative to the default workspace.' },
          shell: { type: 'string', enum: ['auto', 'powershell', 'cmd', 'bash'] },
          timeout_ms: { type: 'number', description: 'Timeout in milliseconds.' },
          max_output_bytes: { type: 'number', description: 'Maximum combined stdout/stderr bytes (1024-4194304).' },
          env: { type: 'object', additionalProperties: { type: 'string' }, description: 'Environment variables merged over the server environment.' },
          stdin: { type: 'string', description: 'Text written to the command standard input, which is then closed.' },
          expect_exit_code: { type: 'integer', description: 'Expected exit code; a different result is reported as an error.' },
          on_timeout: { type: 'string', enum: ['terminate', 'background'], description: 'Terminate on timeout (default), or keep running as a managed background process.' },
        },
        required: ['command'],
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
      handler: async (args) => {
        const expectedExitCode = optionalInteger(args, 'expect_exit_code');
        const onTimeout = optionalString(args, 'on_timeout') ?? 'terminate';
        if (!['terminate', 'background'].includes(onTimeout)) throw new ToolError('INVALID_ARGUMENT', '"on_timeout" must be terminate or background.');
        if (onTimeout === 'background') {
          const timeoutMs = typeof args.timeout_ms === 'number' ? args.timeout_ms : 30_000;
          if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > context.maxTimeoutMs) throw new ToolError('INVALID_ARGUMENT', `"timeout_ms" must be between 100 and ${context.maxTimeoutMs}.`);
          const started = await startProcess({ ...access, command: requireString(args, 'command'), workdir: optionalString(args, 'workdir'), shell: optionalShell(args), env: optionalStringRecord(args, 'env') });
          const stdin = optionalString(args, 'stdin');
          if (stdin !== undefined) await writeProcessInput({ ...access, pid: started.pid, input: stdin, end: true });
          const output = await readProcessOutput({ ...access, pid: started.pid, waitMs: timeoutMs });
          const base = { shell: started.shell, command: started.command, workdir: started.workdir, pid: started.pid, exitCode: output.exitCode, stdout: output.stdout, stderr: output.stderr, timedOut: output.running, outputTruncated: output.outputTruncated, promotedToBackground: output.running, nextStdoutOffset: output.nextStdoutOffset, nextStderrOffset: output.nextStderrOffset, hint: output.running ? 'Poll read_process_output with the returned offsets.' : undefined };
          return expectedExitCode === undefined ? base : { ...base, expectedExitCode, expectationMet: output.exitCode === expectedExitCode };
        }
        const result = await runShellCommand({
        ...access,
        command: requireString(args, 'command'),
        workdir: optionalString(args, 'workdir'),
        shell: optionalShell(args),
        timeoutMs: typeof args.timeout_ms === 'number' ? args.timeout_ms : undefined,
        maxTimeoutMs: context.maxTimeoutMs,
        maxOutputBytes: typeof args.max_output_bytes === 'number' ? args.max_output_bytes : undefined,
        env: optionalStringRecord(args, 'env'),
        stdin: optionalString(args, 'stdin'),
        });
        return expectedExitCode === undefined ? result : { ...result, expectedExitCode, expectationMet: result.exitCode === expectedExitCode };
      },
    },
    {
      name: 'start_process',
      description: open
        ? 'Start a background PowerShell, cmd, or Bash process anywhere on this machine and return its PID. Poll it with read_process_output.'
        : 'Start a background process inside the configured workspace and return its PID. Poll it with read_process_output.',
      inputSchema: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Command to run in the background.' },
          workdir: { type: 'string', description: 'Working directory.' },
          shell: { type: 'string', enum: ['auto', 'powershell', 'cmd', 'bash'] },
          env: { type: 'object', additionalProperties: { type: 'string' }, description: 'Environment variables merged over the server environment.' },
        },
        required: ['command'],
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
      handler: async (args) => startProcess({
        ...access,
        command: requireString(args, 'command'),
        workdir: optionalString(args, 'workdir'),
        shell: optionalShell(args),
        env: optionalStringRecord(args, 'env'),
      }),
    },
    {
      name: 'process_status',
      description: 'Get the status, runtime, and current output offsets for a managed background process.',
      inputSchema: {
        type: 'object',
        properties: { pid: { type: 'integer', minimum: 1, description: 'Process ID returned by start_process.' } },
        required: ['pid'],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      handler: async (args) => processStatus({ ...access, pid: optionalInteger(args, 'pid') ?? Number.NaN }),
    },
    {
      name: 'read_process_output',
      description: 'Read captured stdout and stderr from a managed background process. Pass the previous "next_stdout_offset" and "next_stderr_offset" values as "since_stdout" and "since_stderr" to receive only new output, and "wait_ms" to block until output arrives or the process exits.',
      inputSchema: {
        type: 'object',
        properties: {
          pid: { type: 'integer', minimum: 1, description: 'Process ID returned by start_process.' },
          since_stdout: { type: 'integer', minimum: 0, description: 'Return stdout produced after this offset.' },
          since_stderr: { type: 'integer', minimum: 0, description: 'Return stderr produced after this offset.' },
          wait_ms: { type: 'integer', minimum: 0, maximum: 60000, description: 'Wait up to this long for new output or process exit.' },
        },
        required: ['pid'],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      handler: async (args) => readProcessOutput({
        ...access,
        pid: optionalInteger(args, 'pid') ?? Number.NaN,
        sinceStdout: optionalInteger(args, 'since_stdout'),
        sinceStderr: optionalInteger(args, 'since_stderr'),
        waitMs: optionalInteger(args, 'wait_ms'),
      }),
    },
    {
      name: 'process_write',
      description: 'Write UTF-8 text to the standard input of a live process started by start_process. Recovered processes remain inspectable after restart but their stdin cannot be reattached.',
      inputSchema: {
        type: 'object',
        properties: {
          pid: { type: 'integer', minimum: 1, description: 'Process ID returned by start_process.' },
          input: { type: 'string', description: 'UTF-8 text to write to standard input.' },
          end: { type: 'boolean', description: 'Close standard input after writing; defaults to false.' },
        },
        required: ['pid', 'input'],
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
      handler: async (args) => writeProcessInput({
        ...access,
        pid: optionalInteger(args, 'pid') ?? Number.NaN,
        input: requireText(args, 'input'),
        end: optionalBoolean(args, 'end'),
      }),
    },
    {
      name: 'stop_process',
      description: 'Stop a managed background process and its child tree by PID.',
      inputSchema: {
        type: 'object',
        properties: { pid: { type: 'integer', minimum: 1, description: 'Process ID returned by start_process.' } },
        required: ['pid'],
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
      handler: async (args) => stopProcess({ ...access, pid: optionalInteger(args, 'pid') ?? Number.NaN }),
    },
    {
      name: 'apply_patch',
      description: open
        ? 'Add, update, move, or delete files anywhere on this machine using Codex patch format. Run with "dry_run" first when the context lines are uncertain.'
        : 'Add, update, move, or delete files inside the configured workspace using Codex patch format. Run with "dry_run" first when the context lines are uncertain.',
      inputSchema: {
        type: 'object',
        properties: {
          patch: { type: 'string', description: 'Patch beginning with *** Begin Patch and ending with *** End Patch.' },
          dry_run: { type: 'boolean', description: 'Validate and report changes without writing files.' },
        },
        required: ['patch'],
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
      handler: async (args) => {
        const dryRun = optionalBoolean(args, 'dry_run') === true;
        return { changed: await applyFilePatch(access, requireText(args, 'patch'), dryRun), dryRun };
      },
    },
    {
      name: 'git_status',
      description: 'Read the current Git branch, upstream tracking state, and working-tree status without running a shell command.',
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string', description: 'Git repository directory; defaults to the workspace.' } },
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      handler: async (args) => gitStatus({ ...access, path: optionalString(args, 'path') }),
    },
    {
      name: 'git_diff',
      description: 'Read the Git working-tree or staged diff without running a shell command, optionally limited to specific paths.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Git repository directory; defaults to the workspace.' },
          staged: { type: 'boolean', description: 'Read the staged diff instead of the working-tree diff.' },
          stat_only: { type: 'boolean', description: 'Return only diff statistics.' },
          paths: { type: 'array', items: { type: 'string' }, description: 'Limit the diff to these repository paths.' },
          context_lines: { type: 'integer', minimum: 0, maximum: 20, description: 'Lines of context around each hunk.' },
          max_bytes: { type: 'integer', minimum: 1024, maximum: 4194304, description: 'Maximum diff bytes.' },
        },
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      handler: async (args) => gitDiff({
        ...access,
        path: optionalString(args, 'path'),
        staged: optionalBoolean(args, 'staged'),
        statOnly: optionalBoolean(args, 'stat_only'),
        paths: optionalStringArray(args, 'paths'),
        contextLines: optionalInteger(args, 'context_lines'),
        maxBytes: optionalInteger(args, 'max_bytes'),
      }),
    },
    {
      name: 'git_log',
      description: 'Read structured Git commit history without shell interpolation.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Git repository directory; defaults to the workspace.' },
          max_count: { type: 'integer', minimum: 1, maximum: 200, description: 'Maximum commits; defaults to 20.' },
          ref: { type: 'string', description: 'Optional revision or branch; defaults to HEAD.' },
        },
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      handler: async (args) => gitLog({ ...access, path: optionalString(args, 'path'), maxCount: optionalInteger(args, 'max_count'), ref: optionalString(args, 'ref') }),
    },
    {
      name: 'git_show',
      description: 'Read one Git revision and its patch or statistics with bounded output.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Git repository directory; defaults to the workspace.' },
          ref: { type: 'string', description: 'Revision; defaults to HEAD.' },
          stat_only: { type: 'boolean' },
          max_bytes: { type: 'integer', minimum: 1024, maximum: 4194304 },
        },
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      handler: async (args) => gitShow({ ...access, path: optionalString(args, 'path'), ref: optionalString(args, 'ref'), statOnly: optionalBoolean(args, 'stat_only'), maxBytes: optionalInteger(args, 'max_bytes') }),
    },
    {
      name: 'git_branch',
      description: 'List local Git branches and optionally remote branches with current/upstream metadata.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Git repository directory; defaults to the workspace.' },
          all: { type: 'boolean', description: 'Include remote branches.' },
        },
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      handler: async (args) => gitBranch({ ...access, path: optionalString(args, 'path'), all: optionalBoolean(args, 'all') }),
    },
    {
      name: 'git_add',
      description: 'Stage explicit repository paths using Git directly, without shell interpolation.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Git repository directory; defaults to the workspace.' },
          paths: { type: 'array', items: { type: 'string' }, minItems: 1, description: 'Repository paths to stage.' },
        },
        required: ['paths'],
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
      handler: async (args) => gitAdd({ ...access, path: optionalString(args, 'path'), paths: optionalStringArray(args, 'paths') ?? [] }),
    },
    {
      name: 'git_commit',
      description: 'Create a local Git commit from staged changes, optionally staging tracked-file modifications with --all.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Git repository directory; defaults to the workspace.' },
          message: { type: 'string', description: 'Commit message.' },
          all: { type: 'boolean', description: 'Stage tracked-file modifications/deletions before committing.' },
        },
        required: ['message'],
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
      handler: async (args) => gitCommit({ ...access, path: optionalString(args, 'path'), message: requireString(args, 'message'), all: optionalBoolean(args, 'all') }),
    },
    {
      name: 'git_checkout',
      description: 'Switch to an existing Git branch, or create and switch to a new branch. Force/discard modes are intentionally not exposed.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Git repository directory; defaults to the workspace.' },
          branch: { type: 'string' },
          create: { type: 'boolean' },
        },
        required: ['branch'],
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
      handler: async (args) => gitCheckout({ ...access, path: optionalString(args, 'path'), branch: requireString(args, 'branch'), create: optionalBoolean(args, 'create') }),
    },
    {
      name: 'git_push',
      description: 'Push a Git branch to a remote using Git directly. This is an external mutation and is approval-gated by the developer policy.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Git repository directory; defaults to the workspace.' },
          remote: { type: 'string', description: 'Remote name; defaults to origin.' },
          branch: { type: 'string', description: 'Branch; defaults to the current branch.' },
          set_upstream: { type: 'boolean' },
        },
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
      handler: async (args) => gitPush({ ...access, path: optionalString(args, 'path'), remote: optionalString(args, 'remote'), branch: optionalString(args, 'branch'), setUpstream: optionalBoolean(args, 'set_upstream') }),
    },
  ];

  return specs;
}
