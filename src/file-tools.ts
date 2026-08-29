import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lookup } from 'node:dns/promises';
import { access, lstat, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { resolveMachinePath, type MachineAccess } from './shell-tools.js';

const MAX_TEXT_FILE_BYTES = 8 * 1024 * 1024;
const MAX_READ_BYTES = 1024 * 1024;
const MAX_SEARCH_RESULTS = 2_000;
const MAX_DIRECTORY_ENTRIES = 5_000;
const MAX_IMAGE_REDIRECTS = 3;

export interface ReadFileOptions extends MachineAccess {
  filePath: string;
  startLine?: number;
  maxLines?: number;
  maxBytes?: number;
}

export interface WriteFileOptions extends MachineAccess {
  filePath: string;
  content: string;
  overwrite?: boolean;
}

export interface EditFileOptions extends MachineAccess {
  filePath: string;
  oldText: string;
  newText: string;
  replaceAll?: boolean;
}

export interface UpdateFileOptions extends MachineAccess {
  filePath: string;
  startLine: number;
  endLine: number;
  content: string;
}

export interface SearchCodeOptions extends MachineAccess {
  pattern: string;
  searchPath?: string;
  globs?: string[];
  caseSensitive?: boolean;
  literal?: boolean;
  maxResults?: number;
  timeoutMs?: number;
}

export interface ListDirectoryOptions extends MachineAccess {
  directoryPath?: string;
  maxEntries?: number;
  includeHidden?: boolean;
}

export interface FindFilesOptions extends MachineAccess {
  directoryPath?: string;
  glob?: string;
  maxResults?: number;
  maxDepth?: number;
  includeHidden?: boolean;
}

export interface FileInfoOptions extends MachineAccess {
  filePath: string;
  includeHash?: boolean;
}

export interface SaveImageFromUrlOptions extends MachineAccess {
  url: string;
  filePath: string;
  overwrite?: boolean;
}

export interface ImageInfoOptions extends MachineAccess {
  filePath: string;
}

interface TextFile {
  absolutePath: string;
  content: string;
  eol: '\n' | '\r\n';
  trailingNewline: boolean;
  lines: string[];
}

async function loadTextFile(accessConfig: MachineAccess, requestedPath: string): Promise<TextFile> {
  const absolutePath = await resolveMachinePath(accessConfig, requestedPath);
  const info = await stat(absolutePath);
  if (!info.isFile()) throw new Error(`Path is not a file: ${requestedPath}`);
  if (info.size > MAX_TEXT_FILE_BYTES) {
    throw new Error(`File exceeds the ${MAX_TEXT_FILE_BYTES}-byte text file limit: ${requestedPath}`);
  }

  const buffer = await readFile(absolutePath);
  if (buffer.includes(0)) throw new Error(`File appears to be binary: ${requestedPath}`);
  const content = buffer.toString('utf8');
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const trailingNewline = content.endsWith('\n');
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  if (trailingNewline) lines.pop();
  return { absolutePath, content, eol, trailingNewline, lines };
}

function validatePositiveInteger(value: number, name: string, maximum?: number): void {
  if (!Number.isInteger(value) || value < 1 || (maximum !== undefined && value > maximum)) {
    throw new Error(`"${name}" must be an integer between 1 and ${maximum ?? 'the supported limit'}.`);
  }
}

function replacementLines(content: string): string[] {
  if (content === '') return [];
  const normalized = content.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  if (normalized.endsWith('\n')) lines.pop();
  return lines;
}

function fileType(info: Awaited<ReturnType<typeof lstat>>): 'file' | 'directory' | 'symlink' | 'other' {
  if (info.isFile()) return 'file';
  if (info.isDirectory()) return 'directory';
  if (info.isSymbolicLink()) return 'symlink';
  return 'other';
}

function globToRegExp(glob: string): RegExp {
  let pattern = '^';
  const normalized = glob.replace(/\\/g, '/');
  for (let index = 0; index < normalized.length; index++) {
    const char = normalized[index];
    if (char === '*') {
      if (normalized[index + 1] === '*') {
        index++;
        if (normalized[index + 1] === '/') {
          index++;
          pattern += '(?:.*/)?';
        } else {
          pattern += '.*';
        }
      } else {
        pattern += '[^/]*';
      }
    } else if (char === '?') {
      pattern += '[^/]';
    } else {
      pattern += char.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
    }
  }
  return new RegExp(`${pattern}$`, process.platform === 'win32' ? 'i' : '');
}

async function sha256File(filePath: string): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk: string | Buffer) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number);
    return a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a === 0;
  }
  const normalized = address.toLowerCase();
  return normalized === '::1' || normalized === '::' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb');
}

async function assertPublicHost(url: URL): Promise<void> {
  if (url.protocol !== 'https:') throw new Error('Image URL must use HTTPS.');
  if (url.username || url.password) throw new Error('Image URL must not contain credentials.');
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error('Image URL resolves to a private or local network address.');
  }
}

function imageMetadata(buffer: Buffer): { mimeType: string; width?: number; height?: number } {
  if (buffer.length >= 24 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && buffer.toString('ascii', 12, 16) === 'IHDR') {
    return { mimeType: 'image/png', width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    if (buffer.toString('ascii', 12, 16) === 'VP8X' && buffer.length >= 30) {
      return { mimeType: 'image/webp', width: 1 + buffer.readUIntLE(24, 3), height: 1 + buffer.readUIntLE(27, 3) };
    }
    return { mimeType: 'image/webp' };
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) { offset++; continue; }
      const marker = buffer[offset + 1];
      const length = buffer.readUInt16BE(offset + 2);
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return { mimeType: 'image/jpeg', height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
      }
      if (length < 2) break;
      offset += 2 + length;
    }
    return { mimeType: 'image/jpeg' };
  }
  throw new Error('Downloaded file is not a supported PNG, JPEG, or WebP image.');
}

export async function saveImageFromUrl(options: SaveImageFromUrlOptions) {
  let current = new URL(options.url);
  for (let redirect = 0; redirect <= MAX_IMAGE_REDIRECTS; redirect++) {
    await assertPublicHost(current);
    const response = await fetch(current, { redirect: 'manual', headers: { accept: 'image/png,image/jpeg,image/webp' } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) throw new Error(`Image server returned redirect ${response.status} without a location.`);
      if (redirect === MAX_IMAGE_REDIRECTS) throw new Error('Too many image redirects.');
      current = new URL(location, current);
      continue;
    }
    if (!response.ok) throw new Error(`Image download failed with HTTP ${response.status}.`);
    const body = Buffer.from(await response.arrayBuffer());
    const metadata = imageMetadata(body);
    const absolutePath = await resolveMachinePath(options, options.filePath);
    const existed = await access(absolutePath).then(() => true, () => false);
    if (existed && !options.overwrite) throw new Error(`File already exists; set "overwrite" to true to replace it: ${options.filePath}`);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, body, { flag: options.overwrite ? 'w' : 'wx' });
    return { path: absolutePath, url: current.toString(), ...metadata, bytes: body.length, sha256: createHash('sha256').update(body).digest('hex'), created: !existed, overwritten: existed };
  }
  throw new Error('Image download did not complete.');
}

export async function imageInfo(options: ImageInfoOptions) {
  const absolutePath = await resolveMachinePath(options, options.filePath);
  const info = await stat(absolutePath);
  if (!info.isFile()) throw new Error(`Path is not a file: ${options.filePath}`);
  const metadata = imageMetadata(await readFile(absolutePath));
  return { path: absolutePath, ...metadata, bytes: info.size, sha256: await sha256File(absolutePath), modifiedAt: info.mtime.toISOString() };
}

export async function listDirectory(options: ListDirectoryOptions) {
  const directoryPath = options.directoryPath ?? '.';
  const maxEntries = options.maxEntries ?? 500;
  validatePositiveInteger(maxEntries, 'max_entries', MAX_DIRECTORY_ENTRIES);
  const absolutePath = await resolveMachinePath(options, directoryPath, true);
  const entries = await readdir(absolutePath, { withFileTypes: true });
  const visibleEntries = entries
    .filter((entry) => options.includeHidden || !entry.name.startsWith('.'))
    .sort((left, right) => left.name.localeCompare(right.name));
  const selected = visibleEntries.slice(0, maxEntries);
  return {
    path: absolutePath,
    entries: selected.map((entry) => ({
      name: entry.name,
      path: path.join(absolutePath, entry.name),
      type: entry.isFile() ? 'file' : entry.isDirectory() ? 'directory' : entry.isSymbolicLink() ? 'symlink' : 'other',
    })),
    totalEntries: visibleEntries.length,
    truncated: visibleEntries.length > selected.length,
  };
}

export async function findFiles(options: FindFilesOptions) {
  const directoryPath = options.directoryPath ?? '.';
  const maxResults = options.maxResults ?? 500;
  const maxDepth = options.maxDepth ?? 25;
  validatePositiveInteger(maxResults, 'max_results', MAX_DIRECTORY_ENTRIES);
  validatePositiveInteger(maxDepth, 'max_depth', 100);
  const absolutePath = await resolveMachinePath(options, directoryPath, true);
  const pattern = options.glob ?? '**/*';
  const matcher = globToRegExp(pattern);
  const matches: string[] = [];
  let truncated = false;

  const visit = async (currentPath: string, relativePath: string, depth: number): Promise<void> => {
    if (matches.length >= maxResults) {
      truncated = true;
      return;
    }
    const entries = await readdir(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      if (matches.length >= maxResults) {
        truncated = true;
        return;
      }
      if (!options.includeHidden && entry.name.startsWith('.')) continue;
      const entryRelativePath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
      const entryPath = path.join(currentPath, entry.name);
      if (entry.isFile() && matcher.test(entryRelativePath)) {
        matches.push(entryPath);
      } else if (entry.isDirectory() && depth < maxDepth) {
        await visit(entryPath, entryRelativePath, depth + 1);
      }
    }
  };

  await visit(absolutePath, '', 0);
  return { path: absolutePath, glob: pattern, matches, truncated };
}

export async function fileInfo(options: FileInfoOptions) {
  const absolutePath = await resolveMachinePath(options, options.filePath);
  const info = await lstat(absolutePath);
  const type = fileType(info);
  return {
    path: absolutePath,
    type,
    size: info.size,
    modifiedAt: info.mtime.toISOString(),
    createdAt: info.birthtime.toISOString(),
    sha256: options.includeHash === false || type !== 'file' ? undefined : await sha256File(absolutePath),
  };
}

export async function readMachineFile(options: ReadFileOptions) {
  const file = await loadTextFile(options, options.filePath);
  const startLine = options.startLine ?? 1;
  const maxLines = options.maxLines ?? 1_000;
  const maxBytes = options.maxBytes ?? MAX_READ_BYTES;
  validatePositiveInteger(startLine, 'start_line');
  validatePositiveInteger(maxLines, 'max_lines', 10_000);
  validatePositiveInteger(maxBytes, 'max_bytes', MAX_READ_BYTES);

  if (startLine > Math.max(1, file.lines.length)) {
    throw new Error(`"start_line" exceeds the file length of ${file.lines.length} lines.`);
  }

  const selected: string[] = [];
  let bytes = 0;
  for (const line of file.lines.slice(startLine - 1, startLine - 1 + maxLines)) {
    const lineBytes = Buffer.byteLength(line + file.eol);
    if (selected.length > 0 && bytes + lineBytes > maxBytes) break;
    selected.push(line);
    bytes += lineBytes;
    if (bytes >= maxBytes) break;
  }
  const endLine = selected.length === 0 ? startLine - 1 : startLine + selected.length - 1;
  return {
    path: file.absolutePath,
    startLine,
    endLine,
    totalLines: file.lines.length,
    truncated: endLine < file.lines.length,
    content: selected.join(file.eol),
  };
}

export async function writeMachineFile(options: WriteFileOptions) {
  const absolutePath = await resolveMachinePath(options, options.filePath);
  const existed = await access(absolutePath).then(() => true, () => false);
  if (existed && !options.overwrite) {
    throw new Error(`File already exists; set "overwrite" to true to replace it: ${options.filePath}`);
  }
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, options.content, { encoding: 'utf8', flag: options.overwrite ? 'w' : 'wx' });
  return { path: absolutePath, created: !existed, overwritten: existed, bytes: Buffer.byteLength(options.content) };
}

export async function editMachineFile(options: EditFileOptions) {
  if (!options.oldText) throw new Error('"old_text" must not be empty.');
  const file = await loadTextFile(options, options.filePath);
  const occurrences = file.content.split(options.oldText).length - 1;
  if (occurrences === 0) throw new Error(`"old_text" was not found in: ${options.filePath}`);
  if (!options.replaceAll && occurrences !== 1) {
    throw new Error(`"old_text" occurs ${occurrences} times; provide a unique value or set "replace_all" to true.`);
  }
  const content = options.replaceAll
    ? file.content.split(options.oldText).join(options.newText)
    : file.content.replace(options.oldText, options.newText);
  await writeFile(file.absolutePath, content, 'utf8');
  return { path: file.absolutePath, replacements: options.replaceAll ? occurrences : 1, bytes: Buffer.byteLength(content) };
}

export async function updateMachineFile(options: UpdateFileOptions) {
  const file = await loadTextFile(options, options.filePath);
  validatePositiveInteger(options.startLine, 'start_line');
  validatePositiveInteger(options.endLine, 'end_line');
  if (options.endLine < options.startLine) throw new Error('"end_line" must be greater than or equal to "start_line".');
  if (options.endLine > file.lines.length) {
    throw new Error(`"end_line" exceeds the file length of ${file.lines.length} lines.`);
  }
  const lines = [...file.lines];
  lines.splice(options.startLine - 1, options.endLine - options.startLine + 1, ...replacementLines(options.content));
  const content = lines.join(file.eol) + (file.trailingNewline ? file.eol : '');
  await writeFile(file.absolutePath, content, 'utf8');
  return {
    path: file.absolutePath,
    replacedStartLine: options.startLine,
    replacedEndLine: options.endLine,
    totalLines: lines.length,
    bytes: Buffer.byteLength(content),
  };
}

export async function searchCode(options: SearchCodeOptions) {
  if (!options.pattern) throw new Error('"pattern" parameter is required.');
  const maxResults = options.maxResults ?? 200;
  const timeoutMs = options.timeoutMs ?? 30_000;
  validatePositiveInteger(maxResults, 'max_results', MAX_SEARCH_RESULTS);
  validatePositiveInteger(timeoutMs, 'timeout_ms', 60_000);
  const target = await resolveMachinePath(options, options.searchPath ?? '.');
  const args = ['--json', '--no-messages'];
  if (options.caseSensitive === false) args.push('--ignore-case');
  if (options.literal) args.push('--fixed-strings');
  for (const glob of options.globs ?? []) args.push('--glob', glob);
  args.push('--', options.pattern, target);

  return await new Promise<{
    pattern: string;
    path: string;
    matches: Array<{ path: string; line: number; column: number; text: string }>;
    truncated: boolean;
  }>((resolve, reject) => {
    const child = spawn('rg', args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const decoder = new StringDecoder('utf8');
    const matches: Array<{ path: string; line: number; column: number; text: string }> = [];
    let pending = '';
    let stderr = '';
    let truncated = false;
    let timedOut = false;
    let settled = false;

    const consume = (text: string) => {
      pending += text;
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      for (const line of lines) {
        if (!line || matches.length >= maxResults) continue;
        try {
          const event = JSON.parse(line) as {
            type?: string;
            data?: {
              path?: { text?: string };
              line_number?: number;
              lines?: { text?: string };
              submatches?: Array<{ start?: number }>;
            };
          };
          if (event.type !== 'match' || !event.data?.path?.text || !event.data.line_number) continue;
          matches.push({
            path: event.data.path.text,
            line: event.data.line_number,
            column: (event.data.submatches?.[0]?.start ?? 0) + 1,
            text: (event.data.lines?.text ?? '').replace(/[\r\n]+$/, ''),
          });
          if (matches.length >= maxResults) {
            truncated = true;
            child.kill();
          }
        } catch {
          // Ignore non-JSON diagnostic lines; stderr is returned on real rg failures.
        }
      }
    };

    child.stdout.on('data', (chunk: Buffer) => consume(decoder.write(chunk)));
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < 8_192) stderr += chunk.toString('utf8').slice(0, 8_192 - stderr.length);
    });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`Unable to start ripgrep (rg): ${error.message}`));
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.on('close', (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      consume(decoder.end());
      if (timedOut) {
        reject(new Error(`Code search timed out after ${timeoutMs}ms.`));
        return;
      }
      if (exitCode !== 0 && exitCode !== 1 && !truncated) {
        reject(new Error(stderr.trim() || `ripgrep exited with code ${exitCode}.`));
        return;
      }
      resolve({ pattern: options.pattern, path: target, matches, truncated });
    });
  });
}
