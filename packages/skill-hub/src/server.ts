import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { SkillRegistry } from './registry.js';

function text(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function errorResult(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return { content: [{ type: 'text' as const, text: message }], isError: true };
}

export function createSkillHubServer(registry: SkillRegistry): McpServer {
  const server = new McpServer({ name: 'chatgpt-skill-hub', version: '0.1.0' });

  server.registerTool('skill_list', {
    description: 'List installed skills from the configured skill registry.',
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    inputSchema: z.object({
      offset: z.number().int().min(0).default(0),
      limit: z.number().int().min(1).max(200).default(50)
    })
  }, async ({ offset, limit }) => {
    try {
      await registry.ensureReady();
      return text({ ...registry.stats(), offset, limit, skills: registry.list(offset, limit) });
    } catch (error) { return errorResult(error); }
  });

  server.registerTool('skill_search', {
    description: 'Search skills by name and description. Use this before reading a skill when the exact skill name is unknown.',
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    inputSchema: z.object({
      query: z.string().min(1),
      limit: z.number().int().min(1).max(50).default(10)
    })
  }, async ({ query, limit }) => {
    try {
      await registry.ensureReady();
      return text({ query, results: registry.search(query, limit) });
    } catch (error) { return errorResult(error); }
  });

  server.registerTool('skill_resolve', {
    description: 'Recommend the most relevant skills for a natural-language task.',
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    inputSchema: z.object({
      task: z.string().min(1),
      limit: z.number().int().min(1).max(20).default(5)
    })
  }, async ({ task, limit }) => {
    try {
      await registry.ensureReady();
      return text({ task, recommended: registry.resolve(task, limit) });
    } catch (error) { return errorResult(error); }
  });

  server.registerTool('skill_read', {
    description: 'Read SKILL.md or a referenced text file inside a selected skill. Paths are sandboxed to the skill directory.',
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    inputSchema: z.object({
      name: z.string().min(1),
      path: z.string().min(1).default('SKILL.md')
    })
  }, async ({ name, path }) => {
    try {
      await registry.ensureReady();
      return text(await registry.read(name, path));
    } catch (error) { return errorResult(error); }
  });

  server.registerTool('skill_sync', {
    description: 'Rescan the configured skills source directory and refresh the in-memory registry.',
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    inputSchema: z.object({})
  }, async () => {
    try { return text(await registry.sync()); }
    catch (error) { return errorResult(error); }
  });

  server.registerTool('skill_stats', {
    description: 'Return registry health, source root, count, and last sync time.',
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    inputSchema: z.object({})
  }, async () => {
    try {
      await registry.ensureReady();
      return text(registry.stats());
    } catch (error) { return errorResult(error); }
  });

  return server;
}
