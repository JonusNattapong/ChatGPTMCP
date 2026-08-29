import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ToolError } from './errors.js';
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
import {
  listManagedProcesses,
  processStatus,
  readProcessOutput,
  startProcess,
  stopProcess,
} from './process-tools.js';
import { gitDiff, gitStatus } from './git-tools.js';

const execFileAsync = promisify(execFile);

export interface ToolContext extends MachineAccess {
  maxTimeoutMs: number;
}

export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
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

  const specs: ToolSpec[] = [
    {
      name: 'machine_status',
      description: 'Report the access mode, workspace root, platform, available external tools (git, ripgrep, shells), and the background processes this session manages. Call this first when unsure what the bridge can do.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      handler: async () => {
        const [git, ripgrep, bash, powershell] = await Promise.all([
          probeVersion('git', ['--version']),
          probeVersion('rg', ['--version']),
          probeVersion('bash', ['--version']),
          probeVersion(process.platform === 'win32' ? 'powershell.exe' : 'pwsh', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()']),
        ]);
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
          managedProcesses: listManagedProcesses(),
          tools: specs.map((spec) => spec.name),
        };
      },
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
      description: 'Replace exact text in an existing UTF-8 file. Ambiguous matches are rejected unless "replace_all" or "expected_replacements" is given, and a failed match reports whitespace-insensitive near misses so the call can be corrected.',
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
        },
        required: ['path', 'old_text', 'new_text'],
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
      handler: async (args) => editMachineFile({
        ...access,
        filePath: requireString(args, 'path'),
        oldText: requireText(args, 'old_text'),
        newText: requireText(args, 'new_text'),
        replaceAll: optionalBoolean(args, 'replace_all'),
        expectedReplacements: optionalInteger(args, 'expected_replacements'),
        expectedSha256: optionalString(args, 'expected_sha256'),
        dryRun: optionalBoolean(args, 'dry_run'),
      }),
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
        },
        required: ['command'],
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
      handler: async (args) => runShellCommand({
        ...access,
        command: requireString(args, 'command'),
        workdir: optionalString(args, 'workdir'),
        shell: optionalShell(args),
        timeoutMs: typeof args.timeout_ms === 'number' ? args.timeout_ms : undefined,
        maxTimeoutMs: context.maxTimeoutMs,
        maxOutputBytes: typeof args.max_output_bytes === 'number' ? args.max_output_bytes : undefined,
        env: optionalStringRecord(args, 'env'),
        stdin: optionalString(args, 'stdin'),
      }),
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
  ];

  return specs;
}
