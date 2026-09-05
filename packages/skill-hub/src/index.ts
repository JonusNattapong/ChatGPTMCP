import { existsSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import path from 'node:path';
import process from 'node:process';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { localhostHostValidation, localhostOriginValidation, toNodeHandler } from '@modelcontextprotocol/node';
import { SkillRegistry } from './registry.js';
import { createSkillHubServer } from './server.js';

function argumentValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function skillsRoot(): string {
  const custom = argumentValue('--skills-root') ?? process.env.SKILLS_ROOT;
  if (custom) return path.resolve(custom);

  let current = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(current, 'skills');
    if (existsSync(candidate)) return candidate;
    current = path.dirname(current);
  }
  return path.resolve(process.cwd(), 'skills');
}

const registry = new SkillRegistry(skillsRoot());
const mode = process.argv.includes('--http') ? 'http' : 'stdio';

if (mode === 'stdio') {
  void registry.sync().then((state) => console.error(`chatgpt-skill-hub indexed ${state.count} skills from ${state.root}`));
  void serveStdio(() => createSkillHubServer(registry));
  console.error('chatgpt-skill-hub MCP server running on stdio');
} else {
  await registry.sync();
  const handler = createMcpHandler(() => createSkillHubServer(registry));
  const nodeHandler = toNodeHandler(handler);
  const validateHost = localhostHostValidation();
  const validateOrigin = localhostOriginValidation();
  const host = process.env.HOST ?? '127.0.0.1';
  const port = Number(process.env.PORT ?? 8787);

  if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') {
    throw new Error('The built-in HTTP mode intentionally binds localhost only. Put an authenticated HTTPS reverse proxy/tunnel in front for remote ChatGPT access.');
  }

  const httpServer = createHttpServer((req, res) => {
    if (req.url !== '/mcp' && req.url !== '/health') {
      res.writeHead(404).end('Not found');
      return;
    }
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, ...registry.stats() }));
      return;
    }
    if (!validateHost(req, res) || !validateOrigin(req, res)) return;
    void nodeHandler(req, res);
  });

  const close = async () => {
    await handler.close();
    httpServer.close();
  };
  process.on('SIGINT', () => void close().finally(() => process.exit(0)));
  process.on('SIGTERM', () => void close().finally(() => process.exit(0)));

  httpServer.listen(port, host, () => {
    console.error(`chatgpt-skill-hub HTTP MCP listening on http://${host}:${port}/mcp`);
  });
}
