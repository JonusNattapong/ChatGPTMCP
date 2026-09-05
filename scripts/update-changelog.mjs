#!/usr/bin/env node

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

function getGitCommits() {
  try {
    // Get tags sorted by date
    let lastTag = '';
    try {
      lastTag = execSync('git describe --tags --abbrev=0', { encoding: 'utf8' }).trim();
    } catch {
      // No tags yet
    }

    const range = lastTag ? `${lastTag}..HEAD` : 'HEAD';
    const logOutput = execSync(`git log ${range} --pretty=format:"%H|%s|%an|%ad" --date=short`, {
      encoding: 'utf8',
    }).trim();

    if (!logOutput) return [];

    return logOutput.split('\n').map((line) => {
      const [hash, subject, author, date] = line.split('|');
      return { hash: hash?.trim(), subject: subject?.trim(), author: author?.trim(), date: date?.trim() };
    });
  } catch (error) {
    console.error('Failed to get git log:', error);
    return [];
  }
}

function parseCommit(subject = '') {
  const match = subject.match(/^([a-zA-Z0-9_-]+)(?:\(([^)]+)\))?:\s*(.+)$/);
  if (!match) {
    return { type: 'other', scope: '', message: subject };
  }
  return {
    type: match[1].toLowerCase(),
    scope: match[2] || '',
    message: match[3],
  };
}

function generateChangelogSection(version, date, commits) {
  const categories = {
    feat: { title: '✨ Features', items: [] },
    fix: { title: '🐛 Bug Fixes', items: [] },
    docs: { title: '📚 Documentation', items: [] },
    refactor: { title: '♻️ Refactoring & Performance', items: [] },
    test: { title: '🧪 Testing & Verification', items: [] },
    ci: { title: '⚙️ CI/CD & Tooling', items: [] },
    chore: { title: '🧹 Chores & Maintenance', items: [] },
    other: { title: '🔨 Other Changes', items: [] },
  };

  for (const c of commits) {
    const parsed = parseCommit(c.subject);
    const target = categories[parsed.type] || categories.other;
    const scopePrefix = parsed.scope ? `**${parsed.scope}**: ` : '';
    const shortHash = c.hash ? ` (\`${c.hash.slice(0, 7)}\`)` : '';
    target.items.push(`- ${scopePrefix}${parsed.message}${shortHash}`);
  }

  let section = `## [${version}] - ${date}\n\n`;

  let hasEntries = false;
  for (const key of Object.keys(categories)) {
    const cat = categories[key];
    if (cat.items.length > 0) {
      hasEntries = true;
      section += `### ${cat.title}\n\n${cat.items.join('\n')}\n\n`;
    }
  }

  if (!hasEntries) {
    section += `- Maintenance and internal stability updates.\n\n`;
  }

  return section;
}

export function updateChangelog(newVersion) {
  const pkgPath = path.resolve('package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  const version = newVersion || pkg.version || '1.0.0';
  const today = new Date().toISOString().split('T')[0];

  const commits = getGitCommits();
  if (commits.length === 0) {
    console.log('No new commits found to generate changelog.');
    return;
  }

  const changelogPath = path.resolve('CHANGELOG.md');
  const currentContent = existsSync(changelogPath) ? readFileSync(changelogPath, 'utf8') : '';

  const newSection = generateChangelogSection(version, today, commits);

  // If header exists, inject after header
  let updatedContent = '';
  const headerMarker = '# Changelog\n\nAll notable changes to `chatgpt-pilot` are documented in this file.\n\nThe format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),\nand this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).\n\n---\n\n';

  if (currentContent.startsWith('# Changelog')) {
    const afterHeader = currentContent.replace(/^# Changelog[\s\S]*?---\n\n/, '');
    updatedContent = headerMarker + newSection + afterHeader;
  } else {
    updatedContent = headerMarker + newSection + currentContent;
  }

  writeFileSync(changelogPath, updatedContent, 'utf8');
  console.log(`[Changelog] Successfully updated CHANGELOG.md for version ${version} (${today}) with ${commits.length} commits.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))) {
  const versionArg = process.argv[2];
  updateChangelog(versionArg);
}
