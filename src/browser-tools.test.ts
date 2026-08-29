import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import {
  browserClick,
  browserClose,
  browserEval,
  browserOpen,
  browserRead,
  browserScreenshot,
  browserType,
  closeBrowser,
  type BrowserAccess,
} from './browser-tools.js';
import { ToolError } from './errors.js';
import { createToolSpecs } from './tools.js';

// The managed browser is a module-level singleton (one process reused across
// every browser_* call in a server run), so tests share it too and clean it
// up exactly once at the end -- by the PID this file's own calls spawned,
// never by killing every process that happens to share Chrome's image name.
let profileDir: string | undefined;

function testAccess(): BrowserAccess {
  if (!profileDir) throw new Error('profileDir not initialized');
  return {
    port: 9339,
    headless: true,
    profileDir,
    allowedOrigins: ['localhost', '127.0.0.1'],
  };
}

async function findBrowser(): Promise<boolean> {
  try {
    const tab = await browserOpen(testAccess(), { url: 'about:blank', waitMs: 5_000 });
    await browserClose({ tabId: tab.tabId });
    return true;
  } catch {
    return false;
  }
}

after(async () => {
  await closeBrowser();
  if (profileDir) await rm(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

test('the tool registry only advertises browser_* tools when browser access is configured', async () => {
  const withoutBrowser = createToolSpecs({ root: process.cwd(), unrestricted: false, maxTimeoutMs: 60_000 });
  assert.equal(withoutBrowser.some((spec) => spec.name.startsWith('browser_')), false);

  const withBrowser = createToolSpecs({
    root: process.cwd(),
    unrestricted: false,
    maxTimeoutMs: 60_000,
    browser: { port: 9339, headless: true, profileDir: '.', allowedOrigins: ['localhost'] },
  });
  const browserToolNames = withBrowser.filter((spec) => spec.name.startsWith('browser_')).map((spec) => spec.name);
  assert.deepEqual(browserToolNames, ['browser_open', 'browser_read', 'browser_click', 'browser_type', 'browser_eval', 'browser_screenshot', 'browser_close']);
});

test('browser_open rejects a URL whose host is outside the allowlist before launching anything', async () => {
  const access: BrowserAccess = { port: 9339, headless: true, profileDir: '/tmp/unused', allowedOrigins: ['localhost'] };
  await assert.rejects(
    browserOpen(access, { url: 'https://example.com' }),
    (error: unknown) => {
      assert.ok(error instanceof ToolError);
      assert.equal(error.code, 'POLICY_DENIED');
      assert.deepEqual(error.details?.allowed, ['localhost']);
      return true;
    },
  );
});

test('browser_open rejects a non-http(s) URL', async () => {
  const access: BrowserAccess = { port: 9339, headless: true, profileDir: '/tmp/unused', allowedOrigins: ['localhost'] };
  await assert.rejects(
    browserOpen(access, { url: 'file:///etc/passwd' }),
    (error: unknown) => error instanceof ToolError && error.code === 'INVALID_ARGUMENT',
  );
});

test('browser lifecycle: open, read, type, click, eval, screenshot, close', async (t) => {
  profileDir = await mkdtemp(path.join(tmpdir(), 'machine-mcp-browser-'));
  const available = await findBrowser();
  if (!available) {
    t.skip('No Chrome/Edge executable was found on this machine.');
    return;
  }

  const access = testAccess();
  const html = 'data:text/html,' + encodeURIComponent('<html><body><h1 id="title">Hello</h1><input id="box"><button id="go">Go</button><script>document.getElementById("go").onclick=()=>{document.getElementById("title").textContent="Clicked"}</script></body></html>');
  const tab = await browserOpen(access, { url: html, waitMs: 5_000 });
  assert.ok(tab.tabId);
  assert.equal(tab.url, html);
  assert.equal(tab.timedOut, false);

  try {
    const read = await browserRead({ tabId: tab.tabId, selector: '#title' });
    assert.equal(read.text, 'Hello');

    const typed = await browserType({ tabId: tab.tabId, selector: '#box', text: 'abc' });
    assert.equal(typed.currentValue, 'abc');

    const clicked = await browserClick({ tabId: tab.tabId, selector: '#go' });
    assert.equal(clicked.clicked, true);

    const afterClick = await browserRead({ tabId: tab.tabId, selector: '#title' });
    assert.equal(afterClick.text, 'Clicked');

    const evaluated = await browserEval({ tabId: tab.tabId, expression: '1 + 2' });
    assert.equal(evaluated.value, 3);

    const shot = await browserScreenshot({ tabId: tab.tabId, format: 'jpeg', quality: 50 });
    assert.ok(shot.bytes > 0);
    assert.equal(shot.mimeType, 'image/jpeg');
  } finally {
    await browserClose({ tabId: tab.tabId });
  }
});
