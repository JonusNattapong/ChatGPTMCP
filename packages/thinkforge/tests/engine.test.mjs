import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeProblem,
  challengeIdea,
  crossDomainAnalogy,
  experimentDesign,
  generateMechanisms,
  reframeProblem,
  synthesizeIdeas,
  thinkReverse,
  unconventionalSolve,
} from '../dist/engine.js';

test('analysis separates hard and soft constraints', () => {
  const result = analyzeProblem({
    problem: 'Improve deployment reliability',
    constraints: ['must deploy by Friday', 'prefer no new service'],
  });
  assert.equal(result.hardConstraints.length, 1);
  assert.equal(result.softConstraints.length, 1);
});

test('reframing emits selected methods', () => {
  const result = reframeProblem('increase retention', ['inversion', 'first_principles']);
  assert.deepEqual(result.map((item) => item.method), ['inversion', 'first_principles']);
});

test('reverse thinking produces anti-goal and inverted principles', () => {
  const result = thinkReverse('reduce incidents');
  assert.match(result.antiGoal, /reduce incidents/);
  assert.ok(result.invertedPrinciples.length >= 4);
});

test('analogy includes explicit breakage', () => {
  const [result] = crossDomainAnalogy('decouple services', ['biology']);
  assert.ok(result.whereAnalogyBreaks);
});

test('mechanism generation returns implementation-level structure', () => {
  const result = generateMechanisms(
    'Scale several MCP tools without overlapping capabilities',
    ['first_principles', 'biomimicry', 'indirect_strategy'],
  );
  assert.equal(result.length, 3);
  assert.match(result[0].title, /Capability registry/i);
  assert.ok(result.every((item) => item.components.length >= 3));
  assert.ok(result.every((item) => item.controlFlow.length >= 4));
  assert.ok(result.every((item) => item.falsificationTest.length > 20));
});

test('challenge exposes assumptions, failure modes, evidence, and kill criteria', () => {
  const result = challengeIdea({
    idea: 'Route tools by adaptive health score',
    objective: 'reduce failed invocations',
  });
  assert.ok(result.hiddenAssumptions.length >= 3);
  assert.ok(result.failureModes.length >= 3);
  assert.ok(result.evidenceNeeded.length >= 3);
  assert.ok(result.killCriteria.length >= 3);
});

test('synthesis preserves bounded candidates and names rejected scope', () => {
  const result = synthesizeIdeas({
    problem: 'Select MCP providers safely',
    ideas: ['hard policy filter', 'adaptive outcome ranking', 'health quarantine', 'global shared mutable state'],
  });
  assert.equal(result.hybrid.preservedParts.length, 3);
  assert.equal(result.hybrid.rejectedParts.length, 1);
  assert.match(result.hybrid.mechanism, /policy/i);
});

test('experiment design is reversible and falsifiable', () => {
  const result = experimentDesign({
    idea: 'adaptive MCP routing',
    objective: 'reduce latency and failures',
  });
  assert.match(result.hypothesis, /adaptive MCP routing/);
  assert.ok(result.falsificationCondition.length > 30);
  assert.match(result.rollback, /switch back|previous path/i);
  assert.ok(result.evidenceToCapture.includes('rollback result'));
});

test('orchestrator respects branch bounds and returns a complete reasoning package', () => {
  const result = unconventionalSolve({
    problem: 'Scale MCP services without duplicated tools or fragile routing',
    branches: 6,
    novelty: 'high',
  });
  assert.equal(result.ideas.length, 6);
  assert.equal(result.mechanisms.length, 6);
  assert.ok(result.ideas.every((idea) => idea.novelty >= 0 && idea.novelty <= 1));
  assert.ok(result.challenges.length >= 2);
  assert.ok(result.synthesis.hybrid.mechanism.length > 40);
  assert.ok(result.experiment.falsificationCondition.length > 30);
});

test('novelty setting changes prioritization scores', () => {
  const low = unconventionalSolve({ problem: 'speed up CI', branches: 2, novelty: 'low' });
  const high = unconventionalSolve({ problem: 'speed up CI', branches: 2, novelty: 'high' });
  const lowAverage = low.ideas.reduce((sum, item) => sum + item.novelty, 0) / low.ideas.length;
  const highAverage = high.ideas.reduce((sum, item) => sum + item.novelty, 0) / high.ideas.length;
  assert.ok(highAverage > lowAverage);
});
