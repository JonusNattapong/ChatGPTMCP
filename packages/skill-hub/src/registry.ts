import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parseFrontmatter } from './frontmatter.js';
import {
  composeSkillPlan,
  rankSkills,
  routeSkillTask,
  taxonomySummary,
  textRelevance,
  type SkillFamily,
  type SkillTelemetrySnapshot
} from './intelligence.js';
import { SkillTelemetryStore, type SkillOutcome } from './telemetry.js';

export interface SkillSummary {
  name: string;
  description: string;
  directory: string;
  license?: string;
  version?: string;
  author?: string;
}

export interface SkillSearchResult extends SkillSummary { score: number; }
export interface SkillResolveResult extends SkillSummary {
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

const MAX_SKILL_BYTES = 512 * 1024;
const MAX_READ_BYTES = 256 * 1024;
const ALLOWED_TEXT_EXTENSIONS = new Set(['.md', '.txt', '.json', '.yaml', '.yml', '.toml', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.sh', '.ps1']);

export class SkillRegistry {
  private skills = new Map<string, SkillSummary>();
  private lastSyncedAt?: string;
  private readonly telemetry: SkillTelemetryStore;

  constructor(readonly root: string, readonly stateRoot = path.join(path.dirname(root), '.skill-hub')) {
    this.telemetry = new SkillTelemetryStore(path.join(stateRoot, 'usage.json'));
  }

  async sync(): Promise<{ count: number; root: string; syncedAt: string }> {
    const rootStat = await fs.stat(this.root).catch(() => undefined);
    if (!rootStat?.isDirectory()) throw new Error(`Skills root does not exist or is not a directory: ${this.root}`);
    await this.telemetry.ensureLoaded();

    const entries = await fs.readdir(this.root, { withFileTypes: true });
    const next = new Map<string, SkillSummary>();
    await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
      const skillPath = path.join(this.root, entry.name);
      const skillFile = path.join(skillPath, 'SKILL.md');
      const stat = await fs.stat(skillFile).catch(() => undefined);
      if (!stat?.isFile() || stat.size > MAX_SKILL_BYTES) return;
      const markdown = await fs.readFile(skillFile, 'utf8');
      const meta = parseFrontmatter(markdown);
      const name = meta.name?.trim() || entry.name;
      const description = meta.description?.trim() || '';
      next.set(name.toLowerCase(), {
        name,
        description,
        directory: entry.name,
        ...(meta.license ? { license: meta.license } : {}),
        ...(meta.version ? { version: meta.version } : {}),
        ...(meta.author ? { author: meta.author } : {})
      });
    }));

    this.skills = next;
    this.lastSyncedAt = new Date().toISOString();
    return { count: this.skills.size, root: this.root, syncedAt: this.lastSyncedAt };
  }

  async ensureReady(): Promise<void> { if (!this.lastSyncedAt) await this.sync(); }

  list(offset = 0, limit = 50): SkillSummary[] {
    return [...this.skills.values()].sort((a, b) => a.name.localeCompare(b.name)).slice(offset, offset + limit);
  }

  get(name: string): SkillSummary | undefined { return this.skills.get(name.toLowerCase()); }

  search(query: string, limit = 10): SkillSearchResult[] {
    return [...this.skills.values()]
      .map((skill) => ({ ...skill, score: textRelevance(skill, query) }))
      .filter((skill) => skill.score > 0)
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
      .slice(0, limit);
  }

  resolve(task: string, limit = 5): SkillResolveResult[] {
    return rankSkills([...this.skills.values()], task, this.telemetry.snapshotMap(), limit).map(({ skill, ...ranking }) => ({ ...skill, ...ranking }));
  }

  route(task: string, limit = 8) {
    const routed = routeSkillTask([...this.skills.values()], task, this.telemetry.snapshotMap(), limit);
    return {
      task: routed.task,
      families: routed.families,
      recommended: routed.recommended.map(({ skill, ...ranking }) => ({ ...skill, ...ranking }))
    };
  }

  compose(task: string, maxSkills = 4) {
    return composeSkillPlan([...this.skills.values()], task, this.telemetry.snapshotMap(), maxSkills);
  }

  async feedback(names: string[], outcome: SkillOutcome) {
    const unique = [...new Set(names.map((name) => name.trim()).filter(Boolean))];
    const unknown = unique.filter((name) => !this.get(name));
    if (unknown.length) throw new Error(`Unknown skills: ${unknown.join(', ')}`);
    return {
      outcome,
      updated: await this.telemetry.record(unique.map((name) => this.get(name)!.name), outcome)
    };
  }

  insights() {
    return {
      taxonomy: taxonomySummary([...this.skills.values()]),
      telemetry: this.telemetry.summary(),
      stateRoot: this.stateRoot
    };
  }

  stats(): { count: number; root: string; stateRoot: string; lastSyncedAt?: string } {
    return { count: this.skills.size, root: this.root, stateRoot: this.stateRoot, ...(this.lastSyncedAt ? { lastSyncedAt: this.lastSyncedAt } : {}) };
  }

  async read(name: string, relativePath = 'SKILL.md'): Promise<{ skill: SkillSummary; path: string; content: string }> {
    const skill = this.get(name);
    if (!skill) throw new Error(`Unknown skill: ${name}`);
    if (path.isAbsolute(relativePath)) throw new Error('Skill file path must be relative');

    const skillDir = await fs.realpath(path.join(this.root, skill.directory));
    const candidate = path.resolve(skillDir, relativePath);
    const real = await fs.realpath(candidate).catch(() => undefined);
    if (!real) throw new Error(`Skill file not found: ${relativePath}`);
    const prefix = skillDir.endsWith(path.sep) ? skillDir : `${skillDir}${path.sep}`;
    if (real !== skillDir && !real.startsWith(prefix)) throw new Error('Refusing to read outside the selected skill directory');

    const stat = await fs.stat(real);
    if (!stat.isFile()) throw new Error('Requested skill path is not a file');
    if (stat.size > MAX_READ_BYTES) throw new Error(`Skill file exceeds ${MAX_READ_BYTES} bytes`);
    const ext = path.extname(real).toLowerCase();
    if (!ALLOWED_TEXT_EXTENSIONS.has(ext)) throw new Error(`Unsupported skill file type: ${ext || '(none)'}`);

    return { skill, path: path.relative(skillDir, real).replaceAll('\\', '/'), content: await fs.readFile(real, 'utf8') };
  }
}
