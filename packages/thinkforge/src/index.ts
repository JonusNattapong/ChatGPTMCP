#!/usr/bin/env node
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
import { ThoughtStore } from './store.js';
import { THINKING_METHODS, type ThinkingMethod } from './types.js';
import {
  analyzeProblem,
  bioInspire,
  breakConstraints,
  challengeIdea,
  crossDomainAnalogy,
  experimentDesign,
  generateMechanisms,
  ideaCollision,
  indirectStrategy,
  reframeProblem,
  synthesizeIdeas,
  thinkReverse,
  unconventionalSolve,
} from './engine.js';

const store = new ThoughtStore();
const server = new McpServer(
  { name: 'thinkforge-mcp', version: '0.2.1' },
  { capabilities: { tools: {}, resources: {}, prompts: {} } },
);
const methodSchema = z.enum(THINKING_METHODS);
const common = { session_id: z.string().uuid().optional() };

function persist(
  problem: string,
  kind: string,
  method: string | null,
  result: unknown,
  sessionId?: string,
) {
  if (sessionId && !store.hasSession(sessionId)) {
    throw new Error(`Unknown ThinkForge session_id: ${sessionId}`);
  }
  const sid = sessionId || store.createSession(problem);
  const thoughtId = store.addThought(sid, kind, method, result);
  return { session_id: sid, thought_id: thoughtId, result };
}

function reply(data: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
    structuredContent: { data },
  };
}

server.registerTool(
  'analyze_problem',
  {
    description: 'Model the problem, assumptions, constraints, stakeholders, and unknowns before ideation.',
    inputSchema: z.object({
      problem: z.string().min(1).max(8000),
      objective: z.string().max(4000).optional(),
      constraints: z.array(z.string().max(1000)).max(30).optional(),
      stakeholders: z.array(z.string().max(500)).max(30).optional(),
      ...common,
    }),
    annotations: { destructiveHint: false, openWorldHint: false },
  },
  async (args) => reply(persist(args.problem, 'analysis', null, analyzeProblem(args), args.session_id)),
);

server.registerTool(
  'reframe_problem',
  {
    description: 'Reframe a problem through selected unconventional-thinking methods.',
    inputSchema: z.object({
      problem: z.string().min(1).max(8000),
      methods: z.array(methodSchema).min(1).max(8).default([
        'inversion',
        'first_principles',
        'cross_domain_analogy',
      ]),
      ...common,
    }),
    annotations: { destructiveHint: false, openWorldHint: false },
  },
  async (args) => reply(persist(
    args.problem,
    'reframes',
    'multi',
    reframeProblem(args.problem, args.methods as ThinkingMethod[]),
    args.session_id,
  )),
);

server.registerTool(
  'think_reverse',
  {
    description: 'Use inversion: design failure deliberately, then invert the failure mechanisms into principles.',
    inputSchema: z.object({ problem: z.string().min(1).max(8000), ...common }),
    annotations: { destructiveHint: false, openWorldHint: false },
  },
  async (args) => reply(persist(args.problem, 'reverse', 'inversion', thinkReverse(args.problem), args.session_id)),
);

server.registerTool(
  'cross_domain_analogy',
  {
    description: 'Transfer structural principles from unrelated domains and explicitly state where each analogy breaks.',
    inputSchema: z.object({
      problem: z.string().min(1).max(8000),
      domains: z.array(z.string().min(1).max(100)).min(1).max(8).default([
        'biology',
        'ecology',
        'aviation',
        'economics',
      ]),
      ...common,
    }),
    annotations: { destructiveHint: false, openWorldHint: false },
  },
  async (args) => reply(persist(
    args.problem,
    'analogy',
    'cross_domain_analogy',
    crossDomainAnalogy(args.problem, args.domains),
    args.session_id,
  )),
);

server.registerTool(
  'bio_inspire',
  {
    description: 'Apply biomimicry patterns such as symbiosis, swarm behavior, immune systems, and homeostasis.',
    inputSchema: z.object({
      problem: z.string().min(1).max(8000),
      patterns: z.array(z.string().min(1).max(100)).min(1).max(8).default([
        'symbiosis',
        'swarm',
        'immune_system',
        'homeostasis',
      ]),
      ...common,
    }),
    annotations: { destructiveHint: false, openWorldHint: false },
  },
  async (args) => reply(persist(
    args.problem,
    'biomimicry',
    'biomimicry',
    bioInspire(args.problem, args.patterns),
    args.session_id,
  )),
);

server.registerTool(
  'indirect_strategy',
  {
    description: 'Find resistance and leverage points, then reshape defaults, incentives, dependencies, or terrain instead of attacking resistance directly.',
    inputSchema: z.object({ problem: z.string().min(1).max(8000), ...common }),
    annotations: { destructiveHint: false, openWorldHint: false },
  },
  async (args) => reply(persist(
    args.problem,
    'indirect',
    'indirect_strategy',
    indirectStrategy(args.problem),
    args.session_id,
  )),
);

server.registerTool(
  'break_constraints',
  {
    description: 'Remove, invert, or radically tighten a constraint to expose hidden solution principles.',
    inputSchema: z.object({
      problem: z.string().min(1).max(8000),
      constraint: z.string().max(2000).optional(),
      ...common,
    }),
    annotations: { destructiveHint: false, openWorldHint: false },
  },
  async (args) => reply(persist(
    args.problem,
    'constraints',
    'constraint_manipulation',
    breakConstraints(args.problem, args.constraint),
    args.session_id,
  )),
);

server.registerTool(
  'idea_collision',
  {
    description: 'Force two unrelated operating models to collide and produce a falsifiable hybrid mechanism.',
    inputSchema: z.object({
      problem: z.string().min(1).max(8000),
      concept_a: z.string().min(1).max(1000),
      concept_b: z.string().min(1).max(1000),
      ...common,
    }),
    annotations: { destructiveHint: false, openWorldHint: false },
  },
  async (args) => reply(persist(
    args.problem,
    'collision',
    'idea_collision',
    ideaCollision(args.problem, args.concept_a, args.concept_b),
    args.session_id,
  )),
);

server.registerTool(
  'generate_mechanisms',
  {
    description: 'Generate concrete mechanism-level alternatives, components, control flow, tradeoffs, and falsification tests.',
    inputSchema: z.object({
      problem: z.string().min(1).max(8000),
      objective: z.string().max(4000).optional(),
      methods: z.array(methodSchema).min(1).max(8).optional(),
      ...common,
    }),
    annotations: { destructiveHint: false, openWorldHint: false },
  },
  async (args) => reply(persist(
    args.problem,
    'mechanisms',
    'multi',
    generateMechanisms(args.problem, args.methods as ThinkingMethod[] | undefined, args.objective),
    args.session_id,
  )),
);

server.registerTool(
  'challenge_idea',
  {
    description: 'Adversarially challenge an idea: assumptions, failure modes, second-order effects, evidence needs, and kill criteria.',
    inputSchema: z.object({
      idea: z.string().min(1).max(12000),
      objective: z.string().max(4000).optional(),
      assumptions: z.array(z.string().max(1000)).max(20).optional(),
      ...common,
    }),
    annotations: { destructiveHint: false, openWorldHint: false },
  },
  async (args) => reply(persist(
    args.idea,
    'challenge',
    'adversarial',
    challengeIdea({ idea: args.idea, objective: args.objective, assumptions: args.assumptions }),
    args.session_id,
  )),
);

server.registerTool(
  'synthesize_ideas',
  {
    description: 'Synthesize competing ideas into one bounded hybrid while preserving conflicts, assumptions, and rejected parts.',
    inputSchema: z.object({
      problem: z.string().min(1).max(8000),
      objective: z.string().max(4000).optional(),
      ideas: z.array(z.string().min(1).max(8000)).min(2).max(12),
      ...common,
    }),
    annotations: { destructiveHint: false, openWorldHint: false },
  },
  async (args) => reply(persist(
    args.problem,
    'synthesis',
    'multi',
    synthesizeIdeas({ problem: args.problem, objective: args.objective, ideas: args.ideas }),
    args.session_id,
  )),
);

server.registerTool(
  'experiment_design',
  {
    description: 'Turn an idea into a bounded, reversible falsification experiment with metrics, kill conditions, blast radius, and rollback.',
    inputSchema: z.object({
      idea: z.string().min(1).max(12000),
      objective: z.string().max(4000).optional(),
      constraint: z.string().max(4000).optional(),
      ...common,
    }),
    annotations: { destructiveHint: false, openWorldHint: false },
  },
  async (args) => reply(persist(
    args.idea,
    'experiment',
    'falsification',
    experimentDesign({ idea: args.idea, objective: args.objective, constraint: args.constraint }),
    args.session_id,
  )),
);

server.registerTool(
  'unconventional_solve',
  {
    description: 'Orchestrate analysis, reframing, concrete mechanisms, scoring, critique, synthesis, and a falsifiable experiment.',
    inputSchema: z.object({
      problem: z.string().min(1).max(8000),
      objective: z.string().max(4000).optional(),
      constraints: z.array(z.string().max(1000)).max(30).optional(),
      methods: z.array(methodSchema).min(1).max(8).optional(),
      branches: z.number().int().min(2).max(12).default(6),
      novelty: z.enum(['low', 'balanced', 'high']).default('balanced'),
      ...common,
    }),
    annotations: { destructiveHint: false, openWorldHint: false },
  },
  async (args) => reply(persist(
    args.problem,
    'solve',
    'multi',
    unconventionalSolve({
      problem: args.problem,
      objective: args.objective,
      constraints: args.constraints,
      methods: args.methods as ThinkingMethod[] | undefined,
      branches: args.branches,
      novelty: args.novelty,
    }),
    args.session_id,
  )),
);

server.registerResource(
  'session',
  new ResourceTemplate('thinkforge://session/{id}', {
    list: () => ({
      resources: store.listSessions().map((session) => ({
        uri: `thinkforge://session/${session.id}`,
        name: session.problem.slice(0, 80),
        mimeType: 'application/json',
      })),
    }),
  }),
  { description: 'Persisted ThinkForge thought graph session', mimeType: 'application/json' },
  async (uri, vars) => ({
    contents: [{
      uri: uri.href,
      mimeType: 'application/json',
      text: JSON.stringify(store.getSession(String(vars.id)) ?? { error: 'session not found' }, null, 2),
    }],
  }),
);

server.registerPrompt(
  'unconventional_review',
  {
    description: 'Review a ThinkForge result without rewarding novelty for its own sake.',
    argsSchema: z.object({ result: z.string().min(1).max(16000) }),
  },
  async ({ result }) => ({
    messages: [{
      role: 'user',
      content: {
        type: 'text',
        text: `Critique this unconventional solution. Separate novelty from evidence, list hidden assumptions, failure modes, second-order effects, and the smallest reversible experiment.\n\n${result}`,
      },
    }],
  }),
);

server.registerPrompt(
  'experiment_design',
  {
    description: 'Turn an unconventional idea into a reversible falsification experiment.',
    argsSchema: z.object({
      idea: z.string().min(1).max(8000),
      objective: z.string().max(4000).optional(),
    }),
  },
  async ({ idea, objective }) => ({
    messages: [{
      role: 'user',
      content: {
        type: 'text',
        text: `Design the smallest reversible experiment for this idea. State hypothesis, metric, threshold, timebox, blast radius, rollback, and what result would falsify it. Objective: ${objective ?? 'not provided'}\nIdea: ${idea}`,
      },
    }],
  }),
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
