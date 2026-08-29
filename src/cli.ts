#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..');
const scriptsDir = path.join(projectRoot, 'scripts');

type Command = 'setup' | 'up' | 'down' | 'restart' | 'status' | 'doctor' | 'help';

export function usage(): string {
  return `chatgpt-local\n\nUsage:\n  chatgpt-local setup\n  chatgpt-local up\n  chatgpt-local down\n  chatgpt-local restart\n  chatgpt-local status\n  chatgpt-local doctor\n\n`;
}

export function run(program: string, args: string[], cwd = projectRoot): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { cwd, stdio: 'inherit', windowsHide: true });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`${program} exited with code ${code ?? 'unknown'}`)));
  });
}

function runNpm(args: string[]): Promise<void> {
  if (process.platform === 'win32') return run('cmd.exe', ['/d', '/s', '/c', `npm ${args.join(' ')}`]);
  return run('npm', args);
}

export function resolveScript(platform: NodeJS.Platform, scriptsDir: string, name: string): { program: string; args: string[] } {
  if (platform === 'win32') {
    const file = path.join(scriptsDir, `${name}.ps1`);
    return { program: 'powershell.exe', args: ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', file] };
  }
  const file = path.join(scriptsDir, `${name}.sh`);
  return { program: 'bash', args: [file] };
}

function script(name: string): { program: string; args: string[] } {
  return resolveScript(process.platform, scriptsDir, name);
}

async function runScript(name: string): Promise<void> {
  const { program, args } = script(name);
  await run(program, args);
}

export function preflight(root: string): string[] {
  const missing: string[] = [];
  const packageJson = path.join(root, 'package.json');
  if (!existsSync(packageJson)) missing.push('package.json');

  if (process.platform === 'win32') {
    if (!existsSync(path.join(root, 'tools', 'tunnel-client-v0.0.13', 'tunnel-client.exe'))) missing.push('tunnel-client');
    if (!existsSync(path.join(root, '.tunnel', 'control-plane-api-key.dpapi')) && !process.env.CONTROL_PLANE_API_KEY) missing.push('runtime key');
  } else {
    if (!existsSync(path.join(root, 'tools', 'tunnel-client-v0.0.13', 'tunnel-client'))) missing.push('tunnel-client');
    if (!process.env.CONTROL_PLANE_API_KEY && !existsSync(path.join(root, '.tunnel', 'control-plane-api-key'))) missing.push('runtime key');
  }
  return missing;
}

async function setup(): Promise<void> {
  const missing = preflight(projectRoot);

  process.stdout.write(`chatgpt-local setup\nproject: ${projectRoot}\n`);
  if (missing.length) {
    process.stdout.write(`missing: ${missing.join(', ')}\n\nSee README.md setup instructions, then run: chatgpt-local up\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write('preflight: ok\n');
  await runNpm(['run', 'build']);
  process.stdout.write('ready: run `chatgpt-local up`\n');
}

async function main(): Promise<void> {
  const command = (process.argv[2] ?? 'help') as Command;
  switch (command) {
    case 'setup':
      await setup();
      break;
    case 'up':
      await runNpm(['run', 'build']);
      await runScript('start-tunnel');
      break;
    case 'down':
      await runScript('stop-tunnel');
      break;
    case 'restart':
      await runNpm(['run', 'build']);
      await runScript('refresh-tunnel');
      break;
    case 'status':
      await runScript('status-tunnel');
      break;
    case 'doctor':
      await run(process.execPath, [path.join(projectRoot, 'dist', 'index.js'), '--doctor']);
      break;
    case 'help':
    default:
      process.stdout.write(usage());
      if (command !== 'help') process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`chatgpt-local: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
