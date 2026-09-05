import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { SkillTelemetrySnapshot } from './intelligence.js';

export type SkillOutcome = 'success' | 'partial' | 'failure';
interface SkillUsageRecord { runs: number; successes: number; partials: number; failures: number; lastUsedAt?: string; }
interface TelemetryFile { version: 1; skills: Record<string, SkillUsageRecord>; }
const normalizeName = (name: string) => name.trim().toLowerCase();
function snapshot(record?: SkillUsageRecord): SkillTelemetrySnapshot {
  if (!record || record.runs <= 0) return { runs: 0, successes: 0, partials: 0, failures: 0, successRate: 0.5 };
  const rate = (record.successes + (record.partials * 0.5) + 1) / (record.runs + 2);
  return { runs: record.runs, successes: record.successes, partials: record.partials, failures: record.failures, successRate: Math.round(rate * 10000) / 10000 };
}
export class SkillTelemetryStore {
  private data: TelemetryFile = { version: 1, skills: {} };
  private loaded = false;
  private pending: Promise<void> = Promise.resolve();
  constructor(readonly filePath: string) {}
  async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    const raw = await fs.readFile(this.filePath, 'utf8').catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return undefined; throw error; });
    if (raw) { const parsed = JSON.parse(raw) as Partial<TelemetryFile>; if (parsed.version === 1 && parsed.skills && typeof parsed.skills === 'object') this.data = { version: 1, skills: parsed.skills as Record<string, SkillUsageRecord> }; }
    this.loaded = true;
  }
  get(name: string): SkillTelemetrySnapshot { return snapshot(this.data.skills[normalizeName(name)]); }
  snapshotMap(): Map<string, SkillTelemetrySnapshot> { return new Map(Object.entries(this.data.skills).map(([name, record]) => [name, snapshot(record)])); }
  summary() {
    const skills = Object.entries(this.data.skills).map(([name, record]) => ({ name, ...snapshot(record), ...(record.lastUsedAt ? { lastUsedAt: record.lastUsedAt } : {}) }))
      .sort((a, b) => b.runs - a.runs || b.successRate - a.successRate || a.name.localeCompare(b.name));
    return { trackedSkills: skills.length, totalRuns: skills.reduce((sum, item) => sum + item.runs, 0), skills };
  }
  async record(names: string[], outcome: SkillOutcome): Promise<Record<string, SkillTelemetrySnapshot>> {
    let result: Record<string, SkillTelemetrySnapshot> = {};
    const operation = this.pending.then(async () => {
      await this.ensureLoaded(); const now = new Date().toISOString();
      for (const rawName of [...new Set(names.map(normalizeName).filter(Boolean))]) {
        const current = this.data.skills[rawName] ?? { runs: 0, successes: 0, partials: 0, failures: 0 };
        current.runs += 1; if (outcome === 'success') current.successes += 1; else if (outcome === 'partial') current.partials += 1; else current.failures += 1;
        current.lastUsedAt = now; this.data.skills[rawName] = current;
      }
      await this.persist(); result = Object.fromEntries(names.map((name) => [normalizeName(name), this.get(name)]));
    });
    this.pending = operation.then(() => undefined, () => undefined); await operation; return result;
  }
  private async persist(): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
    await fs.writeFile(temporary, `${JSON.stringify(this.data, null, 2)}\n`, 'utf8');
    await fs.rename(temporary, this.filePath);
  }
}
