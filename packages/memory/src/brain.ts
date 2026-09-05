import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, unlinkSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

export interface TopicSection {
  title: string;
  level: number;
  content: string;
  subsections: TopicSection[];
}

export interface DrawerItem {
  drawer: string;
  name: string;
  filename: string;
  filePath: string;
  title: string;
  tags?: string[];
  lastModified: string;
}

export interface DrawerSummary {
  name: string;
  itemCount: number;
  items: DrawerItem[];
}

export interface MemoryStats {
  storageDir: string;
  chaptersCount: number;
  timestepsCount: number;
  drawersCount: number;
  drawerItemsCount: number;
  totalWords: number;
  totalBytes: number;
  lastUpdated: string;
}

export class BrainBook {
  readonly rootDir: string;
  readonly chaptersDir: string;
  readonly timestepsDir: string;
  readonly drawersDir: string;

  constructor(customDir?: string) {
    if (customDir) {
      this.rootDir = path.resolve(customDir);
    } else if (process.env.PILOT_MEMORY_DIR) {
      this.rootDir = path.resolve(process.env.PILOT_MEMORY_DIR);
    } else {
      // Default to workspace .pilot/memory or home ~/.pilot/memory
      const workspaceDir = path.resolve(process.cwd(), '.pilot', 'memory');
      const homeDir = path.join(os.homedir(), '.pilot', 'memory');
      this.rootDir = existsSync(path.resolve(process.cwd(), '.pilot')) ? workspaceDir : homeDir;
    }

    this.chaptersDir = path.join(this.rootDir, 'chapters');
    this.timestepsDir = path.join(this.rootDir, 'timesteps');
    this.drawersDir = path.join(this.rootDir, 'drawers');
    this.ensureLayout();
  }

  private ensureLayout(): void {
    mkdirSync(this.chaptersDir, { recursive: true });
    mkdirSync(this.timestepsDir, { recursive: true });
    mkdirSync(this.drawersDir, { recursive: true });

    const tocPath = path.join(this.rootDir, 'TOC.md');
    if (!existsSync(tocPath)) {
      this.seedFromBackup();
    } else if (readdirSync(this.drawersDir).length === 0) {
      this.seedDrawers();
    }
  }

  /**
   * Seeds default memory drawers (cheatsheets, lessons, drafts, projects)
   * from bundled templates if the drawers directory is empty.
   */
  public seedDrawers(customSource?: string): void {
    const bundledSeed = path.resolve(moduleDir, '..', 'seed', 'drawers');
    const source = customSource && existsSync(customSource)
      ? customSource
      : existsSync(bundledSeed)
        ? bundledSeed
        : '';

    if (!source || !existsSync(source)) return;

    for (const drawerName of readdirSync(source)) {
      const srcDrawerPath = path.join(source, drawerName);
      if (statSync(srcDrawerPath).isDirectory()) {
        const dstDrawerPath = path.join(this.drawersDir, drawerName);
        mkdirSync(dstDrawerPath, { recursive: true });
        for (const file of readdirSync(srcDrawerPath).filter((f: string) => f.endsWith('.md'))) {
          const dstFile = path.join(dstDrawerPath, file);
          if (!existsSync(dstFile)) {
            const content = readFileSync(path.join(srcDrawerPath, file), 'utf8');
            writeFileSync(dstFile, content, 'utf8');
          }
        }
      }
    }
    this.rebuildTOC();
    this.rebuildSummary();
  }

  /**
   * Automatically seeds the brain book from D:\Projects\Github\chatgpt-memory-backup
   * if available, or creates starter template files.
   */
  public seedFromBackup(backupPath = 'D:\\Projects\\Github\\chatgpt-memory-backup'): void {
    console.log(`[BrainBook] Initializing Markdown Living Memory Book at ${this.rootDir}...`);

    // Priority 1: External backup directory
    // Priority 2: Bundled seed directory in packages/memory/seed
    let sourcePath = existsSync(backupPath) ? backupPath : '';
    if (!sourcePath) {
      const bundledSeed = path.resolve(moduleDir, '..', 'seed');
      if (existsSync(bundledSeed)) {
        sourcePath = bundledSeed;
      }
    }

    if (sourcePath) {
      try {
        const memFile = existsSync(path.join(sourcePath, 'MEMORY.md'))
          ? path.join(sourcePath, 'MEMORY.md')
          : path.join(sourcePath, '01-identity.md');
        const projFile = existsSync(path.join(sourcePath, 'PROJECTS.md'))
          ? path.join(sourcePath, 'PROJECTS.md')
          : path.join(sourcePath, '02-projects.md');
        const archFile = existsSync(path.join(sourcePath, 'TECHNICAL_NOTES.md'))
          ? path.join(sourcePath, 'TECHNICAL_NOTES.md')
          : path.join(sourcePath, '03-architecture.md');
        const timeFile = existsSync(path.join(sourcePath, 'TIMELINE.md'))
          ? path.join(sourcePath, 'TIMELINE.md')
          : path.join(sourcePath, '04-timeline.md');

        if (existsSync(memFile)) {
          writeFileSync(path.join(this.chaptersDir, '01-identity.md'), readFileSync(memFile, 'utf8'), 'utf8');
        }
        if (existsSync(projFile)) {
          writeFileSync(path.join(this.chaptersDir, '02-projects.md'), readFileSync(projFile, 'utf8'), 'utf8');
        }
        if (existsSync(archFile)) {
          writeFileSync(path.join(this.chaptersDir, '03-architecture.md'), readFileSync(archFile, 'utf8'), 'utf8');
        }
        if (existsSync(timeFile)) {
          const timelineContent = readFileSync(timeFile, 'utf8');
          writeFileSync(path.join(this.chaptersDir, '04-timeline.md'), timelineContent, 'utf8');
          this.parseTimestepsFromTimeline(timelineContent);
        }

        // Seed drawers if available in source
        const drawersSource = path.join(sourcePath, 'drawers');
        if (existsSync(drawersSource)) {
          for (const drawerName of readdirSync(drawersSource)) {
            const srcDrawerPath = path.join(drawersSource, drawerName);
            if (statSync(srcDrawerPath).isDirectory()) {
              const dstDrawerPath = path.join(this.drawersDir, drawerName);
              mkdirSync(dstDrawerPath, { recursive: true });
              for (const file of readdirSync(srcDrawerPath).filter((f: string) => f.endsWith('.md'))) {
                const content = readFileSync(path.join(srcDrawerPath, file), 'utf8');
                writeFileSync(path.join(dstDrawerPath, file), content, 'utf8');
              }
            }
          }
        }
      } catch (err) {
        console.error('[BrainBook] Error reading backup files:', err);
      }
    }

    this.rebuildTOC();
    this.rebuildSummary();
  }

  private parseTimestepsFromTimeline(timelineText: string): void {
    const lines = timelineText.split('\n');
    let currentTimestep: string | null = null;
    let currentBuffer: string[] = [];

    const flush = () => {
      if (currentTimestep && currentBuffer.length > 0) {
        const safeName = currentTimestep.replace(/[^0-9A-Za-z_-]/g, '-');
        const filePath = path.join(this.timestepsDir, `${safeName}.md`);
        writeFileSync(filePath, `# Timestep: ${currentTimestep}\n\n` + currentBuffer.join('\n').trim() + '\n', 'utf8');
      }
    };

    for (const line of lines) {
      const match = line.match(/- (\d{4}-\d{2}-\d{2}):\s*(.*)/) || line.match(/## ([A-Za-z]+ \d{4})/);
      if (match) {
        flush();
        currentTimestep = match[1];
        currentBuffer = [line];
      } else if (currentTimestep) {
        currentBuffer.push(line);
      }
    }
    flush();
  }

  public rebuildTOC(): string {
    const chapters = this.listChapters();
    const timesteps = this.listTimesteps();

    let toc = `# 📚 Brain Book: Master Table of Contents (สารบัญ)\n\n`;
    toc += `> Living Memory Book for ChatGPT Pilot — Structured, Human-Readable, and Chronologically Indexed.\n\n`;
    toc += `## 📖 Chapters & Main Topics (หมวดหมู่หลัก)\n\n`;

    for (const ch of chapters) {
      toc += `### [Chapter: ${ch.title}](file:///${ch.filePath.replace(/\\/g, '/')})\n`;
      toc += `- **File**: \`${ch.filename}\`\n`;
      if (ch.subtopics.length > 0) {
        toc += `- **Subtopics (หัวข้อย่อย)**:\n`;
        for (const sub of ch.subtopics.slice(0, 15)) {
          toc += `  - ${sub}\n`;
        }
        if (ch.subtopics.length > 15) {
          toc += `  - *...and ${ch.subtopics.length - 15} more subtopics*\n`;
        }
      }
      toc += `\n`;
    }

    toc += `## ⏳ Chronological Timesteps (ดัชนีเวลา/บันทึกความจำตามช่วงเวลา)\n\n`;
    for (const t of timesteps) {
      toc += `- **\`${t.name}\`**: [View Entry](file:///${t.filePath.replace(/\\/g, '/')})\n`;
    }
    toc += `\n`;

    const drawers = this.listDrawers();
    if (drawers.length > 0) {
      toc += `## 🗄️ Memory Drawers (ตู้ลิ้นชักความจำเฉพาะกิจ)\n\n`;
      for (const d of drawers) {
        toc += `### 📁 Drawer: \`${d.name}\` (${d.itemCount} items)\n`;
        for (const item of d.items) {
          const tagsStr = item.tags && item.tags.length > 0 ? ` *[${item.tags.join(', ')}]*` : '';
          toc += `- **[${item.title}](file:///${item.filePath.replace(/\\/g, '/')})** (\`${item.name}\`)${tagsStr}\n`;
        }
        toc += `\n`;
      }
    }

    const tocPath = path.join(this.rootDir, 'TOC.md');
    writeFileSync(tocPath, toc, 'utf8');
    return toc;
  }

  public rebuildSummary(): string {
    const chapters = this.listChapters();
    const drawers = this.listDrawers();
    let summary = `# 📖 Executive Summary: Living Memory Book\n\n`;
    summary += `Snapshot of core architectural knowledge, developer identity, and system milestones:\n\n`;

    for (const ch of chapters) {
      summary += `### ${ch.title}\n`;
      const preview = ch.content.split('\n').filter(l => l.trim() && !l.startsWith('#')).slice(0, 4).join('\n');
      summary += `${preview}\n\n`;
    }

    if (drawers.length > 0) {
      summary += `### 🗄️ Memory Drawers (ตู้ลิ้นชักความจำ)\n`;
      for (const d of drawers) {
        summary += `- **\`${d.name}\`** (${d.itemCount} items): ${d.items.map(i => i.name).join(', ')}\n`;
      }
      summary += `\n`;
    }

    const summaryPath = path.join(this.rootDir, 'SUMMARY.md');
    writeFileSync(summaryPath, summary, 'utf8');
    return summary;
  }

  public listChapters(): Array<{ filename: string; title: string; filePath: string; subtopics: string[]; content: string }> {
    if (!existsSync(this.chaptersDir)) return [];
    return readdirSync(this.chaptersDir)
      .filter((f: string) => f.endsWith('.md'))
      .sort()
      .map((filename: string) => {
        const filePath = path.join(this.chaptersDir, filename);
        const content = readFileSync(filePath, 'utf8');
        const titleMatch = content.match(/^#\s+(.+)$/m);
        const title = titleMatch ? titleMatch[1] : filename.replace(/\.md$/, '');
        const subtopicMatches = [...content.matchAll(/^#{2,3}\s+(.+)$/gm)].map((m) => m[1]);
        return { filename, title, filePath, subtopics: subtopicMatches, content };
      });
  }

  public listTimesteps(): Array<{ name: string; filename: string; filePath: string }> {
    if (!existsSync(this.timestepsDir)) return [];
    return readdirSync(this.timestepsDir)
      .filter((f: string) => f.endsWith('.md'))
      .sort()
      .reverse()
      .map((filename: string) => ({
        name: filename.replace(/\.md$/, ''),
        filename,
        filePath: path.join(this.timestepsDir, filename),
      }));
  }

  public listDrawers(drawerFilter?: string): DrawerSummary[] {
    if (!existsSync(this.drawersDir)) return [];
    const filter = drawerFilter?.trim().toLowerCase();
    const dirs = readdirSync(this.drawersDir)
      .filter((d: string) => {
        const full = path.join(this.drawersDir, d);
        return statSync(full).isDirectory() && (!filter || d.toLowerCase().includes(filter));
      })
      .sort();

    return dirs.map((drawerName: string) => {
      const drawerPath = path.join(this.drawersDir, drawerName);
      const files = readdirSync(drawerPath)
        .filter((f: string) => f.endsWith('.md'))
        .sort();

      const items: DrawerItem[] = files.map((filename: string) => {
        const filePath = path.join(drawerPath, filename);
        const content = readFileSync(filePath, 'utf8');
        const titleMatch = content.match(/^#\s+(.+)$/m);
        const title = titleMatch ? titleMatch[1].trim() : filename.replace(/\.md$/, '');
        const tagsMatch = content.match(/\*Tags:\s*([^*]+)\*/i);
        const tags = tagsMatch ? tagsMatch[1].split(',').map((t) => t.trim()).filter(Boolean) : undefined;
        const stat = statSync(filePath);

        return {
          drawer: drawerName,
          name: filename.replace(/\.md$/, ''),
          filename,
          filePath,
          title,
          tags,
          lastModified: stat.mtime.toISOString(),
        };
      });

      return {
        name: drawerName,
        itemCount: items.length,
        items,
      };
    });
  }

  public readDrawerItem(drawer: string, item: string): string {
    const safeDrawer = drawer.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    const safeItem = item.toLowerCase().replace(/\.md$/, '').replace(/[^a-z0-9_-]/g, '-');
    const drawerPath = path.join(this.drawersDir, safeDrawer);

    if (!existsSync(drawerPath)) {
      const available = this.listDrawers().map((d) => d.name);
      return `Drawer "${drawer}" does not exist. Available drawers: ${available.join(', ') || 'none'}`;
    }

    const filePath = path.join(drawerPath, `${safeItem}.md`);
    if (!existsSync(filePath)) {
      const availableItems = readdirSync(drawerPath).filter((f: string) => f.endsWith('.md')).map((f: string) => f.replace(/\.md$/, ''));
      return `Item "${item}" not found in drawer "${drawer}". Available items: ${availableItems.join(', ') || 'none'}`;
    }

    return readFileSync(filePath, 'utf8');
  }

  public putDrawerItem(
    drawer: string,
    item: string,
    content: string,
    metadata?: { title?: string; tags?: string[] }
  ): { ok: boolean; filePath: string; message: string } {
    const safeDrawer = drawer.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    const safeItem = item.toLowerCase().replace(/\.md$/, '').replace(/[^a-z0-9_-]/g, '-');
    const drawerPath = path.join(this.drawersDir, safeDrawer);
    mkdirSync(drawerPath, { recursive: true });

    const filePath = path.join(drawerPath, `${safeItem}.md`);
    const title = metadata?.title || safeItem.replace(/-/g, ' ');
    const tagsLine = metadata?.tags && metadata.tags.length > 0 ? `\n*Tags: ${metadata.tags.join(', ')}*\n` : '';

    let fullText = content.trim();
    if (!fullText.startsWith('#')) {
      fullText = `# ${title}\n${tagsLine}\n${fullText}\n`;
    } else if (tagsLine && !fullText.includes('*Tags:')) {
      const firstLineEnd = fullText.indexOf('\n');
      if (firstLineEnd > 0) {
        fullText = fullText.slice(0, firstLineEnd) + tagsLine + fullText.slice(firstLineEnd);
      }
    }

    writeFileSync(filePath, fullText, 'utf8');
    this.rebuildTOC();
    this.rebuildSummary();

    return {
      ok: true,
      filePath,
      message: `Saved item "${safeItem}" into drawer "${safeDrawer}". Table of Contents updated.`,
    };
  }

  public deleteDrawerItem(drawer: string, item: string): { ok: boolean; message: string } {
    const safeDrawer = drawer.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    const safeItem = item.toLowerCase().replace(/\.md$/, '').replace(/[^a-z0-9_-]/g, '-');
    const filePath = path.join(this.drawersDir, safeDrawer, `${safeItem}.md`);

    if (!existsSync(filePath)) {
      return { ok: false, message: `Item "${item}" not found in drawer "${drawer}".` };
    }

    unlinkSync(filePath);
    const drawerPath = path.join(this.drawersDir, safeDrawer);
    const remaining = readdirSync(drawerPath).filter((f: string) => f.endsWith('.md'));
    if (remaining.length === 0) {
      rmSync(drawerPath, { recursive: true, force: true });
    }

    this.rebuildTOC();
    this.rebuildSummary();
    return { ok: true, message: `Deleted item "${safeItem}" from drawer "${safeDrawer}".` };
  }

  public getTOC(filter?: string): string {
    const tocPath = path.join(this.rootDir, 'TOC.md');
    if (existsSync(tocPath)) {
      const full = readFileSync(tocPath, 'utf8');
      if (!filter) return full;
      const regex = new RegExp(`### \\[Chapter: [^\\]]*${filter}[^\\]]*\\][\\s\\S]*?(?=### \\[Chapter:|## ⏳|$)`, 'i');
      const match = full.match(regex);
      return match ? match[0] : full;
    }
    return this.rebuildTOC();
  }

  public getSummary(topic?: string): string {
    if (topic) {
      return this.readTopic(topic);
    }
    const summaryPath = path.join(this.rootDir, 'SUMMARY.md');
    if (existsSync(summaryPath)) {
      return readFileSync(summaryPath, 'utf8');
    }
    return this.rebuildSummary();
  }

  public readTopic(topicName: string, subtopic?: string): string {
    const chapters = this.listChapters();
    const query = topicName.toLowerCase().trim();

    if (query === 'toc' || query === 'table_of_contents' || query === 'สารบัญ') {
      return this.getTOC(subtopic);
    }
    if (query === 'summary' || query === 'overview' || query === 'สรุป') {
      return this.getSummary(subtopic);
    }

    const chapter = chapters.find(
      (c) =>
        c.filename.toLowerCase().includes(query) ||
        c.title.toLowerCase().includes(query) ||
        query.includes(c.filename.replace(/\.md$/, '').toLowerCase())
    );

    if (!chapter) {
      // Check drawers
      if (query.startsWith('drawer:') || query.startsWith('drawers/')) {
        const dName = query.replace(/^drawers?[/:]/, '');
        return subtopic ? this.readDrawerItem(dName, subtopic) : this.readTopic(dName, subtopic);
      }

      const drawer = this.listDrawers().find((d) => d.name.toLowerCase() === query);
      if (drawer) {
        if (subtopic) {
          return this.readDrawerItem(drawer.name, subtopic);
        }
        return (
          `# Drawer: ${drawer.name} (${drawer.itemCount} items)\n\n` +
          drawer.items.map((i) => `- **[${i.title}]** (\`${i.name}\`)${i.tags ? ` *[${i.tags.join(', ')}]*` : ''}`).join('\n')
        );
      }

      // Check timesteps
      const timesteps = this.listTimesteps();
      const ts = timesteps.find((t) => t.name.toLowerCase().includes(query));
      if (ts) {
        return readFileSync(ts.filePath, 'utf8');
      }
      const availableDrawers = this.listDrawers().map((d) => d.name);
      return `Topic, Chapter, or Drawer "${topicName}" not found. Available chapters: ${chapters.map((c) => c.title).join(', ')}. Available drawers: ${availableDrawers.join(', ')}`;
    }

    if (!subtopic) {
      return chapter.content;
    }

    // Extract subtopic section
    const subQuery = subtopic.toLowerCase().trim();
    const lines = chapter.content.split('\n');
    let capturing = false;
    let captureLevel = 0;
    const resultLines: string[] = [];

    for (const line of lines) {
      const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
      if (headingMatch) {
        const level = headingMatch[1].length;
        const headingText = headingMatch[2].toLowerCase();

        if (capturing) {
          if (level <= captureLevel) break; // Reached next sibling or parent section
          resultLines.push(line);
        } else if (headingText.includes(subQuery)) {
          capturing = true;
          captureLevel = level;
          resultLines.push(line);
        }
      } else if (capturing) {
        resultLines.push(line);
      }
    }

    return resultLines.length > 0
      ? resultLines.join('\n')
      : `Subtopic "${subtopic}" not found in ${chapter.title}. Available subtopics: ${chapter.subtopics.join(', ')}`;
  }

  public recallTime(timestepQuery: string): string {
    const timesteps = this.listTimesteps();
    const query = timestepQuery.trim().toLowerCase();

    if (query === 'latest' || query === 'recent') {
      const top = timesteps.slice(0, 5);
      return top.map((t) => readFileSync(t.filePath, 'utf8')).join('\n\n---\n\n');
    }

    const matched = timesteps.filter((t) => t.name.toLowerCase().includes(query));
    if (matched.length === 0) {
      return `No memory events found for timestep: "${timestepQuery}". Available timesteps: ${timesteps.slice(0, 10).map((t) => t.name).join(', ')}...`;
    }

    return matched.map((t) => readFileSync(t.filePath, 'utf8')).join('\n\n---\n\n');
  }

  public search(query: string, limit = 5): Array<{ file: string; title: string; snippet: string }> {
    const q = query.toLowerCase();
    const chapters = this.listChapters();
    const timesteps = this.listTimesteps();
    const results: Array<{ file: string; title: string; snippet: string }> = [];

    for (const ch of chapters) {
      if (ch.content.toLowerCase().includes(q)) {
        const lines = ch.content.split('\n');
        const matchLine = lines.find((l: string) => l.toLowerCase().includes(q)) ?? '';
        results.push({
          file: ch.filename,
          title: ch.title,
          snippet: matchLine.trim().slice(0, 300),
        });
        if (results.length >= limit) return results;
      }
    }

    for (const t of timesteps) {
      const content = readFileSync(t.filePath, 'utf8');
      if (content.toLowerCase().includes(q)) {
        const lines = content.split('\n');
        const matchLine = lines.find((l: string) => l.toLowerCase().includes(q)) ?? '';
        results.push({
          file: t.filename,
          title: `Timestep: ${t.name}`,
          snippet: matchLine.trim().slice(0, 300),
        });
        if (results.length >= limit) return results;
      }
    }

    const drawers = this.listDrawers();
    for (const d of drawers) {
      for (const item of d.items) {
        const content = readFileSync(item.filePath, 'utf8');
        if (content.toLowerCase().includes(q)) {
          const lines = content.split('\n');
          const matchLine = lines.find((l: string) => l.toLowerCase().includes(q)) ?? '';
          results.push({
            file: `drawers/${d.name}/${item.filename}`,
            title: `[Drawer: ${d.name}] ${item.title}`,
            snippet: matchLine.trim().slice(0, 300),
          });
          if (results.length >= limit) return results;
        }
      }
    }

    return results;
  }

  public remember(input: {
    title: string;
    content: string;
    chapter?: string;
    timestep?: string;
    tags?: string[];
  }): { ok: boolean; timestepFile: string; message: string } {
    const dateStr = input.timestep || new Date().toISOString().split('T')[0];
    const safeDate = dateStr.replace(/[^0-9A-Za-z_-]/g, '-');
    const tsFile = path.join(this.timestepsDir, `${safeDate}.md`);

    const header = `\n\n### [${new Date().toISOString()}] ${input.title}\n`;
    const tagsLine = input.tags && input.tags.length > 0 ? `*Tags: ${input.tags.join(', ')}*\n\n` : '\n';
    const entry = header + tagsLine + input.content + '\n';

    if (existsSync(tsFile)) {
      const prev = readFileSync(tsFile, 'utf8');
      writeFileSync(tsFile, prev + entry, 'utf8');
    } else {
      writeFileSync(tsFile, `# Timestep: ${dateStr}\n` + entry, 'utf8');
    }

    // Append to chapter if specified
    if (input.chapter) {
      const chapters = this.listChapters();
      const target = chapters.find((c) => c.filename.includes(input.chapter!) || c.title.toLowerCase().includes(input.chapter!.toLowerCase()));
      if (target) {
        writeFileSync(target.filePath, target.content + entry, 'utf8');
      }
    }

    this.rebuildTOC();
    this.rebuildSummary();

    return {
      ok: true,
      timestepFile: tsFile,
      message: `Memory recorded into timestep ${safeDate}.md and Table of Contents updated.`,
    };
  }

  public stats(): MemoryStats {
    const chapters = this.listChapters();
    const timesteps = this.listTimesteps();
    const drawers = this.listDrawers();
    let totalBytes = 0;
    let totalWords = 0;
    let drawerItemsCount = 0;

    for (const c of chapters) {
      totalBytes += c.content.length;
      totalWords += c.content.split(/\s+/).length;
    }
    for (const t of timesteps) {
      const c = readFileSync(t.filePath, 'utf8');
      totalBytes += c.length;
      totalWords += c.split(/\s+/).length;
    }
    for (const d of drawers) {
      drawerItemsCount += d.itemCount;
      for (const it of d.items) {
        const c = readFileSync(it.filePath, 'utf8');
        totalBytes += c.length;
        totalWords += c.split(/\s+/).length;
      }
    }

    return {
      storageDir: this.rootDir,
      chaptersCount: chapters.length,
      timestepsCount: timesteps.length,
      drawersCount: drawers.length,
      drawerItemsCount,
      totalBytes,
      totalWords,
      lastUpdated: new Date().toISOString(),
    };
  }
}
