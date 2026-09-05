import { createHash } from 'node:crypto';

import { addTimelineEvent, listMemories, type PublicMemory, remember } from '../memory/store';

export type ConsolidateInput = {
  sinceHours?: number;
  limit?: number;
  force?: boolean;
};

export type DreamInput = {
  limit?: number;
  seed?: string;
  theme?: string;
  mood?: string;
  persist?: boolean;
};

type MemoryLike = Pick<
  PublicMemory,
  'id' | 'content' | 'summary' | 'tags' | 'kind' | 'created_at' | 'importance'
>;

const DEFAULT_CONSOLIDATION_HOURS = 24;
const MAX_SOURCE_MEMORIES = 200;
const MAX_FRAGMENT_CHARS = 240;

export async function consolidateSharedMemory(input: ConsolidateInput = {}) {
  const sinceHours = clamp(input.sinceHours ?? DEFAULT_CONSOLIDATION_HOURS, 1, 24 * 30);
  const limit = clamp(input.limit ?? 80, 2, MAX_SOURCE_MEMORIES);
  const now = Date.now();
  const cutoff = now - sinceHours * 60 * 60 * 1000;
  const dayKey = localDayKey(now);
  const recent = (await listMemories(MAX_SOURCE_MEMORIES, 0)).filter(
    (memory) => memory.created_at >= cutoff,
  );

  const existing = recent.find(
    (memory) => memory.kind === 'consolidation' && memory.tags.includes(`day:${dayKey}`),
  );

  if (existing && !input.force) {
    return {
      status: 'already-consolidated' as const,
      consolidation_id: existing.id,
      day: dayKey,
      source_count: 0,
    };
  }

  const source = recent
    .filter((memory) => !['consolidation', 'dream'].includes(memory.kind))
    .slice(0, limit)
    .sort((a, b) => a.created_at - b.created_at);

  if (source.length === 0) {
    return {
      status: 'no-source-memories' as const,
      day: dayKey,
      source_count: 0,
    };
  }

  const content = buildConsolidationContent(source, { dayKey, sinceHours });
  const memory = await remember({
    content,
    tags: ['ourbook', 'consolidation', `day:${dayKey}`, ...topTags(source, 5)],
    agent: 'ourbook',
    provider: 'local',
    model: 'deterministic-consolidator-v1',
    kind: 'consolidation',
    confidence: 0.9,
  });

  await addTimelineEvent({
    eventType: 'memory_consolidated',
    title: `OurBook consolidation ${dayKey}`,
    body: `Consolidated ${source.length} durable memories from the last ${sinceHours} hours.`,
    entityType: 'memory',
    entityId: memory.id,
    tags: ['ourbook', 'consolidation'],
    metadata: {
      source_ids: source.map((item) => item.id),
      source_count: source.length,
      since_hours: sinceHours,
    },
  });

  return {
    status: 'consolidated' as const,
    consolidation_id: memory.id,
    day: dayKey,
    source_count: source.length,
    source_ids: source.map((item) => item.id),
    content,
  };
}

export async function generateDream(input: DreamInput = {}) {
  const limit = clamp(input.limit ?? 24, 3, 100);
  const seed = input.seed?.trim() || localDayKey(Date.now());
  const candidates = (await listMemories(limit, 0)).filter(
    (memory) => memory.kind !== 'dream' && memory.content.trim().length > 0,
  );

  if (candidates.length < 2) {
    return {
      status: 'not-enough-memories' as const,
      source_count: candidates.length,
    };
  }

  const selected = selectDeterministically(candidates, seed, Math.min(5, candidates.length));
  const content = buildDreamContent(selected, {
    seed,
    ...(input.theme !== undefined ? { theme: input.theme } : {}),
    ...(input.mood !== undefined ? { mood: input.mood } : {}),
  });

  if (input.persist === false) {
    return {
      status: 'generated' as const,
      persisted: false,
      seed,
      source_ids: selected.map((item) => item.id),
      content,
    };
  }

  const memory = await remember({
    content,
    tags: ['ourbook', 'dream', `seed:${shortHash(seed)}`, ...topTags(selected, 4)],
    agent: 'ourbook',
    provider: 'local',
    model: 'dream-engine-v1',
    kind: 'dream',
    confidence: 0.55,
  });

  await addTimelineEvent({
    eventType: 'dream_generated',
    title: 'OurBook dream generated',
    body: `Recombined ${selected.length} memories into a speculative narrative.`,
    entityType: 'memory',
    entityId: memory.id,
    tags: ['ourbook', 'dream'],
    metadata: {
      seed,
      theme: input.theme ?? null,
      mood: input.mood ?? null,
      source_ids: selected.map((item) => item.id),
    },
  });

  return {
    status: 'generated' as const,
    persisted: true,
    dream_id: memory.id,
    seed,
    source_ids: selected.map((item) => item.id),
    content,
  };
}

export function buildConsolidationContent(
  source: MemoryLike[],
  options: { dayKey: string; sinceHours: number },
) {
  const important = [...source]
    .sort((a, b) => b.importance - a.importance || b.created_at - a.created_at)
    .slice(0, 8);
  const tags = topTags(source, 8);

  return [
    `# OurBook Daily Consolidation — ${options.dayKey}`,
    '',
    `Window: last ${options.sinceHours} hours`,
    `Source memories: ${source.length}`,
    tags.length > 0 ? `Themes: ${tags.join(', ')}` : 'Themes: uncategorized',
    '',
    '## What stayed important',
    ...important.map((memory) => `- ${fragment(memory)}`),
    '',
    '## Continuity signal',
    continuitySentence(source),
    '',
    `Source IDs: ${source.map((memory) => memory.id).join(', ')}`,
  ].join('\n');
}

export function buildDreamContent(
  source: MemoryLike[],
  options: { seed: string; theme?: string; mood?: string },
) {
  const theme = options.theme?.trim() || topTags(source, 3).join(', ') || 'shared memory';
  const mood = options.mood?.trim() || 'reflective';
  const fragments = source.map(fragment);
  const bridges = fragments.map((item, index) => {
    const next = fragments[(index + 1) % fragments.length];
    return `- ${item} ↔ ${next}`;
  });

  return [
    '# OurBook Dream',
    '',
    `Seed: ${options.seed}`,
    `Theme: ${theme}`,
    `Mood: ${mood}`,
    '',
    'This is a speculative recombination, not a factual memory.',
    '',
    '## Fragments',
    ...fragments.map((item) => `- ${item}`),
    '',
    '## Unexpected connections',
    ...bridges,
    '',
    '## Story seed',
    `What if ${fragments[0]} became the cause of ${fragments.at(-1)}? Explore that connection while preserving the original memories as separate facts.`,
    '',
    `Source IDs: ${source.map((memory) => memory.id).join(', ')}`,
  ].join('\n');
}

function selectDeterministically<T extends { id: string }>(
  items: T[],
  seed: string,
  count: number,
) {
  return [...items]
    .sort((a, b) => scoreFor(seed, a.id).localeCompare(scoreFor(seed, b.id)))
    .slice(0, count);
}

function scoreFor(seed: string, id: string) {
  return createHash('sha256').update(`${seed}:${id}`).digest('hex');
}

function shortHash(value: string) {
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}

function topTags(memories: MemoryLike[], limit: number) {
  const counts = new Map<string, number>();
  for (const memory of memories) {
    for (const tag of memory.tags) {
      if (tag.startsWith('day:') || tag.startsWith('seed:')) continue;
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([tag]) => tag);
}

function continuitySentence(source: MemoryLike[]) {
  const kinds = [...new Set(source.map((memory) => memory.kind))];
  const tags = topTags(source, 4);
  return `Across ${source.length} memories, the recurring signal is ${tags.length > 0 ? tags.join(', ') : 'continuity across sessions'}; represented as ${kinds.join(', ')} memory kinds.`;
}

function fragment(memory: MemoryLike) {
  const value = (memory.summary ?? memory.content).replace(/\s+/g, ' ').trim();
  return value.length <= MAX_FRAGMENT_CHARS ? value : `${value.slice(0, MAX_FRAGMENT_CHARS - 1)}…`;
}

function localDayKey(timestamp: number) {
  const date = new Date(timestamp);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.trunc(value)));
}
