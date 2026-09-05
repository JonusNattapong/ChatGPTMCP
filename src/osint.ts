import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { lookup } from 'node:dns/promises';
import https from 'node:https';
import { isIP } from 'node:net';
import { ToolError } from './errors.js';
import { redactSecrets } from './audit.js';

const execFileAsync = promisify(execFile);
const MAX_BODY_BYTES = 1_000_000;
const MAX_TEXT_CHARS = 100_000;
const MAX_LINKS = 100;
const MAX_REDIRECTS = 3;

export type OsintScope = 'web' | 'onion';

export interface OsintFetchOptions {
  url: string;
  scope?: OsintScope;
  timeoutMs: number;
  torProxy?: string;
}

export interface OsintFetchResult {
  url: string;
  finalUrl: string;
  scope: OsintScope;
  status: number;
  contentType: string;
  title?: string;
  text: string;
  links: string[];
  truncated: boolean;
}

function isPrivateAddress(address: string): boolean {
  const lower = address.toLowerCase();
  if (lower.startsWith('::ffff:')) return isPrivateAddress(lower.slice(7));
  if (lower === '::1' || lower === 'localhost' || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80:')) return true;
  const octets = lower.split('.').map(Number);
  if (octets.length !== 4 || octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = octets;
  return a === 10 || a === 100 && b >= 64 && b <= 127 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 0 || b === 168)) || (a === 198 && b >= 18 && b <= 19) || a === 0 || a >= 224;
}

function parseUrl(raw: string, scope: OsintScope): URL {
  let url: URL;
  try { url = new URL(raw); } catch { throw new ToolError('INVALID_ARGUMENT', 'url must be an absolute HTTPS URL.'); }
  if (url.protocol !== 'https:') throw new ToolError('INVALID_ARGUMENT', 'OSINT accepts HTTPS URLs only.');
  const onion = url.hostname.toLowerCase().endsWith('.onion');
  if (scope === 'onion' && !onion) throw new ToolError('INVALID_ARGUMENT', 'scope=onion requires a .onion hostname.');
  if (scope === 'web' && onion) throw new ToolError('INVALID_ARGUMENT', 'scope=web cannot fetch .onion hosts; use scope=onion.');
  url.username = '';
  url.password = '';
  url.hash = '';
  return url;
}

async function assertPublicHost(url: URL): Promise<{ address: string; family: number }> {
  const records = await lookup(url.hostname, { all: true }).catch((error: unknown) => { throw new ToolError('NETWORK', `DNS lookup failed for ${url.hostname}: ${error instanceof Error ? error.message : String(error)}`); });
  const address = records.find((entry) => !isPrivateAddress(entry.address));
  if (!address || records.some((entry) => isPrivateAddress(entry.address))) throw new ToolError('POLICY_DENIED', 'OSINT refuses private, loopback, link-local, or unroutable destinations.');
  return { address: address.address, family: isIP(address.address) };
}

function extractHtml(html: string, base: URL): Pick<OsintFetchResult, 'title' | 'text' | 'links' | 'truncated'> {
  const truncated = Buffer.byteLength(html, 'utf8') > MAX_BODY_BYTES;
  const source = html.slice(0, MAX_BODY_BYTES);
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(source)?.[1]?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500);
  const links: string[] = [];
  for (const match of source.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["']/gi)) {
    try {
      const link = new URL(match[1], base);
      if (link.protocol === 'https:' && !links.includes(link.href)) links.push(link.href);
    } catch { /* ignore malformed links */ }
    if (links.length >= MAX_LINKS) break;
  }
  const text = redactSecrets(source.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_CHARS));
  return { title, text, links, truncated };
}

function proxyValue(raw: string): string {
  const proxy = raw || 'socks5h://127.0.0.1:9050';
  let parsed: URL;
  try { parsed = new URL(proxy); } catch { throw new ToolError('INVALID_ARGUMENT', 'tor_proxy must be a socks5h:// URL.'); }
  if (parsed.protocol !== 'socks5h:' || !['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname)) throw new ToolError('POLICY_DENIED', 'Tor proxy must be a local socks5h:// endpoint.');
  if (parsed.username || parsed.password || !parsed.port) throw new ToolError('INVALID_ARGUMENT', 'tor_proxy must not contain credentials and must include a port.');
  return parsed.hostname.includes(':') ? `[${parsed.hostname}]:${parsed.port}` : `${parsed.hostname}:${parsed.port}`;
}

async function fetchOnion(url: URL, timeoutMs: number, torProxy?: string): Promise<{ status: number; contentType: string; body: string; finalUrl: string }> {
  const proxy = proxyValue(torProxy ?? process.env.MCP_TOR_SOCKS_PROXY ?? '');
  try {
    const { stdout } = await execFileAsync('curl', ['--silent', '--show-error', '--location', '--max-redirs', String(MAX_REDIRECTS), '--max-time', String(Math.ceil(timeoutMs / 1000)), '--connect-timeout', String(Math.min(10, Math.ceil(timeoutMs / 1000))), '--max-filesize', String(MAX_BODY_BYTES), '--proto', '=https', '--socks5-hostname', proxy, '--dump-header', '-', '--write-out', '\nX-OSINT-URL:%{url_effective}\n', url.href], { timeout: timeoutMs + 2_000, maxBuffer: MAX_BODY_BYTES + 256_000, windowsHide: true });
    const marker = '\nX-OSINT-URL:';
    const markerAt = stdout.lastIndexOf(marker);
    const finalUrl = markerAt >= 0 ? stdout.slice(markerAt + marker.length).trim() : url.href;
    const payload = markerAt >= 0 ? stdout.slice(0, markerAt) : stdout;
    const headerEnd = payload.lastIndexOf('\r\n\r\n');
    const headers = headerEnd >= 0 ? payload.slice(0, headerEnd) : '';
    const body = headerEnd >= 0 ? payload.slice(headerEnd + 4) : payload;
    const status = Number(/HTTP\/\S+\s+(\d+)/i.exec(headers)?.[1] ?? 0);
    const contentType = /\ncontent-type:\s*([^\r\n]+)/i.exec(headers)?.[1]?.trim() ?? 'text/html';
    if (!finalUrl.toLowerCase().startsWith('https://') || !new URL(finalUrl).hostname.toLowerCase().endsWith('.onion')) throw new ToolError('POLICY_DENIED', 'Redirect left the requested .onion scope.');
    return { status, contentType, body, finalUrl };
  } catch (error: unknown) {
    if (error instanceof ToolError) throw error;
    throw new ToolError('NETWORK', `Tor fetch failed: ${error instanceof Error ? error.message : String(error)}`, 'Start Tor with a local SOCKS5 listener and retry.');
  }
}

async function fetchPublicHttps(url: URL, timeoutMs: number, address: { address: string; family: number }): Promise<{ status: number; contentType: string; body: string; finalUrl: string; location?: string }> {
  return new Promise((resolve, reject) => {
    const request = https.request(url, {
      method: 'GET',
      headers: { accept: 'text/html,text/plain;q=0.9' },
      timeout: timeoutMs,
      lookup: (_hostname, options, callback) => options.all
        ? callback(null, [{ address: address.address, family: address.family }])
        : callback(null, address.address, address.family),
    }, (response) => {
      const contentType = response.headers['content-type'] ?? '';
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400) { const location = response.headers.location; response.resume(); resolve({ status: response.statusCode, contentType: '', body: '', finalUrl: url.href, location }); return; }
      if (!/^text\/(html|plain)\b/i.test(contentType)) { response.resume(); reject(new ToolError('BINARY_FILE', `OSINT only extracts text/html or text/plain responses (received ${contentType || 'unknown'}).`)); return; }
      const chunks: Buffer[] = [];
      let total = 0;
      response.on('data', (chunk: Buffer) => { total += chunk.length; if (total > MAX_BODY_BYTES) { request.destroy(new ToolError('TOO_LARGE', `OSINT response exceeds ${MAX_BODY_BYTES} bytes.`)); return; } chunks.push(chunk); });
      response.on('end', () => resolve({ status: response.statusCode ?? 0, contentType, body: Buffer.concat(chunks).toString('utf8'), finalUrl: url.href }));
    });
    request.on('timeout', () => request.destroy(new ToolError('TIMEOUT', `OSINT request exceeded ${timeoutMs} ms.`)));
    request.on('error', (error: unknown) => reject(error instanceof ToolError ? error : new ToolError('NETWORK', `HTTPS request failed: ${error instanceof Error ? error.message : String(error)}`)));
    request.end();
  });
}

export async function osintFetch(options: OsintFetchOptions): Promise<OsintFetchResult> {
  const scope = options.scope ?? 'web';
  const url = parseUrl(options.url, scope);
  const onion = url.hostname.toLowerCase().endsWith('.onion');
  const response = onion ? await fetchOnion(url, options.timeoutMs, options.torProxy) : await (async () => {
    let current = url;
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
      const address = await assertPublicHost(current);
      const result = await fetchPublicHttps(current, options.timeoutMs, address);
      if (!result.location) return result;
      if (redirects === MAX_REDIRECTS) throw new ToolError('NETWORK', `OSINT followed more than ${MAX_REDIRECTS} redirects.`);
      const next = new URL(result.location, current);
      if (next.protocol !== 'https:' || next.hostname.toLowerCase().endsWith('.onion')) throw new ToolError('POLICY_DENIED', 'Clearnet OSINT redirects must remain HTTPS clearnet URLs.');
      current = next;
    }
    throw new ToolError('NETWORK', 'OSINT redirect handling failed.');
  })();
  const extracted = extractHtml(response.body, new URL(response.finalUrl));
  return { url: options.url, finalUrl: response.finalUrl, scope, status: response.status, contentType: response.contentType, ...extracted };
}

export async function osintSearch(query: string, scope: OsintScope, timeoutMs: number, torProxy?: string): Promise<{ query: string; scope: OsintScope; provider: string; results: Array<{ title: string; url: string; snippet: string }> }> {
  if (!query.trim() || query.length > 500) throw new ToolError('INVALID_ARGUMENT', 'query must be 1-500 characters.');
  const provider = scope === 'onion' ? 'Ahmia' : 'DuckDuckGo HTML';
  const endpoint = scope === 'onion' ? `https://ahmia.fi/search/?q=${encodeURIComponent(query)}` : `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const page = await osintFetch({ url: endpoint, scope: 'web', timeoutMs, torProxy });
  const results: Array<{ title: string; url: string; snippet: string }> = [];
  const blocks = page.text.split(/(?=https?:\/\/)/);
  for (const rawLink of page.links) {
    let link = rawLink;
    try {
      const parsed = new URL(rawLink);
      const encoded = parsed.searchParams.get('uddg');
      if (encoded) link = decodeURIComponent(encoded);
    } catch { continue; }
    let parsed: URL;
    try { parsed = new URL(link); } catch { continue; }
    if (parsed.hostname === 'html.duckduckgo.com' || parsed.hostname === 'duckduckgo.com' || parsed.hostname === 'ahmia.fi') continue;
    const isOnion = parsed.hostname.toLowerCase().endsWith('.onion');
    if ((scope === 'onion') !== isOnion) continue;
    const title = link;
    results.push({ title, url: link, snippet: blocks.find((part) => part.includes(link))?.slice(0, 500) ?? '' });
    if (results.length >= 20) break;
  }
  return { query, scope, provider, results };
}
