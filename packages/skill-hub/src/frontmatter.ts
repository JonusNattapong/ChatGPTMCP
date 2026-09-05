export interface SkillFrontmatter {
  name?: string;
  description?: string;
  license?: string;
  version?: string;
  author?: string;
}

function cleanScalar(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function parseFrontmatter(markdown: string): SkillFrontmatter {
  if (!markdown.startsWith('---')) return {};
  const lines = markdown.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return {};
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (end < 0) return {};

  const result: SkillFrontmatter = {};
  let section: string | undefined;
  for (const raw of lines.slice(1, end)) {
    if (!raw.trim() || raw.trimStart().startsWith('#')) continue;
    const indent = raw.length - raw.trimStart().length;
    const match = raw.trim().match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;
    const [, key, value = ''] = match;
    if (!key) continue;

    if (indent === 0) {
      section = value ? undefined : key;
      if (value) {
        const scalar = cleanScalar(value);
        if (key === 'name') result.name = scalar;
        else if (key === 'description') result.description = scalar;
        else if (key === 'license') result.license = scalar;
      }
      continue;
    }

    if (section === 'metadata' && value) {
      const scalar = cleanScalar(value);
      if (key === 'version') result.version = scalar;
      else if (key === 'author') result.author = scalar;
    }
  }

  return result;
}
