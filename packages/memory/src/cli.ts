import { detectClient, getDatabasePath, getWorkspaceRoot } from './client';
import { runMigrations, sqlite } from './db/client';
import { hybridSearchDebug } from './memory/search';
import {
  addMemoryFeedback,
  addTimelineEvent,
  buildTree,
  clearTimeline,
  listMemoryFeedback,
  listMemoryTraces,
  recentTimelineEvents,
  recall as searchMemories,
  searchTimelineEvents,
  remember as storeMemory,
  supersedeMemory,
  treeList,
  treeMv,
  treePrune,
} from './memory/store';
import { getLoopState, runImproveCycle, startLoop, stopLoop } from './self-improvement';

export async function runCli(args: string[]) {
  const [command, ...rest] = args;

  switch (command) {
    case 'init':
      runMigrations();
      console.log(
        JSON.stringify(
          {
            status: 'ok',
            databasePath: getDatabasePath(),
            client: detectClient(),
            workspaceRoot: getWorkspaceRoot(),
          },
          null,
          2,
        ),
      );
      return;
    case 'doctor':
      await runDoctor();
      return;
    case 'remember':
      await runRemember(rest);
      return;
    case 'recall':
      await runRecall(rest);
      return;
    case 'trace':
      await runTrace(rest);
      return;
    case 'feedback':
      await runFeedback(rest);
      return;
    case 'timeline':
      await runTimeline(rest);
      return;
    case 'supersede':
      await runSupersede(rest);
      return;
    case 'improve':
      await runImprove(rest);
      return;
    case 'tree':
      await runTree(rest);
      return;
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      printHelp();
      return;
    default:
      console.error(`Unknown ourbook-mcp command: ${command}`);
      printHelp();
      process.exitCode = 1;
  }
}

async function runImprove(args: string[]) {
  const watch = readFlag(args, 'watch') !== undefined;
  const interval = Number(readFlag(args, 'interval')) || 30 * 60 * 1000;

  if (watch) {
    console.error(`Starting self-improvement loop (interval: ${interval}ms)...`);
    startLoop(interval);
    // Keep the process alive
    await new Promise(() => {});
    return;
  }

  const status = readFlag(args, 'status');
  if (status !== undefined) {
    const state = getLoopState();
    console.log(JSON.stringify(state, null, 2));
    return;
  }

  const stop = readFlag(args, 'stop');
  if (stop !== undefined) {
    stopLoop();
    console.log(JSON.stringify({ status: 'stopped' }, null, 2));
    return;
  }

  // Run one cycle
  const result = await runImproveCycle();
  console.log(JSON.stringify(result, null, 2));
}

async function runRemember(args: string[]) {
  const content = args.join(' ').trim();

  if (!content) {
    console.error(
      'Usage: ourbook-mcp remember <content> [--tag tag] [--kind note] [--project project]',
    );
    process.exitCode = 1;
    return;
  }

  const memory = await storeMemory({
    content,
    tags: readTags(args),
    project: readFlag(args, 'project'),
    kind: readFlag(args, 'kind') ?? 'note',
    name: readFlag(args, 'name'),
  });

  console.log(JSON.stringify({ id: memory.id, status: 'stored' }, null, 2));
}

async function runRecall(args: string[]) {
  const query = args
    .filter((arg) => !arg.startsWith('--'))
    .join(' ')
    .trim();
  const debug = readFlag(args, 'debug-score') !== undefined;

  if (!query) {
    console.error('Usage: ourbook-mcp recall <query> [--limit 5] [--debug-score]');
    process.exitCode = 1;
    return;
  }

  const treePathRaw = readFlag(args, 'tree-path');
  const treePath = treePathRaw ? treePathRaw.split(',') : undefined;
  const searchOptions = {
    query,
    limit: Number(readFlag(args, 'limit') ?? 5),
    ...(treePath ? { treePath } : {}),
  };

  if (debug) {
    const memories = await hybridSearchDebug(searchOptions);

    console.log(
      JSON.stringify(
        {
          memories: memories.map((m) => ({
            id: m.id,
            content: m.content,
            score: m.score,
            score_vector: m.score_vector,
            score_fts: m.score_fts,
            score_importance: m.score_importance,
            score_recency: m.score_recency,
            score_access: m.score_access,
            tags: m.tags,
            agent: m.agent,
            created_at: m.created_at,
          })),
        },
        null,
        2,
      ),
    );
    return;
  }

  const memories = await searchMemories(searchOptions);

  console.log(
    JSON.stringify(
      {
        memories: memories.map((memory) => ({
          id: memory.id,
          content: memory.content,
          score: memory.score,
          tags: memory.tags,
          agent: memory.agent,
          created_at: memory.created_at,
        })),
      },
      null,
      2,
    ),
  );
}

async function runDoctor() {
  const checks: Record<string, unknown> = {};
  let healthy = true;

  try {
    checks.databasePath = getDatabasePath();
    checks.client = detectClient();
    checks.workspaceRoot = getWorkspaceRoot();
  } catch (error) {
    checks.database = { error: String(error) };
    healthy = false;
  }

  try {
    const migrateRows = sqlite
      .prepare('SELECT name, applied_at FROM __ourbook_memory_migrations ORDER BY name ASC')
      .all() as Array<{ name: string; applied_at: number }>;
    checks.migrations = migrateRows;
  } catch (error) {
    checks.migrations = { error: String(error) };
    healthy = false;
  }

  try {
    const ftsCheck = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%_fts%'")
      .all() as Array<{ name: string }>;
    checks.fts_tables = ftsCheck.map((row) => row.name);
  } catch (error) {
    checks.fts_tables = { error: String(error) };
    healthy = false;
  }

  try {
    const vecCheck = sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='__ourbook_memory_migrations'",
      )
      .all();
    checks.sqlite_vec = {
      loaded: Array.isArray(vecCheck),
      ok: true,
    };
  } catch (error) {
    checks.sqlite_vec = { error: String(error) };
    healthy = false;
  }

  try {
    const { embedText } = await import('./embeddings/embedder');
    console.error('Probing embedding model...');
    const embedding = await embedText('health check');
    checks.embedding = {
      model: 'Xenova/all-MiniLM-L6-v2',
      dimensions: embedding.length,
      ok: embedding.length === 384,
    };
  } catch (error) {
    checks.embedding = { error: String(error) };
    healthy = false;
  }

  try {
    const row = sqlite.prepare('SELECT COUNT(*) AS count FROM memories').get() as { count: number };
    checks.mcp = {
      memories: row.count,
      status: 'connected',
    };
  } catch (error) {
    checks.mcp = { error: String(error) };
    healthy = false;
  }

  console.log(
    JSON.stringify(
      {
        healthy,
        checks,
      },
      null,
      2,
    ),
  );
}

async function runTrace(args: string[]) {
  const traces = await listMemoryTraces(Number(readFlag(args, 'limit') ?? 50));
  console.log(JSON.stringify({ traces }, null, 2));
}

async function runFeedback(args: string[]) {
  const [subcommand, ...rest] = args;

  switch (subcommand) {
    case undefined:
    case 'list':
      await runFeedbackList(rest);
      return;
    case 'add':
      await runFeedbackAdd(rest);
      return;
    case 'important':
      await runFeedbackSignal(rest, 'important');
      return;
    case 'wrong':
      await runFeedbackSignal(rest, 'wrong');
      return;
    default:
      console.error('Usage: ourbook-mcp feedback [list|add|important|wrong]');
      process.exitCode = 1;
  }
}

async function runFeedbackList(args: string[]) {
  const feedback = await listMemoryFeedback({
    limit: Number(readFlag(args, 'limit') ?? 50),
    signal: readFlag(args, 'signal'),
  });
  console.log(JSON.stringify({ feedback }, null, 2));
}

async function runFeedbackAdd(args: string[]) {
  const memoryId = args.find((arg) => !arg.startsWith('--'));
  const signal = readFlag(args, 'signal') as string | undefined;

  if (!memoryId || !signal) {
    console.error('Usage: ourbook-mcp feedback add <memoryId> --signal <signal> [--note note]');
    process.exitCode = 1;
    return;
  }

  await addMemoryFeedback({
    memoryId,
    signal: signal as
      | 'accepted'
      | 'rejected'
      | 'corrected'
      | 'preferred'
      | 'disliked'
      | 'important'
      | 'wrong',
    note: readFlag(args, 'note') ?? null,
  });

  console.log(JSON.stringify({ status: 'recorded' }, null, 2));
}

async function runFeedbackSignal(args: string[], signal: 'important' | 'wrong') {
  const memoryId = args.find((arg) => !arg.startsWith('--'));

  if (!memoryId) {
    console.error(`Usage: ourbook-mcp feedback ${signal} <memoryId> [--note note]`);
    process.exitCode = 1;
    return;
  }

  await addMemoryFeedback({
    memoryId,
    signal,
    note: readFlag(args, 'note') ?? null,
  });

  console.log(JSON.stringify({ status: 'recorded', signal }, null, 2));
}

async function runTimeline(args: string[]) {
  const [subcommand, ...rest] = args;

  switch (subcommand) {
    case undefined:
    case 'recent':
      await runTimelineRecent(rest);
      return;
    case 'search':
      await runTimelineSearch(rest);
      return;
    case 'add':
      await runTimelineAdd(rest);
      return;
    case 'clear':
      await runTimelineClear(rest);
      return;
    default:
      console.error('Usage: ourbook-mcp timeline [recent|search|add|clear]');
      process.exitCode = 1;
  }
}

async function runTimelineRecent(args: string[]) {
  const events = await recentTimelineEvents(Number(readFlag(args, 'limit') ?? 20));
  console.log(JSON.stringify({ events }, null, 2));
}

async function runTimelineSearch(args: string[]) {
  const query = args
    .filter((arg) => !arg.startsWith('--'))
    .join(' ')
    .trim();

  if (!query) {
    console.error('Usage: ourbook-mcp timeline search <query> [--limit 20]');
    process.exitCode = 1;
    return;
  }

  const events = await searchTimelineEvents(query, Number(readFlag(args, 'limit') ?? 20));
  console.log(JSON.stringify({ events }, null, 2));
}

async function runTimelineAdd(args: string[]) {
  const title = args
    .filter((arg) => !arg.startsWith('--'))
    .join(' ')
    .trim();

  if (!title) {
    console.error(
      'Usage: ourbook-mcp timeline add <title> [--event-type memory_added] [--body summary] [--tags tag]',
    );
    process.exitCode = 1;
    return;
  }

  const metadata = readJsonFlag(args, 'metadata');
  const event = await addTimelineEvent({
    eventType: readFlag(args, 'event-type') ?? 'agent_action',
    title,
    body: readFlag(args, 'body') ?? null,
    tags: readTags(args),
    entityType: readFlag(args, 'entity-type') ?? null,
    entityId: readFlag(args, 'entity-id') ?? null,
    metadata: asRecord(metadata),
  });

  console.log(JSON.stringify({ id: event.id, status: 'added' }, null, 2));
}

async function runTimelineClear(args: string[]) {
  if (readFlag(args, 'confirm') !== 'true') {
    console.error('Refusing to clear timeline. Re-run with --confirm true.');
    process.exitCode = 1;
    return;
  }

  const deleted = await clearTimeline();
  console.log(JSON.stringify({ deleted }, null, 2));
}

async function runSupersede(args: string[]) {
  const id = args.find((arg) => !arg.startsWith('--'));
  const replacementId = args.find((arg, index) => !arg.startsWith('--') && args[index - 1] === id);
  const reason = readFlag(args, 'reason');

  if (!id) {
    console.error('Usage: ourbook-mcp supersede <id> [replacementId] [--reason reason]');
    process.exitCode = 1;
    return;
  }

  const memory = await supersedeMemory({ id, replacementId, reason });
  console.log(
    JSON.stringify(
      {
        id: memory.id,
        status: 'superseded',
        superseded_by: memory.superseded_by,
        superseded_at: memory.superseded_at,
        superseded_reason: memory.superseded_reason,
      },
      null,
      2,
    ),
  );
}

async function runTree(args: string[]) {
  const [subcommand, ...rest] = args;

  switch (subcommand) {
    case undefined:
    case 'browse':
    case 'ls':
      await runTreeBrowse(rest);
      return;
    case 'stats':
      await runTreeStats(rest);
      return;
    case 'prune':
      await runTreePrune(rest);
      return;
    case 'mv':
      await runTreeMv(rest);
      return;
    default:
      console.error('Usage: ourbook-mcp tree [browse|ls|stats|prune|mv]');
      process.exitCode = 1;
  }
}

async function runTreeBrowse(_args: string[]) {
  const entries = await treeList();
  const tree = buildTree(entries);
  console.log(JSON.stringify({ tree }, null, 2));
}

async function runTreeStats(_args: string[]) {
  const entries = await treeList();
  const totalMemories = entries.reduce((sum, e) => sum + e.count, 0);
  const tree = buildTree(entries);
  console.log(
    JSON.stringify(
      {
        branches: entries.length,
        total_memories: totalMemories,
        tree,
      },
      null,
      2,
    ),
  );
}

async function runTreePrune(args: string[]) {
  const prefixRaw = readFlag(args, 'prefix');
  const older = readFlag(args, 'older');

  if (!prefixRaw || !older) {
    console.error('Usage: ourbook-mcp tree prune --prefix a,b --older 30d');
    process.exitCode = 1;
    return;
  }

  const prefix = prefixRaw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const match = older.match(/^(\d+)([dhms])$/);
  if (!match) {
    console.error('--older must be like 30d, 12h, 60m, 30s');
    process.exitCode = 1;
    return;
  }

  const multipliers: Record<string, number> = { d: 86400000, h: 3600000, m: 60000, s: 1000 };
  const olderThanMs = Number(match[1]) * (multipliers[match[2]!] ?? 86400000);

  const deleted = await treePrune({ prefix, olderThanMs });
  console.log(JSON.stringify({ deleted, prefix, older_cutoff_ms: olderThanMs }, null, 2));
}

async function runTreeMv(args: string[]) {
  const oldSegment = args.find((arg) => !arg.startsWith('--'));
  const newSegment = args.find(
    (arg, i) => !arg.startsWith('--') && i !== args.findIndex((a) => !a.startsWith('--')),
  );

  if (!oldSegment || !newSegment) {
    console.error('Usage: ourbook-mcp tree mv <old-segment> <new-segment>');
    process.exitCode = 1;
    return;
  }

  const changed = await treeMv(oldSegment, newSegment);
  console.log(JSON.stringify({ changed, from: oldSegment, to: newSegment }, null, 2));
}

function asRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readJsonFlag(args: string[], name: string) {
  const value = readFlag(args, name);

  if (!value) {
    return undefined;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    console.error(`Invalid JSON for --${name}`);
    process.exitCode = 1;
    return undefined;
  }
}

function readFlag(args: string[], name: string) {
  const prefix = `--${name}`;
  const index = args.findIndex((arg) => arg === prefix || arg.startsWith(`${prefix}=`));

  if (index === -1) {
    return undefined;
  }

  const value = args[index]?.split('=')[1];
  return value && value.length > 0 ? value : args[index + 1];
}

function readTags(args: string[]) {
  const tags: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--tag' || arg === '--tags') {
      const next = args[index + 1];
      if (next) {
        tags.push(next);
      }
      continue;
    }

    if (arg?.startsWith('--tag=') || arg?.startsWith('--tags=')) {
      tags.push(...arg.split('=').slice(1).join('=').split(','));
    }
  }

  return tags;
}

function printHelp() {
  console.log(`ourbook-mcp ${process.env.npm_package_version ?? ''}

Commands:
  init                         Initialize the local database and print client context
  doctor                       Show database, FTS, sqlite-vec, embedding, and MCP health
  remember <content>           Store a memory (--name for tree root name)
  recall <query>               Recall memories (--debug-score for breakdown, --tree-path a,b to filter)
  trace                        Show memory trace entries
  feedback                     List memory feedback records
  feedback list                List memory feedback records
  feedback add <memoryId>      Add a feedback signal to a memory
  feedback important <memoryId> Mark a memory as important
  feedback wrong <memoryId>    Mark a memory as wrong
  timeline                     Show recent timeline events
  timeline recent              Show recent timeline events
  timeline search <query>      Search timeline events by title, body, and tags
  timeline add <title>         Append a timeline event summary
  timeline clear               Clear timeline events with --confirm true
  supersede <id> [replacement] Mark a memory as superseded without deleting it
  improve                      Run one self-improvement cycle (bump, merge, prune, mine)
  improve --watch              Start background auto-improvement loop
  improve --status             Show loop status
  improve --stop               Stop the loop
  tree                         Browse, stats, prune, or rename tree paths
  tree browse                  Show memory tree hierarchy
  tree stats                   Show tree branch counts
  tree prune                   Remove old memories from a branch (--prefix a,b --older 30d)
  tree mv                      Rename a tree path segment (tree mv old new)

Options:
  --tag, --tags                Add memory tags
  --kind                       Memory kind, default: note
  --project                    Project name
  --name                       Memory tree root name (for openclaw/hermes-agent)
  --tree-path                  Tree path segments, comma-separated (e.g. "claudecode")
  --cascade                    Also search parent and child tree paths
  --limit                      Result limit
  --reason                     Supersede reason

Environment:
  OURBOOK_MEMORY_DB               Explicit database path, always wins
  OURBOOK_MEMORY_SCOPE=global     Use ~/.ourbook/memory.db
  OURBOOK_MEMORY_SELF_IMPROVE=1   Enable background self-improvement loop
  OURBOOK_MEMORY_IMPROVE_INTERVAL Loop interval in ms (default: 1800000 = 30min)
  CLAUDE_PROJECT_DIR           Use Claude Code project memory and client detection → claudecode
  CLEW_PROJECT_DIR             Use ClewCode project memory and client detection → clewcode
  OPENCODE_PROJECT_DIR         OpenCode project memory and client detection → opencode
  CODEX_PROJECT_DIR            Codex project memory and client detection → codex
  OPENCLAW_PROJECT_DIR         OpenClaw project memory and client detection → openclaw
  HERMES_AGENT_PROJECT_DIR     Hermes Agent project memory and client detection → hermes-agent`);
}
