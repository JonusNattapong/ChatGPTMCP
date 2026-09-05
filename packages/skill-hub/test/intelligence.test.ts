import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { SkillRegistry } from '../src/registry.js';

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-intelligence-'));
  const stateRoot = path.join(root, '.state');
  const skills: Array<[string, string]> = [
    ['research', 'Research topics with source verification'],
    ['deep-research', 'Deep research across many sources'],
    ['implement', 'Implement software changes with minimal diffs'],
    ['tdd', 'Tests first TDD workflow for implementation'],
    ['test-driven-development', 'Test driven development workflow'],
    ['diagnosing-bugs', 'Diagnose bugs and isolate root causes'],
    ['code-review', 'Review code changes for correctness'],
    ['platform-engineering', 'Production platform and deployment engineering'],
    ['technical-documentation', 'Write technical documentation'],
    ['frontend-design', 'Design and implement frontend interfaces'],
    ['qa-methodology', 'QA verification methodology']
  ];
  for (const [name, description] of skills) {
    await fs.mkdir(path.join(root, name));
    await fs.writeFile(path.join(root, name, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\n# ${name}\n`);
  }
  return { root, stateRoot };
}

test('resolver ranks by family and collapses known duplicate groups', async () => {
  const { root, stateRoot } = await fixture();
  const registry = new SkillRegistry(root, stateRoot);
  await registry.sync();
  const resolved = registry.resolve('implement feature with tests', 10);
  assert.ok(resolved.some((skill) => skill.name === 'implement'));
  const tddGroup = resolved.filter((skill) => skill.canonical === 'tdd');
  assert.equal(tddGroup.length, 1);
  assert.equal(tddGroup[0]?.name, 'tdd');
  assert.ok(tddGroup[0]?.reasons.includes('canonical-preference'));
});

test('composer builds a bounded ordered pipeline with unique canonical skills', async () => {
  const { root, stateRoot } = await fixture();
  const registry = new SkillRegistry(root, stateRoot);
  await registry.sync();
  const plan = registry.compose('fix bug, implement the repair, then verify code', 4);
  assert.ok(plan.stages.length >= 2);
  assert.ok(plan.stages.length <= 4);
  assert.equal(new Set(plan.stages.map((stage) => stage.canonical)).size, plan.stages.length);
  assert.ok(plan.families.some((entry) => entry.family === 'build'));
  assert.ok(plan.families.some((entry) => entry.family === 'verify'));
});

test('Thai task routing recognizes build and verify intent', async () => {
  const { root, stateRoot } = await fixture();
  const registry = new SkillRegistry(root, stateRoot);
  await registry.sync();
  const thai = (...points: number[]) => String.fromCodePoint(...points);
  const fix = thai(0xe41, 0xe01, 0xe49);
  const bug = thai(0xe1a, 0xe31, 0xe4a, 0xe01);
  const route = registry.route(`${fix}${bug}`, 8);
  assert.ok(route.families.some((entry) => entry.family === 'build'));
  assert.ok(route.families.some((entry) => entry.family === 'verify'));
});

test('feedback persists aggregate success telemetry without task content', async () => {
  const { root, stateRoot } = await fixture();
  const registry = new SkillRegistry(root, stateRoot);
  await registry.sync();
  await registry.feedback(['tdd'], 'success');
  await registry.feedback(['tdd'], 'partial');

  const restarted = new SkillRegistry(root, stateRoot);
  await restarted.sync();
  const tdd = restarted.resolve('tests first implementation', 10).find((skill) => skill.name === 'tdd');
  assert.equal(tdd?.telemetry.runs, 2);
  assert.equal(tdd?.telemetry.successes, 1);
  assert.equal(tdd?.telemetry.partials, 1);
  assert.equal(restarted.insights().telemetry.totalRuns, 2);

  const persisted = await fs.readFile(path.join(stateRoot, 'usage.json'), 'utf8');
  assert.doesNotMatch(persisted, /tests first implementation/);
});

test('insights expose taxonomy, core coverage and installed duplicate groups', async () => {
  const { root, stateRoot } = await fixture();
  const registry = new SkillRegistry(root, stateRoot);
  await registry.sync();
  const insights = registry.insights();
  assert.equal(insights.taxonomy.total, 11);
  assert.ok(insights.taxonomy.coreInstalled.includes('implement'));
  assert.ok(insights.taxonomy.duplicateGroups.some((group) => group.canonical === 'tdd'));
  assert.ok(insights.taxonomy.duplicateGroups.some((group) => group.canonical === 'research'));
});


test('composer follows role pipeline for bug repair review and final verification', async () => {
  const { root, stateRoot } = await fixture();
  const registry = new SkillRegistry(root, stateRoot);
  await registry.sync();
  const plan = registry.compose('find bugs, fix the codebase, review and verify changes', 4);
  assert.deepEqual(plan.stages.map((stage) => stage.canonical), [
    'diagnosing-bugs',
    'implement',
    'code-review'
  ]);
});
