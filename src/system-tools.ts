import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import { promisify } from 'node:util';
import { ToolError } from './errors.js';
import { resolveMachinePath, type MachineAccess } from './shell-tools.js';

const execFileAsync = promisify(execFile);
const MAX_RESULTS = 2000;
const SENSITIVE_ENV = /(password|passwd|secret|token|authorization|cookie|credential|api[_-]?key|private[_-]?key)/i;

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') { current += '"'; index++; }
      else quoted = !quoted;
    } else if (char === ',' && !quoted) {
      result.push(current);
      current = '';
    } else current += char;
  }
  result.push(current);
  return result;
}

export async function systemInfo() {
  const cpus = os.cpus();
  return {
    hostname: os.hostname(),
    platform: os.platform(),
    release: os.release(),
    version: os.version(),
    arch: os.arch(),
    node: process.version,
    cpu: { model: cpus[0]?.model, logicalCores: cpus.length },
    memory: { totalBytes: os.totalmem(), freeBytes: os.freemem() },
    uptimeSeconds: os.uptime(),
    loadAverage: os.loadavg(),
    username: os.userInfo().username,
  };
}

export async function listProcesses(options: { filter?: string; limit?: number } = {}) {
  const limit = options.limit ?? 500;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_RESULTS) throw new ToolError('INVALID_ARGUMENT', `"limit" must be between 1 and ${MAX_RESULTS}.`);
  let processes: Array<Record<string, unknown>>;
  if (process.platform === 'win32') {
    const result = await execFileAsync('tasklist.exe', ['/fo', 'csv', '/nh'], { windowsHide: true, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8' });
    processes = result.stdout.split(/\r?\n/).filter(Boolean).map((line) => {
      const [name, pid, sessionName, sessionNumber, memory] = parseCsvLine(line);
      return { pid: Number(pid), name, sessionName, sessionNumber: Number(sessionNumber), memory };
    });
  } else {
    const result = await execFileAsync('ps', ['-eo', 'pid=,ppid=,comm=,args='], { windowsHide: true, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8' });
    processes = result.stdout.split(/\r?\n/).filter(Boolean).map((line) => {
      const match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s*(.*)$/.exec(line);
      return match ? { pid: Number(match[1]), ppid: Number(match[2]), name: match[3], command: match[4] } : { raw: line };
    });
  }
  if (options.filter) {
    const needle = options.filter.toLowerCase();
    processes = processes.filter((entry) => JSON.stringify(entry).toLowerCase().includes(needle));
  }
  return { processes: processes.slice(0, limit), totalMatched: processes.length, truncated: processes.length > limit };
}

export async function listPorts(options: { port?: number; pid?: number; protocol?: 'tcp' | 'udp'; limit?: number } = {}) {
  const limit = options.limit ?? 500;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_RESULTS) throw new ToolError('INVALID_ARGUMENT', `"limit" must be between 1 and ${MAX_RESULTS}.`);
  if (options.port !== undefined && (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535)) {
    throw new ToolError('INVALID_ARGUMENT', '"port" must be between 1 and 65535.');
  }
  let rows: Array<{ protocol: string; localAddress: string; localPort?: number; remoteAddress?: string; remotePort?: number; state?: string; pid?: number }> = [];
  if (process.platform === 'win32') {
    const result = await execFileAsync('netstat.exe', ['-ano'], { windowsHide: true, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' });
    for (const line of result.stdout.split(/\r?\n/)) {
      const parts = line.trim().split(/\s+/);
      if (!parts.length) continue;
      const protocol = parts[0]?.toLowerCase();
      if (protocol !== 'tcp' && protocol !== 'udp') continue;
      const splitEndpoint = (value: string) => {
        const match = /^(.*):(\*|\d+)$/.exec(value);
        return { address: match?.[1] ?? value, port: match?.[2] && match[2] !== '*' ? Number(match[2]) : undefined };
      };
      const local = splitEndpoint(parts[1]);
      if (protocol === 'tcp') {
        const remote = splitEndpoint(parts[2]);
        rows.push({ protocol, localAddress: local.address, localPort: local.port, remoteAddress: remote.address, remotePort: remote.port, state: parts[3], pid: Number(parts[4]) });
      } else {
        const remote = splitEndpoint(parts[2]);
        rows.push({ protocol, localAddress: local.address, localPort: local.port, remoteAddress: remote.address, remotePort: remote.port, pid: Number(parts[3]) });
      }
    }
  } else if (process.platform === 'darwin') {
    const protocols = options.protocol ? [options.protocol] : ['tcp', 'udp'] as const;
    for (const protocol of protocols) {
      let stdout = '';
      try {
        const result = await execFileAsync('lsof', ['-nP', protocol === 'tcp' ? '-iTCP' : '-iUDP', ...(protocol === 'tcp' ? ['-sTCP:LISTEN'] : [])], {
          windowsHide: true,
          maxBuffer: 8 * 1024 * 1024,
          encoding: 'utf8',
        });
        stdout = result.stdout;
      } catch (error: unknown) {
        const code = (error as NodeJS.ErrnoException & { code?: number | string }).code;
        if (String(code) !== '1') throw error;
      }
      for (const line of stdout.split(/\r?\n/).slice(1).filter(Boolean)) {
        const parts = line.trim().split(/\s+/);
        const pid = Number(parts[1]);
        const name = parts.slice(8).join(' ');
        const endpoint = /(.*):(\d+)(?:\s+\(([^)]+)\))?$/.exec(name);
        rows.push({
          protocol,
          localAddress: endpoint?.[1] ?? name,
          localPort: endpoint ? Number(endpoint[2]) : undefined,
          state: endpoint?.[3],
          pid: Number.isInteger(pid) ? pid : undefined,
        });
      }
    }
  } else {
    let stdout = '';
    try {
      const result = await execFileAsync('ss', ['-lntupH'], { windowsHide: true, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' });
      stdout = result.stdout;
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const result = await execFileAsync('lsof', ['-nP', '-i'], { windowsHide: true, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' });
      for (const line of result.stdout.split(/\r?\n/).slice(1).filter(Boolean)) {
        const parts = line.trim().split(/\s+/);
        const pid = Number(parts[1]);
        const name = parts.slice(8).join(' ');
        const protocol = /\bUDP\b/i.test(name) ? 'udp' : 'tcp';
        const endpoint = /(.*):(\d+)(?:\s+\(([^)]+)\))?$/.exec(name);
        rows.push({ protocol, localAddress: endpoint?.[1] ?? name, localPort: endpoint ? Number(endpoint[2]) : undefined, state: endpoint?.[3], pid: Number.isInteger(pid) ? pid : undefined });
      }
    }
    for (const line of stdout.split(/\r?\n/).filter(Boolean)) {
      const parts = line.trim().split(/\s+/);
      const protocol = parts[0]?.toLowerCase();
      const localRaw = parts[4] ?? '';
      const match = /^(.*):(\d+)$/.exec(localRaw);
      const pidMatch = /pid=(\d+)/.exec(line);
      rows.push({ protocol, localAddress: match?.[1] ?? localRaw, localPort: match ? Number(match[2]) : undefined, state: parts[1], pid: pidMatch ? Number(pidMatch[1]) : undefined });
    }
  }
  if (options.protocol) rows = rows.filter((entry) => entry.protocol === options.protocol);
  if (options.port !== undefined) rows = rows.filter((entry) => entry.localPort === options.port);
  if (options.pid !== undefined) rows = rows.filter((entry) => entry.pid === options.pid);
  return { ports: rows.slice(0, limit), totalMatched: rows.length, truncated: rows.length > limit };
}

export async function environmentInfo(options: { includeValues?: boolean; filter?: string } = {}) {
  const entries = Object.entries(process.env)
    .filter(([name]) => !options.filter || name.toLowerCase().includes(options.filter.toLowerCase()))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, value]) => ({
      name,
      value: !options.includeValues ? undefined : SENSITIVE_ENV.test(name) ? '[REDACTED]' : value,
      sensitive: SENSITIVE_ENV.test(name),
    }));
  return { includeValues: options.includeValues === true, variables: entries };
}

export async function diskInfo(access: MachineAccess, requestedPath?: string) {
  const target = await resolveMachinePath(access, requestedPath ?? '.', true);
  const stats = await fs.statfs(target);
  const blockSize = Number(stats.bsize);
  const totalBytes = Number(stats.blocks) * blockSize;
  const freeBytes = Number(stats.bavail) * blockSize;
  return { path: target, totalBytes, freeBytes, usedBytes: totalBytes - freeBytes };
}

export async function networkInfo() {
  const interfaces = Object.entries(os.networkInterfaces()).flatMap(([name, values]) =>
    (values ?? []).map((entry) => ({
      name,
      address: entry.address,
      family: entry.family,
      internal: entry.internal,
      mac: entry.mac,
      cidr: entry.cidr,
      scopeid: entry.scopeid,
    })),
  );
  return { interfaces };
}
