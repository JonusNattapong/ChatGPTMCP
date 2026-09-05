import test from 'node:test';
import assert from 'node:assert/strict';
import {
  challengeIdea,
  deduplicateCandidateTexts,
  experimentDesign,
  objectiveAlignmentScore,
  semanticSimilarity,
  synthesizeIdeas,
  unconventionalSolve,
} from '../dist/engine.js';

test('objective alignment rejects obvious drift and rewards target fit', () => {
  const target = {
    problem: 'Reduce CI duration without reducing test coverage',
    objective: 'cut CI runtime while preserving test coverage',
  };
  const relevant = objectiveAlignmentScore({ ...target, candidate: 'Parallelize CI test shards and measure wall-clock duration.' });
  const drift = objectiveAlignmentScore({ ...target, candidate: 'Launch a social media referral campaign for customer acquisition.' });
  assert.ok(relevant > drift);
  assert.ok(drift < 0.24);
});

test('semantic dedup removes paraphrased candidates before synthesis', () => {
  assert.ok(semanticSimilarity(
    'rank MCP providers adaptively using outcome signals',
    'adaptive outcome ranking for MCP provider selection',
  ) >= 0.72);
  const result = deduplicateCandidateTexts([
    'rank MCP providers adaptively using outcome signals',
    'adaptive outcome ranking for MCP provider selection',
    'quarantine unhealthy MCP tools',
  ]);
  assert.equal(result.unique.length, 2);
  assert.equal(result.duplicates.length, 1);
});

test('challenge is candidate-specific instead of one generic checklist', () => {
  const routing = challengeIdea({ idea: 'adaptive provider routing by outcome score', objective: 'reduce failed MCP invocations' });
  const quarantine = challengeIdea({ idea: 'quarantine unhealthy MCP tools', objective: 'reduce failed MCP invocations' });
  assert.notEqual(routing.challengeFocus, quarantine.challengeFocus);
  assert.match(routing.failureModes.join(' '), /feedback loop/i);
  assert.match(quarantine.failureModes.join(' '), /false-positive quarantine/i);
});

test('synthesis answers the original decision and drops duplicate or drifting scope', () => {
  const result = synthesizeIdeas({
    problem: 'Select MCP providers safely',
    objective: 'choose the safest healthy provider for each capability',
    ideas: [
      'rank MCP providers adaptively using outcome signals',
      'adaptive outcome ranking for MCP provider selection',
      'quarantine unhealthy MCP tools',
      'launch a customer referral campaign',
    ],
  });
  assert.match(result.decision, /Select MCP providers safely/i);
  assert.equal(result.rejectedAsDuplicates.length, 1);
  assert.ok(result.hybrid.rejectedParts.some((item) => /objective drift/i.test(item)));
  assert.ok(!result.hybrid.preservedParts.some((item) => /referral campaign/i.test(item)));
});

test('experiment metric and falsification are tied to the actual candidate', () => {
  const result = experimentDesign({
    idea: 'adaptive MCP provider routing',
    objective: 'reduce failed invocations and latency',
  });
  assert.match(result.primaryMetric, /routing latency/i);
  assert.match(result.falsificationCondition, /adaptive MCP provider routing/i);
  assert.equal(result.candidate, 'adaptive MCP provider routing');
});

test('orchestrator deduplicates repeated branches before challenge and synthesis', () => {
  const result = unconventionalSolve({
    problem: 'Scale MCP services without duplicated tools or fragile routing',
    objective: 'keep capability routing reliable and unambiguous',
    methods: ['first_principles', 'indirect_strategy'],
    branches: 8,
  });
  assert.ok(result.duplicateCandidates > 0);
  assert.ok(result.ideas.length <= 2);
  assert.ok(result.ideas.every((idea) => idea.alignmentDecision !== 'reject'));
  assert.ok(result.challenges.length <= result.ideas.length);
  assert.match(result.synthesis.decision, /Scale MCP services/i);
});
