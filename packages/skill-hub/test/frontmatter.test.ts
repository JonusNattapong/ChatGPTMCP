import assert from 'node:assert/strict';
import test from 'node:test';
import { parseFrontmatter } from '../src/frontmatter.js';

test('parses common skill frontmatter and nested metadata', () => {
  const meta = parseFrontmatter(`---
name: archify
description: Build diagrams
license: MIT
metadata:
  version: "2.17"
  author: tt-a1i
---
# Body`);
  assert.deepEqual(meta, { name: 'archify', description: 'Build diagrams', license: 'MIT', version: '2.17', author: 'tt-a1i' });
});
