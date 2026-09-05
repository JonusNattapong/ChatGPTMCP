#!/usr/bin/env node

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import packageJson from '../package.json';
import { runCli } from './cli';
import { closeDatabase, runMigrations } from './db/client';
import { startHttpServer } from './http/server';
import { startConsolidationLoop } from './ourbook/loop';
import { startLoop } from './self-improvement';
import { registerBatchRememberTool } from './tools/batch-remember';
import { registerConsolidateTool } from './tools/consolidate';
import { registerDreamTool } from './tools/dream';
import { registerExportImportTools } from './tools/export-import';
import { registerFeedbackTool } from './tools/feedback';
import { registerForgetTool } from './tools/forget';
import { registerHandoffTool } from './tools/handoff';
import { registerRecallTool } from './tools/recall';
import { registerReflectTool } from './tools/reflect';
import { registerReflectSessionTool } from './tools/reflect-session';
import { registerRememberTool } from './tools/remember';
import { registerSelfImproveTool } from './tools/self-improve';
import { registerStatsTool } from './tools/stats';
import { registerSupersedeTool } from './tools/supersede';
import { registerTimelineTool } from './tools/timeline';
import { registerTreeTool } from './tools/tree';
import { registerUpdateTool } from './tools/update';
import { registerWorkingTool } from './tools/working';

export const server = new McpServer({
  name: 'ourbook-mcp',
  version: packageJson.version,
});

export function createServer() {
  registerRememberTool(server);
  registerRecallTool(server);
  registerConsolidateTool(server);
  registerDreamTool(server);
  registerSelfImproveTool(server);
  registerForgetTool(server);
  registerHandoffTool(server);
  registerReflectTool(server);
  registerReflectSessionTool(server);
  registerUpdateTool(server);
  registerSupersedeTool(server);
  registerStatsTool(server);
  registerTreeTool(server);
  registerBatchRememberTool(server);
  registerExportImportTools(server);
  registerWorkingTool(server);
  registerFeedbackTool(server);
  registerTimelineTool(server);
  return server;
}

async function main() {
  createServer();
  runMigrations();

  if (process.env.OURBOOK_MEMORY_HTTP === '1') {
    await startHttpServer();
  }

  if (process.env.OURBOOK_MEMORY_SELF_IMPROVE === '1') {
    const interval = Number(process.env.OURBOOK_MEMORY_IMPROVE_INTERVAL) || 30 * 60 * 1000;
    startLoop(interval);
    console.error(`ourbook-mcp self-improvement loop started (interval: ${interval}ms)`);
  }

  if (process.env.OURBOOK_NIGHTLY_CONSOLIDATION !== '0') {
    const localHour = Number(process.env.OURBOOK_CONSOLIDATION_HOUR ?? 2);
    const checkIntervalMs =
      Number(process.env.OURBOOK_CONSOLIDATION_CHECK_INTERVAL) || 60 * 60 * 1000;
    startConsolidationLoop({ localHour, checkIntervalMs });
    console.error(
      `ourbook-mcp nightly consolidation enabled (local hour: ${localHour}, check interval: ${checkIntervalMs}ms)`,
    );
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('ourbook-mcp MCP server running on stdio');
}

function isMainModule() {
  const entry = process.argv[1];
  return entry ? resolve(entry) === fileURLToPath(import.meta.url) : false;
}

if (isMainModule()) {
  const command = process.argv[2];

  if (command && command !== 'mcp') {
    runCli(process.argv.slice(2)).catch((error) => {
      console.error('Fatal ourbook-mcp CLI error:', error);
      closeDatabase();
      process.exit(1);
    });
  } else {
    main().catch((error) => {
      console.error('Fatal ourbook-mcp startup error:', error);
      closeDatabase();
      process.exit(1);
    });
  }
}

export default server;
