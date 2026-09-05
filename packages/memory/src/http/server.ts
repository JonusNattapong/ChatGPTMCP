import { serve } from '@hono/node-server';

import { Hono } from 'hono';

import { countMemories, forgetById, listMemories, stats } from '../memory/store';

export type HttpServerOptions = {
  port?: number;
};

export function createHttpServer() {
  const app = new Hono();

  app.get('/health', async (context) => {
    return context.json({
      status: 'ok',
      memories: await countMemories(),
    });
  });

  app.get('/stats', async (context) => {
    return context.json(await stats());
  });

  app.get('/memories', async (context) => {
    const limit = Number(context.req.query('limit') ?? 50);
    const offset = Number(context.req.query('offset') ?? 0);

    return context.json({
      memories: await listMemories(limit, offset),
    });
  });

  app.delete('/memories/:id', async (context) => {
    const id = context.req.param('id');
    return context.json({ deleted: await forgetById(id) });
  });

  return app;
}

export async function startHttpServer(options: HttpServerOptions = {}) {
  const port = options.port ?? Number(process.env.OURBOOK_MEMORY_HTTP_PORT ?? 7337);
  const app = createHttpServer();

  console.error(`ourbook-mcp HTTP server listening on port ${port}`);
  return serve({
    fetch: app.fetch,
    port,
  });
}
