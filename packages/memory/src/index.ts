#!/usr/bin/env node

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { BrainBook } from './brain.js';

export const book = new BrainBook();

export const server = new McpServer({
  name: 'chatgpt-pilot-memory',
  version: '1.0.0',
});

// 1. Table of Contents (สารบัญ)
server.tool(
  'memory_toc',
  'Retrieve the Master Table of Contents (TOC/สารบัญ) of the living memory book. Lists all chapters, subtopics, and chronological timesteps.',
  {
    filter: z.string().optional().describe('Optional filter for a specific chapter name, keyword, or section'),
  },
  async ({ filter }) => {
    const text = book.getTOC(filter);
    return {
      content: [{ type: 'text', text }],
    };
  }
);

// 2. Executive Summary (สรุปเนื้อหา)
server.tool(
  'memory_summary',
  'Retrieve high-level executive summary of the living memory book or a specific chapter.',
  {
    topic: z.string().optional().describe('Optional chapter or topic name to summarize'),
  },
  async ({ topic }) => {
    const text = book.getSummary(topic);
    return {
      content: [{ type: 'text', text }],
    };
  }
);

// 3. Read Topic / Chapter / Subtopic (อ่านเนื้อหาตามหัวข้อหลักและหัวข้อย่อย)
server.tool(
  'memory_read_topic',
  'Read a chapter, topic, or specific subtopic (หัวข้อย่อย) from the living memory book.',
  {
    topic: z.string().describe('Chapter or topic name (e.g. 01-identity, projects, architecture, timeline, or filename)'),
    subtopic: z.string().optional().describe('Specific heading or subtopic to extract (e.g. Active Workspaces, Tooling, Milestones)'),
  },
  async ({ topic, subtopic }) => {
    const text = book.readTopic(topic, subtopic);
    return {
      content: [{ type: 'text', text }],
    };
  }
);

// 4. Temporal Recall / Timestep (เรียกดูความจำตามช่วงเวลา)
server.tool(
  'memory_recall_time',
  'Recall memory entries indexed by chronological timestep (e.g. "latest", "2026-09-05", "2026-08", "September 2026").',
  {
    timestep: z.string().describe('Date, month, or "latest" to inspect recent timeline logs'),
  },
  async ({ timestep }) => {
    const text = book.recallTime(timestep);
    return {
      content: [{ type: 'text', text }],
    };
  }
);

// 5. Full-Text Search (ค้นหาความจำ)
server.tool(
  'memory_search',
  'Search across all chapters, subtopics, and timesteps in the living memory book.',
  {
    query: z.string().describe('Search query or keywords'),
    limit: z.number().optional().describe('Maximum number of results to return (default: 5)'),
  },
  async ({ query, limit }) => {
    const results = book.search(query, limit ?? 5);
    const text =
      results.length > 0
        ? results
            .map(
              (r, idx) =>
                `### ${idx + 1}. ${r.title} (\`${r.file}\`)\n> ${r.snippet}`
            )
            .join('\n\n')
        : `No matching memory entries found for query: "${query}"`;
    return {
      content: [{ type: 'text', text }],
    };
  }
);

// 6. Remember / Record Entry (บันทึกความจำใหม่)
server.tool(
  'memory_remember',
  'Record a new memory, milestone, architecture note, or decision into the living memory book. Automatically updates the timeline and rebuilds the Table of Contents.',
  {
    title: z.string().describe('Title or brief summary of the memory entry'),
    content: z.string().describe('Detailed content of the memory entry (markdown supported)'),
    chapter: z.string().optional().describe('Optional chapter to append this note to (e.g. 02-projects, 03-architecture)'),
    timestep: z.string().optional().describe('Optional specific date (YYYY-MM-DD), defaults to today'),
    tags: z.array(z.string()).optional().describe('Optional tags for indexing'),
  },
  async ({ title, content, chapter, timestep, tags }) => {
    const result = book.remember({ title, content, chapter, timestep, tags });
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  }
);

// 7. Memory Statistics
server.tool(
  'memory_stats',
  'Get statistics about the living memory store (chapter count, timesteps, word count, disk size, storage location).',
  {},
  async () => {
    const stats = book.stats();
    return {
      content: [{ type: 'text', text: JSON.stringify(stats, null, 2) }],
    };
  }
);

// Unified Recall tool: memory_recall
server.tool(
  'memory_recall',
  'Recall memory entries by query, chapter topic, or timestep.',
  {
    query: z.string().describe('Search query, keyword, or subtopic'),
    topic: z.string().optional().describe('Optional chapter topic filter'),
    timestep: z.string().optional().describe('Optional timestep query'),
  },
  async ({ query, topic, timestep }) => {
    if (timestep) {
      const text = book.recallTime(timestep);
      return { content: [{ type: 'text', text }] };
    }
    if (topic) {
      const text = book.readTopic(topic, query);
      return { content: [{ type: 'text', text }] };
    }
    const results = book.search(query, 5);
    const text =
      results.length > 0
        ? results.map((r) => `### ${r.title} (\`${r.file}\`)\n${r.snippet}`).join('\n\n')
        : book.readTopic(query);
    return { content: [{ type: 'text', text }] };
  }
);

// 8. Drawer List (แสดงรายการลิ้นชักความจำเฉพาะกิจ)
server.tool(
  'memory_drawer_list',
  'List all specialized memory drawers (compartments/ลิ้นชักความจำ) and their items, or inspect a specific drawer.',
  {
    drawer: z.string().optional().describe('Optional drawer name to filter (e.g. cheatsheets, lessons, drafts, projects)'),
  },
  async ({ drawer }) => {
    const drawers = book.listDrawers(drawer);
    return {
      content: [{ type: 'text', text: JSON.stringify(drawers, null, 2) }],
    };
  }
);

// 9. Drawer Get (ดึงของจากลิ้นชักความจำ)
server.tool(
  'memory_drawer_get',
  'Retrieve the full content of a specific memory item stored in a drawer (e.g. drawer="cheatsheets", item="docker").',
  {
    drawer: z.string().describe('Drawer name (e.g. cheatsheets, lessons, drafts, projects)'),
    item: z.string().describe('Item identifier or name inside the drawer (e.g. docker, git, ci-cross-platform)'),
  },
  async ({ drawer, item }) => {
    const content = book.readDrawerItem(drawer, item);
    return {
      content: [{ type: 'text', text: content }],
    };
  }
);

// 10. Drawer Put (เก็บของเข้าลิ้นชักความจำ)
server.tool(
  'memory_drawer_put',
  'Store or update a specialized memory item inside a drawer (e.g. storing a cheatsheet, lesson, project note, or draft). Automatically rebuilds the Table of Contents.',
  {
    drawer: z.string().describe('Target drawer name (e.g. cheatsheets, lessons, drafts, projects)'),
    item: z.string().describe('Item identifier or filename (slug or name)'),
    content: z.string().describe('Markdown content to store in the drawer'),
    title: z.string().optional().describe('Human-readable title for this memory item'),
    tags: z.array(z.string()).optional().describe('Tags for indexing and discovery'),
  },
  async ({ drawer, item, content, title, tags }) => {
    const result = book.putDrawerItem(drawer, item, content, { title, tags });
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  }
);

// 11. Drawer Delete (ลบของออกจากลิ้นชักความจำ)
server.tool(
  'memory_drawer_delete',
  'Delete a specific item from a drawer.',
  {
    drawer: z.string().describe('Drawer name'),
    item: z.string().describe('Item name to delete'),
  },
  async ({ drawer, item }) => {
    const result = book.deleteDrawerItem(drawer, item);
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  }
);

async function startStdioServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[chatgpt-pilot-memory] Markdown Living Memory Book MCP server running on stdio');
}

function isMainModule() {
  const entry = process.argv[1];
  return entry ? resolve(entry) === fileURLToPath(import.meta.url) : false;
}

if (isMainModule()) {
  const command = process.argv[2];

  if (!command || command === 'mcp') {
    startStdioServer().catch((error) => {
      console.error('[chatgpt-pilot-memory] Fatal startup error:', error);
      process.exit(1);
    });
  } else if (command === 'toc') {
    console.log(book.getTOC(process.argv[3]));
  } else if (command === 'summary') {
    console.log(book.getSummary(process.argv[3]));
  } else if (command === 'read') {
    console.log(book.readTopic(process.argv[3] || '01-identity', process.argv[4]));
  } else if (command === 'time') {
    console.log(book.recallTime(process.argv[3] || 'latest'));
  } else if (command === 'search') {
    console.log(JSON.stringify(book.search(process.argv[3] || '', 10), null, 2));
  } else if (command === 'stats') {
    console.log(JSON.stringify(book.stats(), null, 2));
  } else if (command === 'drawer') {
    const sub = process.argv[3];
    if (sub === 'list' || !sub) {
      console.log(JSON.stringify(book.listDrawers(process.argv[4]), null, 2));
    } else if (sub === 'get') {
      console.log(book.readDrawerItem(process.argv[4] || '', process.argv[5] || ''));
    } else if (sub === 'put') {
      console.log(JSON.stringify(book.putDrawerItem(process.argv[4] || '', process.argv[5] || '', process.argv[6] || ''), null, 2));
    } else if (sub === 'del' || sub === 'delete') {
      console.log(JSON.stringify(book.deleteDrawerItem(process.argv[4] || '', process.argv[5] || ''), null, 2));
    }
  } else {
    console.log(`Unknown command: ${command}`);
    console.log(`Usage: pilot-memory [mcp | toc | summary | read | time | search | stats | drawer]`);
  }
}

export default server;
