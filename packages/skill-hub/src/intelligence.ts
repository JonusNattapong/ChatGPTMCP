export const SKILL_FAMILIES = ['think', 'design', 'build', 'verify', 'ship', 'grow', 'integrate'] as const;
export type SkillFamily = (typeof SKILL_FAMILIES)[number];

export interface SkillDescriptor { name: string; description: string; }
export interface SkillTelemetrySnapshot {
  runs: number;
  successes: number;
  partials: number;
  failures: number;
  successRate: number;
}
export interface RankedSkill<T extends SkillDescriptor> {
  skill: T;
  score: number;
  textScore: number;
  family: SkillFamily;
  families: SkillFamily[];
  canonical: string;
  aliases: string[];
  core: boolean;
  telemetry: SkillTelemetrySnapshot;
  reasons: string[];
}
export interface DuplicateGroup { canonical: string; aliases: string[]; }

export const DUPLICATE_GROUPS: DuplicateGroup[] = [
  { canonical: 'tdd', aliases: ['test-driven-development'] },
  { canonical: 'diagnosing-bugs', aliases: ['systematic-debugging', 'fix-bug', 'troubleshooting'] },
  { canonical: 'code-review', aliases: ['review-changes', 'requesting-code-review', 'receiving-code-review'] },
  { canonical: 'implement', aliases: ['implement-feature'] },
  { canonical: 'technical-documentation', aliases: ['write-docs'] },
  { canonical: 'research', aliases: ['deep-research'] },
  { canonical: 'frontend-design', aliases: ['design-taste-frontend', 'design-taste-frontend-v1'] }
];

export const CORE_SKILLS = new Set([
  'research', 'grilling', 'domain-modeling', 'to-spec', 'to-tickets',
  'codebase-design', 'adr-authoring', 'improve-codebase-architecture',
  'implement', 'tdd', 'diagnosing-bugs', 'frontend-design', 'databases',
  'code-review', 'qa-methodology', 'playwright', 'verification-before-completion',
  'platform-engineering', 'create-observability', 'technical-documentation',
  'writing-plans', 'executing-plans', 'dispatching-parallel-agents',
  'subagent-driven-development', 'using-git-worktrees'
]);

const EXPLICIT_FAMILY: Record<string, SkillFamily> = {
  research: 'think', grilling: 'think', 'to-tickets': 'think', 'writing-plans': 'think', 'karpathy-guidelines': 'think',
  'domain-modeling': 'design', 'to-spec': 'design', 'codebase-design': 'design', 'adr-authoring': 'design',
  'improve-codebase-architecture': 'design', 'frontend-design': 'design', databases: 'design',
  implement: 'build', 'executing-plans': 'build', 'dispatching-parallel-agents': 'build',
  'subagent-driven-development': 'build', 'using-git-worktrees': 'build',
  tdd: 'verify', 'diagnosing-bugs': 'verify', 'code-review': 'verify', 'qa-methodology': 'verify',
  playwright: 'verify', 'verification-before-completion': 'verify',
  'platform-engineering': 'ship', 'create-observability': 'ship', 'technical-documentation': 'ship'
};

const thai = (...points: number[]) => String.fromCodePoint(...points);

const FAMILY_KEYWORDS: Record<SkillFamily, string[]> = {
  think: ['research', 'brainstorm', 'grill', 'analysis', 'academic', 'summar', 'competitor', 'investigat', 'reason', 'prompt'],
  design: ['design', 'architect', 'domain', 'schema', 'database', 'api', 'adr', 'prototype', 'modeling'],
  build: ['implement', 'coding', 'build', 'refactor', 'tailwind', 'threejs', 'frontend', 'worktree', 'development'],
  verify: ['test', 'review', 'debug', 'audit', 'qa', 'verify', 'accessibility', 'a11y', 'performance', 'troubleshoot', 'lcp'],
  ship: ['deploy', 'platform', 'observability', 'ci', 'release', 'documentation', 'docs', 'production', 'launch'],
  grow: ['marketing', 'seo', 'sales', 'pricing', 'growth', 'cro', 'analytics', 'ads', 'churn', 'referral', 'onboarding'],
  integrate: ['github', 'slack', 'discord', 'notion', 'obsidian', 'trello', 'calendar', 'email', 'spotify', '1password', 'bitwarden', 'firecrawl', 'browser', 'mcp', 'cli']
};

const TASK_KEYWORDS: Record<SkillFamily, string[]> = {
  think: ['research', 'analyze', 'analyse', 'brainstorm', 'investigate', 'compare', 'explore',
    thai(0xe04,0xe49,0xe19), thai(0xe27,0xe34,0xe08,0xe31,0xe22), thai(0xe27,0xe34,0xe40,0xe04,0xe23,0xe32,0xe30,0xe2b,0xe4c), thai(0xe04,0xe34,0xe14), thai(0xe28,0xe36,0xe01,0xe29,0xe32)],
  design: ['design', 'architecture', 'architect', 'model', 'spec', 'schema', 'database', 'api',
    thai(0xe2d,0xe2d,0xe01,0xe41,0xe1a,0xe1a), thai(0xe2a,0xe16,0xe32,0xe1b,0xe31,0xe15,0xe22,0xe01,0xe23,0xe23,0xe21), thai(0xe42,0xe04,0xe23,0xe07,0xe2a,0xe23,0xe49,0xe32,0xe07), thai(0xe2a,0xe40,0xe1b,0xe01)],
  build: ['implement', 'build', 'code', 'feature', 'refactor', 'create', 'fix', 'write',
    thai(0xe41,0xe01,0xe49), thai(0xe2a,0xe23,0xe49,0xe32,0xe07), thai(0xe40,0xe02,0xe35,0xe22,0xe19), thai(0xe25,0xe07,0xe21,0xe37,0xe2d), thai(0xe1e,0xe31,0xe12,0xe19,0xe32)],
  verify: ['test', 'review', 'verify', 'debug', 'audit', 'bug', 'quality', 'check',
    thai(0xe15,0xe23,0xe27,0xe08), thai(0xe17,0xe14,0xe2a,0xe2d,0xe1a), thai(0xe23,0xe35,0xe27,0xe34,0xe27), thai(0xe1a,0xe31,0xe4a,0xe01), thai(0xe04,0xe38,0xe13,0xe20,0xe32,0xe1e)],
  ship: ['deploy', 'release', 'production', 'ci', 'observability', 'document', 'docs', 'ship',
    thai(0xe2a,0xe48,0xe07,0xe21,0xe2d,0xe1a), thai(0xe14,0xe35,0xe1e,0xe25,0xe2d,0xe22), thai(0xe42,0xe1b,0xe23,0xe14,0xe31,0xe01,0xe0a,0xe31,0xe19), thai(0xe40,0xe2d,0xe01,0xe2a,0xe32,0xe23)],
  grow: ['marketing', 'seo', 'pricing', 'launch', 'conversion', 'sales', 'growth', 'analytics',
    thai(0xe15,0xe25,0xe32,0xe14), thai(0xe01,0xe32,0xe23,0xe15,0xe25,0xe32,0xe14), thai(0xe22,0xe2d,0xe14,0xe02,0xe32,0xe22)],
  integrate: ['github', 'slack', 'discord', 'notion', 'obsidian', 'trello', 'calendar', 'email', 'browser', 'firecrawl', 'mcp', 'integration',
    thai(0xe40,0xe0a,0xe37,0xe48,0xe2d,0xe21)]
};

const ROLE_KEYWORDS: Record<string, string[]> = {
  implement: ['implement', 'build', 'fix', 'feature', 'create', thai(0xe41,0xe01,0xe49), thai(0xe2a,0xe23,0xe49,0xe32,0xe07)],
  'diagnosing-bugs': ['bug', 'debug', 'root cause', 'diagnose', thai(0xe1a,0xe31,0xe4a,0xe01), thai(0xe15,0xe23,0xe27,0xe08)],
  'code-review': ['review', 'code review', thai(0xe23,0xe35,0xe27,0xe34,0xe27)],
  tdd: ['test', 'tdd', 'test driven', thai(0xe17,0xe14,0xe2a,0xe2d,0xe1a)],
  'verification-before-completion': ['verify', 'verification', 'check', 'complete', 'completion'],
  research: ['research', 'investigate', 'explore', thai(0xe04,0xe49,0xe19), thai(0xe27,0xe34,0xe08,0xe31,0xe22)],
  'codebase-design': ['architecture', 'codebase design', 'structure', thai(0xe42,0xe04,0xe23,0xe07,0xe2a,0xe23,0xe49,0xe32,0xe07)],
  'domain-modeling': ['domain', 'modeling', 'model'],
  'frontend-design': ['frontend', 'ui', 'ux', 'interface'],
  'platform-engineering': ['deploy', 'platform', 'production', 'infrastructure'],
  'technical-documentation': ['docs', 'documentation', 'document', thai(0xe40,0xe2d,0xe01,0xe2a,0xe32,0xe23)]
};

const EMPTY_TELEMETRY: SkillTelemetrySnapshot = { runs: 0, successes: 0, partials: 0, failures: 0, successRate: 0.5 };
const normalized = (value: string) => value.trim().toLowerCase();
const tokens = (value: string) => [...new Set(normalized(value).split(/[^\p{L}\p{N}_-]+/u).filter(Boolean))];
function containsAny(value: string, terms: string[]): number { let hits = 0; for (const term of terms) if (value.includes(term)) hits += 1; return hits; }

export function canonicalName(name: string): string {
  const needle = normalized(name);
  for (const group of DUPLICATE_GROUPS) if (group.canonical === needle || group.aliases.includes(needle)) return group.canonical;
  return needle;
}
export function aliasesFor(name: string): string[] {
  const group = DUPLICATE_GROUPS.find((candidate) => candidate.canonical === canonicalName(name));
  return group ? [...group.aliases] : [];
}
export function classifySkill(skill: SkillDescriptor): { family: SkillFamily; families: SkillFamily[] } {
  const haystack = normalized(`${skill.name} ${skill.description}`);
  const scored = SKILL_FAMILIES.map((family) => ({ family, score: containsAny(haystack, FAMILY_KEYWORDS[family]) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || SKILL_FAMILIES.indexOf(a.family) - SKILL_FAMILIES.indexOf(b.family));
  const explicit = EXPLICIT_FAMILY[normalized(skill.name)] ?? EXPLICIT_FAMILY[canonicalName(skill.name)];
  if (explicit) return { family: explicit, families: [explicit, ...scored.map((entry) => entry.family).filter((family) => family !== explicit)] };
  if (!scored.length) return { family: 'integrate', families: ['integrate'] };
  return { family: scored[0]!.family, families: scored.map((entry) => entry.family) };
}
export function inferTaskFamilies(task: string): Array<{ family: SkillFamily; score: number }> {
  const haystack = normalized(task);
  const scores = new Map<SkillFamily, number>();
  for (const family of SKILL_FAMILIES) {
    const hits = containsAny(haystack, TASK_KEYWORDS[family]);
    if (hits) scores.set(family, hits * 12);
  }
  const softwareTask = containsAny(haystack, ['code', 'repo', 'project', 'feature', 'bug', 'codebase']) > 0;
  if (softwareTask && !scores.has('build') && !scores.has('verify')) scores.set('build', 8);
  if (scores.has('build') && !scores.has('verify')) scores.set('verify', 7);
  if (haystack.includes('fix') || haystack.includes(thai(0xe41,0xe01,0xe49))) {
    scores.set('build', Math.max(scores.get('build') ?? 0, 12));
    scores.set('verify', Math.max(scores.get('verify') ?? 0, 12));
  }
  if (!scores.size) scores.set('think', 6);
  return [...scores.entries()].map(([family, score]) => ({ family, score }))
    .sort((a, b) => b.score - a.score || SKILL_FAMILIES.indexOf(a.family) - SKILL_FAMILIES.indexOf(b.family));
}
export function textRelevance(skill: SkillDescriptor, query: string): number {
  const q = normalized(query); if (!q) return 0;
  const name = normalized(skill.name); const description = normalized(skill.description); let score = 0;
  if (name === q) score += 100; if (name.startsWith(q)) score += 45; if (name.includes(q)) score += 30; if (description.includes(q)) score += 18;
  for (const token of tokens(q)) { if (name === token) score += 25; else if (name.includes(token)) score += 14; if (description.includes(token)) score += 6; }
  return score;
}
function telemetryBonus(usage: SkillTelemetrySnapshot): number {
  if (!usage.runs) return 0;
  return (usage.successRate - 0.5) * 24 * Math.min(1, usage.runs / 8);
}
export function rankSkills<T extends SkillDescriptor>(skills: T[], task: string, telemetry: ReadonlyMap<string, SkillTelemetrySnapshot>, limit = 5): RankedSkill<T>[] {
  const familySignals = new Map(inferTaskFamilies(task).map((entry) => [entry.family, entry.score]));
  const installed = new Set(skills.map((skill) => normalized(skill.name)));
  const ranked = skills.map((skill) => {
    const classification = classifySkill(skill); const textScore = textRelevance(skill, task); const canonical = canonicalName(skill.name);
    const familyScore = Math.max(...classification.families.map((family) => familySignals.get(family) ?? 0), 0);
    const core = CORE_SKILLS.has(normalized(skill.name)); const usage = telemetry.get(normalized(skill.name)) ?? EMPTY_TELEMETRY;
    const canonicalBonus = normalized(skill.name) === canonical ? 10 : installed.has(canonical) ? -6 : 2;
    const roleHits = containsAny(normalized(task), ROLE_KEYWORDS[canonical] ?? []);
    const roleScore = roleHits * 30;
    const score = textScore + familyScore + roleScore + canonicalBonus + (core ? 4 : 0) + telemetryBonus(usage);
    const reasons: string[] = [];
    if (textScore > 0) reasons.push('text-match'); if (familyScore > 0) reasons.push(`family:${classification.family}`); if (roleScore > 0) reasons.push(`role:${canonical}`); if (core) reasons.push('core-skill');
    if (canonicalBonus > 0) reasons.push('canonical-preference'); if (usage.runs > 0) reasons.push(`success:${Math.round(usage.successRate * 100)}%/${usage.runs}`);
    return { skill, score: Math.round(score * 100) / 100, textScore, family: classification.family, families: classification.families, canonical, aliases: aliasesFor(skill.name), core, telemetry: usage, reasons };
  }).filter((entry) => entry.score > 0);
  const deduped = new Map<string, RankedSkill<T>>();
  for (const candidate of ranked) { const previous = deduped.get(candidate.canonical); if (!previous || candidate.score > previous.score) deduped.set(candidate.canonical, candidate); }
  return [...deduped.values()].sort((a, b) => b.score - a.score || a.skill.name.localeCompare(b.skill.name)).slice(0, limit);
}
export function routeSkillTask<T extends SkillDescriptor>(skills: T[], task: string, telemetry: ReadonlyMap<string, SkillTelemetrySnapshot>, limit = 8) {
  return { task, families: inferTaskFamilies(task), recommended: rankSkills(skills, task, telemetry, limit) };
}
export function composeSkillPlan<T extends SkillDescriptor>(skills: T[], task: string, telemetry: ReadonlyMap<string, SkillTelemetrySnapshot>, maxSkills = 4) {
  const routed = routeSkillTask(skills, task, telemetry, Math.max(40, maxSkills * 12));
  const selected: Array<{ entry: RankedSkill<T>; stageFamily: SkillFamily }> = [];
  const used = new Set<string>();
  const taskText = normalized(task);
  const rolePipeline = ['research', 'codebase-design', 'diagnosing-bugs', 'implement', 'tdd', 'code-review', 'verification-before-completion', 'technical-documentation', 'platform-engineering'];

  for (const canonical of rolePipeline) {
    if (selected.length >= maxSkills) break;
    const keywords = ROLE_KEYWORDS[canonical] ?? [];
    if (!containsAny(taskText, keywords)) continue;
    const candidates = skills.filter((skill) => canonicalName(skill.name) === canonical);
    const candidate = rankSkills(candidates, task, telemetry, 1)[0];
    if (!candidate || used.has(candidate.canonical)) continue;
    selected.push({ entry: candidate, stageFamily: candidate.family });
    used.add(candidate.canonical);
  }

  if (!selected.length) {
    const requested = new Set(routed.families.map((entry) => entry.family));
    for (const family of SKILL_FAMILIES.filter((candidate) => requested.has(candidate))) {
      const candidate = routed.recommended.find((entry) => entry.family === family && !used.has(entry.canonical))
        ?? routed.recommended.find((entry) => entry.families.includes(family) && !used.has(entry.canonical));
      if (!candidate) continue;
      selected.push({ entry: candidate, stageFamily: family });
      used.add(candidate.canonical);
      if (selected.length >= maxSkills) break;
    }
  }

  return { task, families: routed.families, stages: selected.map(({ entry, stageFamily }, index) => ({ order: index + 1, family: stageFamily, skill: entry.skill, canonical: entry.canonical, score: entry.score, reasons: entry.reasons })) };
}
export function taxonomySummary<T extends SkillDescriptor>(skills: T[]) {
  const counts = Object.fromEntries(SKILL_FAMILIES.map((family) => [family, 0])) as Record<SkillFamily, number>;
  for (const skill of skills) counts[classifySkill(skill).family] += 1;
  const names = new Set(skills.map((skill) => normalized(skill.name)));
  const duplicateGroups = DUPLICATE_GROUPS.map((group) => ({ canonical: group.canonical, installed: [group.canonical, ...group.aliases].filter((name) => names.has(name)) })).filter((group) => group.installed.length > 1);
  return { total: skills.length, families: counts, coreInstalled: [...CORE_SKILLS].filter((name) => names.has(name)).sort(), coreMissing: [...CORE_SKILLS].filter((name) => !names.has(name)).sort(), duplicateGroups };
}
