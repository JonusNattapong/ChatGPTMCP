/**
 * Browser control over the Chrome DevTools Protocol.
 *
 * Opt-in only (`--enable-browser`): a bridge that already grants filesystem
 * and shell access does not need a live, scriptable browser turned on by
 * default. When enabled, this module launches an isolated Chrome/Edge
 * instance with its own profile directory -- never the operator's real
 * profile, which would carry live cookies and sessions -- and restricts
 * navigation to an origin allowlist that defaults to loopback only.
 */
import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { CdpSocket } from './cdp-socket.js';
import { ToolError } from './errors.js';

const execFileAsync = promisify(execFile);

export interface BrowserAccess {
  port: number;
  headless: boolean;
  profileDir: string;
  executablePath?: string;
  allowedOrigins: string[];
  launchTimeoutMs?: number;
}

interface TabSession {
  ws: CdpSocket;
  targetId: string;
}

const tabs = new Map<string, TabSession>();
let browserProcess: ChildProcess | undefined;
let browserBaseUrl: string | undefined;
let launching: Promise<string> | undefined;

const NAV_POLL_INTERVAL_MS = 100;
const DEFAULT_NAV_TIMEOUT_MS = 15_000;
const DEFAULT_LAUNCH_TIMEOUT_MS = 10_000;
const MAX_READ_CHARS = 20_000;

/** Candidate executables, most-preferred first. Edge ships with every modern Windows install. */
function candidateExecutables(): string[] {
  if (process.platform === 'win32') {
    const programFiles = [process.env['ProgramFiles'], process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA].filter((value): value is string => Boolean(value));
    return programFiles.flatMap((base) => [
      path.join(base, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(base, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    ]);
  }
  if (process.platform === 'darwin') {
    return [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ];
  }
  return ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge'];
}

async function findExecutable(preferred?: string): Promise<string> {
  if (preferred) return preferred;
  for (const candidate of candidateExecutables()) {
    try {
      if (path.isAbsolute(candidate)) {
        await fs.access(candidate);
        return candidate;
      }
      await execFileAsync(candidate, ['--version'], { windowsHide: true, timeout: 5_000 });
      return candidate;
    } catch {
      continue;
    }
  }
  throw new ToolError(
    'DEPENDENCY_MISSING',
    'No Chrome or Edge executable was found for browser control.',
    'Install Google Chrome or Microsoft Edge, or pass --browser-executable to point at one.',
  );
}

async function cdpEndpoint(baseUrl: string, path: string, init?: { method?: string }): Promise<unknown> {
  const response = await fetch(`${baseUrl}${path}`, { method: init?.method ?? 'GET' });
  if (!response.ok) throw new ToolError('INTERNAL', `DevTools HTTP endpoint ${path} returned ${response.status}.`);
  return response.json();
}

async function ensureBrowser(access: BrowserAccess): Promise<string> {
  if (browserBaseUrl) return browserBaseUrl;
  if (launching) return launching;

  launching = (async () => {
    const executable = await findExecutable(access.executablePath);
    await fs.mkdir(access.profileDir, { recursive: true });
    const args = [
      `--remote-debugging-port=${access.port}`,
      `--remote-debugging-address=127.0.0.1`,
      `--user-data-dir=${access.profileDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-features=Translate',
    ];
    if (access.headless) args.push('--headless=new');
    const child = spawn(executable, args, { stdio: 'ignore', windowsHide: true, detached: false });
    child.once('exit', () => {
      browserProcess = undefined;
      browserBaseUrl = undefined;
      launching = undefined;
      for (const tabId of [...tabs.keys()]) tabs.delete(tabId);
    });
    browserProcess = child;

    const baseUrl = `http://127.0.0.1:${access.port}`;
    const deadline = Date.now() + (access.launchTimeoutMs ?? DEFAULT_LAUNCH_TIMEOUT_MS);
    while (Date.now() < deadline) {
      try {
        await cdpEndpoint(baseUrl, '/json/version');
        browserBaseUrl = baseUrl;
        return baseUrl;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, NAV_POLL_INTERVAL_MS));
      }
    }
    child.kill();
    throw new ToolError('TIMEOUT', 'The browser did not become reachable on its DevTools port in time.');
  })();

  try {
    return await launching;
  } finally {
    launching = undefined;
  }
}

const BROWSER_STOP_TIMEOUT_MS = 8_000;

/**
 * Terminate the managed browser process, if one is running, by its own PID
 * only. This must never fall back to killing every process sharing the
 * executable's name (e.g. "taskkill /IM chrome.exe") -- that would close
 * every Chrome window on the machine, including ones the operator has open
 * with unsaved work, not just the isolated instance this module launched.
 */
export async function closeBrowser(): Promise<void> {
  const child = browserProcess;
  for (const session of tabs.values()) session.ws.close();
  tabs.clear();
  if (!child?.pid) {
    browserProcess = undefined;
    browserBaseUrl = undefined;
    return;
  }
  const pid = child.pid;
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  if (process.platform === 'win32') {
    const killer = spawn('taskkill.exe', ['/pid', String(pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
    await new Promise<void>((resolve) => { killer.once('close', () => resolve()); killer.once('error', () => resolve()); });
  } else {
    try { child.kill('SIGTERM'); } catch { /* already exited */ }
  }
  await Promise.race([exited, new Promise<void>((resolve) => setTimeout(resolve, BROWSER_STOP_TIMEOUT_MS))]);
  if (process.platform !== 'win32') {
    try { child.kill('SIGKILL'); } catch { /* already exited */ }
  }
  browserProcess = undefined;
  browserBaseUrl = undefined;
}

function hostnameAllowed(hostname: string, allowed: string[]): boolean {
  return allowed.some((pattern) => {
    if (pattern.startsWith('*.')) return hostname === pattern.slice(2) || hostname.endsWith(pattern.slice(1));
    return hostname === pattern;
  });
}

function assertOriginAllowed(rawUrl: string, allowed: string[]): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ToolError('INVALID_ARGUMENT', `"${rawUrl}" is not a valid URL.`);
  }
  // about:blank and data: URLs carry no navigable network origin, so the
  // allowlist -- which exists to bound where the browser can reach on the
  // network -- does not apply to them. Anything else must be http/https.
  if (url.protocol === 'about:' || url.protocol === 'data:') return url;
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ToolError('INVALID_ARGUMENT', `Only http/https, about:, and data: URLs are allowed, not "${url.protocol}".`);
  }
  if (!hostnameAllowed(url.hostname, allowed)) {
    throw new ToolError(
      'POLICY_DENIED',
      `Navigation to "${url.hostname}" is not in the browser origin allowlist.`,
      'Pass --browser-allow-origin for this host to permit it, or navigate to an already-allowed origin.',
      { hostname: url.hostname, allowed },
    );
  }
  return url;
}

function getTab(tabId: string): TabSession {
  const session = tabs.get(tabId);
  if (!session) {
    throw new ToolError(
      'NOT_FOUND',
      `Browser tab ${tabId} is not open in this session.`,
      'Call browser_open first; tabs do not survive an MCP server restart.',
      { openTabs: [...tabs.keys()] },
    );
  }
  return session;
}

interface EvalOutcome {
  value: unknown;
  exceptionText?: string;
}

async function evaluate(ws: CdpSocket, expression: string, awaitPromise = false): Promise<EvalOutcome> {
  const result = await ws.send<{
    result: { value?: unknown; description?: string };
    exceptionDetails?: { text?: string; exception?: { description?: string } };
  }>('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
  if (result.exceptionDetails) {
    return { value: undefined, exceptionText: result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? 'Script threw an error.' };
  }
  return { value: result.result.value };
}

export async function browserOpen(access: BrowserAccess, opts: { url: string; waitMs?: number }) {
  const url = assertOriginAllowed(opts.url, access.allowedOrigins);
  const baseUrl = await ensureBrowser(access);
  const created = await cdpEndpoint(baseUrl, `/json/new?${encodeURIComponent(url.href)}`, { method: 'PUT' })
    .catch(() => cdpEndpoint(baseUrl, `/json/new?${encodeURIComponent(url.href)}`)) as { id: string; webSocketDebuggerUrl: string };

  const ws = await CdpSocket.connect(created.webSocketDebuggerUrl);
  try {
    await ws.send('Page.enable');
    await ws.send('Runtime.enable');
    const deadline = Date.now() + (opts.waitMs ?? DEFAULT_NAV_TIMEOUT_MS);
    let readyState = 'loading';
    let currentUrl = 'about:blank';
    while (Date.now() < deadline) {
      const [stateOutcome, urlOutcome] = await Promise.all([
        evaluate(ws, 'document.readyState'),
        evaluate(ws, 'location.href'),
      ]);
      readyState = typeof stateOutcome.value === 'string' ? stateOutcome.value : readyState;
      currentUrl = typeof urlOutcome.value === 'string' ? urlOutcome.value : currentUrl;
      // A newly-created CDP target briefly exposes its initial about:blank
      // document as complete before the requested navigation starts. Do not
      // mistake that initial document for the destination page.
      const navigationStarted = url.href === 'about:blank' || currentUrl !== 'about:blank';
      if (navigationStarted && readyState === 'complete') break;
      await new Promise((resolve) => setTimeout(resolve, NAV_POLL_INTERVAL_MS));
    }
    const titleOutcome = await evaluate(ws, 'document.title');
    const urlOutcome = await evaluate(ws, 'location.href');
    currentUrl = typeof urlOutcome.value === 'string' ? urlOutcome.value : currentUrl;
    tabs.set(created.id, { ws, targetId: created.id });
    return {
      tabId: created.id,
      url: currentUrl,
      title: typeof titleOutcome.value === 'string' ? titleOutcome.value : '',
      readyState,
      timedOut: readyState !== 'complete',
    };
  } catch (error) {
    ws.close();
    throw error;
  }
}

export async function browserRead(opts: { tabId: string; selector?: string; maxChars?: number }) {
  const { ws } = getTab(opts.tabId);
  const maxChars = Math.min(opts.maxChars ?? MAX_READ_CHARS, MAX_READ_CHARS);
  const script = `(() => {
    const selector = ${JSON.stringify(opts.selector ?? null)};
    const el = selector ? document.querySelector(selector) : document.body;
    if (selector && !el) return { found: false };
    const text = (el.innerText ?? el.textContent ?? '').slice(0, ${maxChars});
    return { found: true, url: location.href, title: document.title, text, truncated: (el.innerText ?? el.textContent ?? '').length > ${maxChars} };
  })()`;
  const outcome = await evaluate(ws, script);
  if (outcome.exceptionText) throw new ToolError('INTERNAL', `browser_read failed: ${outcome.exceptionText}`);
  const value = outcome.value as { found: boolean; url?: string; title?: string; text?: string; truncated?: boolean };
  if (!value.found) throw new ToolError('NOT_FOUND', `No element matched selector "${opts.selector}".`);
  return { tabId: opts.tabId, url: value.url, title: value.title, text: value.text, truncated: value.truncated === true };
}

export async function browserClick(opts: { tabId: string; selector: string }) {
  const { ws } = getTab(opts.tabId);
  const script = `(() => {
    const el = document.querySelector(${JSON.stringify(opts.selector)});
    if (!el) return { found: false };
    el.scrollIntoView({ block: 'center', inline: 'center' });
    el.click();
    return { found: true };
  })()`;
  const outcome = await evaluate(ws, script);
  if (outcome.exceptionText) throw new ToolError('INTERNAL', `browser_click failed: ${outcome.exceptionText}`);
  const value = outcome.value as { found: boolean };
  if (!value.found) throw new ToolError('NOT_FOUND', `No element matched selector "${opts.selector}".`);
  return { tabId: opts.tabId, clicked: true, note: 'This is a script-dispatched click (element.click()), not a trusted OS-level input event.' };
}

export async function browserType(opts: { tabId: string; selector: string; text: string; clear?: boolean }) {
  const { ws } = getTab(opts.tabId);
  const script = `(() => {
    const el = document.querySelector(${JSON.stringify(opts.selector)});
    if (!el) return { found: false };
    el.focus();
    const clear = ${opts.clear === true};
    const text = ${JSON.stringify(opts.text)};
    if (el.isContentEditable) {
      el.textContent = clear ? text : (el.textContent || '') + text;
    } else {
      const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      const next = clear ? text : (el.value || '') + text;
      if (setter) setter.call(el, next); else el.value = next;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { found: true, value: el.value ?? el.textContent };
  })()`;
  const outcome = await evaluate(ws, script);
  if (outcome.exceptionText) throw new ToolError('INTERNAL', `browser_type failed: ${outcome.exceptionText}`);
  const value = outcome.value as { found: boolean; value?: string };
  if (!value.found) throw new ToolError('NOT_FOUND', `No element matched selector "${opts.selector}".`);
  return { tabId: opts.tabId, typed: true, currentValue: value.value };
}

export async function browserEval(opts: { tabId: string; expression: string }) {
  const { ws } = getTab(opts.tabId);
  const outcome = await evaluate(ws, opts.expression, true);
  if (outcome.exceptionText) throw new ToolError('INTERNAL', `Script threw: ${outcome.exceptionText}`, 'Errors here are the target page\'s own script errors, not a tool bug.');
  return { tabId: opts.tabId, value: outcome.value };
}

export async function browserScreenshot(opts: { tabId: string; format?: 'png' | 'jpeg'; quality?: number }) {
  const { ws } = getTab(opts.tabId);
  const format = opts.format ?? 'jpeg';
  const params: Record<string, unknown> = { format };
  if (format === 'jpeg') params.quality = opts.quality ?? 70;
  const result = await ws.send<{ data: string }>('Page.captureScreenshot', params);
  return { tabId: opts.tabId, mimeType: format === 'png' ? 'image/png' : 'image/jpeg', base64: result.data, bytes: Buffer.byteLength(result.data, 'base64') };
}

export async function browserClose(opts: { tabId: string }) {
  const session = getTab(opts.tabId);
  session.ws.close();
  tabs.delete(opts.tabId);
  if (browserBaseUrl) {
    await cdpEndpoint(browserBaseUrl, `/json/close/${opts.tabId}`).catch(() => undefined);
  }
  return { tabId: opts.tabId, closed: true };
}

export function listOpenTabs(): string[] {
  return [...tabs.keys()];
}

export function isBrowserRunning(): boolean {
  return browserProcess !== undefined;
}
