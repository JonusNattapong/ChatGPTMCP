import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const distDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(distDirectory, '..');

test('tunnel scripts target the supervised runtime', () => {
  for (const file of ['scripts/start-tunnel.ps1', 'scripts/start-tunnel.sh']) {
    const text = readFileSync(path.join(projectRoot, file), 'utf8');
    assert.match(text, /dist[\\/]supervisor\.js/);
    assert.doesNotMatch(text, /--mcp-command[^\r\n]*dist[\\/]index\.js/);
  }
});

test('bash tunnel scripts pass syntax validation when bash is available', (t) => {
  const bash = spawnSync('bash', ['--version'], { stdio: 'ignore' });
  if (bash.status !== 0) return t.skip('bash is not installed');
  for (const name of ['install.sh', 'start-tunnel.sh', 'status-tunnel.sh', 'stop-tunnel.sh', 'watch-tunnel.sh']) {
    const result = spawnSync('bash', ['-n', `scripts/${name}`], { cwd: projectRoot, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
});

test('PowerShell tunnel scripts parse on Windows', (t) => {
  if (process.platform !== 'win32') return t.skip('PowerShell parser check is Windows-only');
  for (const name of ['install.ps1', 'start-tunnel.ps1', 'status-tunnel.ps1', 'stop-tunnel.ps1', 'watch-tunnel.ps1']) {
    const file = path.join(projectRoot, 'scripts', name).replaceAll("'", "''");
    const command = `$errors=$null; [System.Management.Automation.Language.Parser]::ParseFile('${file}', [ref]$null, [ref]$errors) | Out-Null; if ($errors.Count -gt 0) { $errors | ForEach-Object { Write-Error $_.Message }; exit 1 }`;
    const result = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-Command', command], { encoding: 'utf8' });
    assert.equal(result.status, 0, `${name}: ${result.stderr}`);
  }
});
