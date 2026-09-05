import type { AlignmentDecision, ExperimentDesign, Idea, IdeaChallenge, IdeaSynthesis, MechanismCandidate, ProblemAnalysis, Reframe, ThinkingMethod } from './types.js';

const DOMAIN_PATTERNS: Record<string, { principle: string; mapping: string; breakage: string }> = {
  biology: {
    principle: 'specialized components coordinate through constrained signals rather than shared internals',
    mapping: 'cells→agents, membranes→boundaries, hormones→events, homeostasis→feedback control',
    breakage: 'organizations and software do not evolve under the same selection pressure as living systems',
  },
  ecology: {
    principle: 'resilience comes from diversity, redundancy, niches, and feedback loops',
    mapping: 'species→strategies, niches→market segments, food web→dependency graph, succession→migration plan',
    breakage: 'ecological equilibria can tolerate waste and timescales that businesses cannot',
  },
  military: {
    principle: 'avoid concentrated resistance; shape conditions and attack leverage points indirectly',
    mapping: 'strongpoint→organizational resistance, maneuver→workflow redesign, logistics→enabling infrastructure',
    breakage: 'competitive metaphors can overstate conflict and ignore collaboration or ethics',
  },
  aviation: {
    principle: 'safety emerges from checklists, redundancy, instrumentation, and explicit abort criteria',
    mapping: 'cockpit→control plane, checklist→runbook, black box→audit log, go-around→rollback',
    breakage: 'software can often retry cheaply while aviation cannot',
  },
  economics: {
    principle: 'change incentives and marginal costs instead of relying on repeated persuasion',
    mapping: 'price signal→priority, externality→hidden cost, option value→reversible experiment',
    breakage: 'people are not perfectly rational and incentives can be gamed',
  },
};

const BIO_PATTERNS: Record<string, string> = {
  symbiosis: 'Create reciprocal value so participants gain more by cooperating than defecting.',
  swarm: 'Use simple local rules plus shared signals instead of a central planner.',
  immune_system: 'Detect anomalies, isolate blast radius, remember signatures, and recover automatically.',
  homeostasis: 'Continuously measure deviation and apply bounded corrective feedback.',
  mycelium: 'Use a sparse network that routes resources around local failures and shares weak signals widely.',
  regeneration: 'Design components so damaged parts can be replaced without reconstructing the whole system.',
};

function clean(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, Math.round(n * 100) / 100));
}

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'how', 'if', 'in', 'into', 'is', 'it', 'of', 'on',
  'or', 'our', 'the', 'their', 'this', 'to', 'we', 'with', 'without', 'will', 'would', 'should', 'can', 'could', 'than',
  'then', 'that', 'these', 'those', 'using', 'use', 'used', 'improve', 'situation', 'described', 'target', 'outcome',
]);

function canonicalTerm(raw: string): string {
  const token = raw.toLowerCase();
  if (/^(route|routes|router|routing|rank|ranks|ranking|select|selects|selection|selector)$/.test(token)) return 'routing';
  if (/^(tool|tools|mcp|mcps|provider|providers|service|services|capability|capabilities|plugin|plugins|agent|agents)$/.test(token)) return 'capability';
  if (/^(duplicate|duplicates|duplicated|duplication|overlap|overlaps|collision|collisions|conflict|conflicts)$/.test(token)) return 'overlap';
  if (/^(safe|safely|safety|policy|policies|trust|trusted|guard|guards)$/.test(token)) return 'safety';
  if (/^(fail|fails|failed|failure|failures|error|errors|incident|incidents)$/.test(token)) return 'failure';
  if (/^(fast|faster|speed|speedup|slow|slower|latency|duration|runtime)$/.test(token)) return 'latency';
  if (/^(reliable|reliability|resilient|resilience|robust|robustness)$/.test(token)) return 'reliability';
  if (/^(scale|scales|scaled|scaling|growth|grow)$/.test(token)) return 'scale';
  if (/^(deploy|deploys|deployed|deployment|deployments|release|releases)$/.test(token)) return 'deployment';
  if (/^(build|builds|pipeline|pipelines|ci|test|tests|testing)$/.test(token)) return 'ci';
  if (/^(cache|cached|offline|disconnected|network|tunnel)$/.test(token)) return 'offline';
  if (/^(health|healthy|quarantine|quarantined|isolate|isolation|anomaly)$/.test(token)) return 'health';
  if (/^(manifest|registry|ownership|contract|contracts|schema|schemas)$/.test(token)) return 'contract';
  if (/^(adapt|adapts|adapted|adaptive|adaptively)$/.test(token)) return 'adaptive';
  return token;
}

function semanticTerms(value: string): Set<string> {
  const words = clean(value).match(/[\p{L}\p{N}]+/gu) ?? [];
  return new Set(words.map(canonicalTerm).filter((term) => term.length > 1 && !STOP_WORDS.has(term)));
}

export function semanticSimilarity(a: string, b: string): number {
  const left = semanticTerms(a);
  const right = semanticTerms(b);
  if (!left.size || !right.size) return clean(a).toLowerCase() === clean(b).toLowerCase() ? 1 : 0;
  let intersection = 0;
  for (const term of left) if (right.has(term)) intersection += 1;
  return clamp01(intersection / (left.size + right.size - intersection));
}

function capabilityLanguage(value: string): boolean {
  return /\b(mcp|tool|agent|plugin|service|capabilit|provider|router|routing|rank|select|orchestrat|integration|api|manifest|registry|policy|quarantine)\w*\b/i.test(value);
}

export function objectiveAlignmentScore(input: { problem: string; objective?: string; candidate: string }): number {
  const problem = clean(input.problem);
  const objective = clean(input.objective || problem);
  const candidate = clean(input.candidate);
  const targetTerms = semanticTerms(`${problem} ${objective}`);
  const candidateTerms = semanticTerms(candidate);
  let overlap = 0;
  for (const term of targetTerms) if (candidateTerms.has(term)) overlap += 1;
  const lexical = targetTerms.size && candidateTerms.size
    ? overlap / Math.max(1, Math.min(targetTerms.size, candidateTerms.size))
    : 0;
  const exactContext = problem.length >= 8 && candidate.toLowerCase().includes(problem.toLowerCase()) ? 0.32 : 0;
  const domainBoost = capabilityLanguage(`${problem} ${objective}`) && capabilityLanguage(candidate) ? 0.28 : 0;
  return clamp01(lexical * 0.55 + exactContext + domainBoost);
}

function alignmentDecision(score: number): AlignmentDecision {
  if (score >= 0.48) return 'accept';
  if (score >= 0.24) return 'reframe';
  return 'reject';
}

export function deduplicateCandidateTexts(values: string[], threshold = 0.72): { unique: string[]; duplicates: string[] } {
  const unique: string[] = [];
  const duplicates: string[] = [];
  for (const value of values.map(clean).filter(Boolean)) {
    if (unique.some((existing) => semanticSimilarity(existing, value) >= threshold)) duplicates.push(value);
    else unique.push(value);
  }
  return { unique, duplicates };
}

export function analyzeProblem(input: {
  problem: string;
  objective?: string;
  constraints?: string[];
  stakeholders?: string[];
}): ProblemAnalysis {
  const problem = clean(input.problem);
  const constraints = (input.constraints ?? []).map(clean).filter(Boolean);
  return {
    problem,
    objective: clean(input.objective || `Improve the situation described by: ${problem}`),
    assumptions: [
      'The current wording describes the real problem rather than a symptom.',
      'The current solution space contains the best leverage point.',
      'The stated constraints are all necessary and equally hard.',
      'The current stakeholder incentives are fixed.',
    ],
    hardConstraints: constraints.filter((c) => /must|cannot|required|legal|budget|deadline/i.test(c)),
    softConstraints: constraints.filter((c) => !/must|cannot|required|legal|budget|deadline/i.test(c)),
    stakeholders: input.stakeholders?.map(clean).filter(Boolean) ?? [],
    unknowns: [
      'Which assumption, if false, changes the solution space the most?',
      'Where is the largest hidden cost or delay?',
      'What behavior is currently rewarded even though it hurts the objective?',
    ],
  };
}

export function reframeProblem(problem: string, methods: ThinkingMethod[]): Reframe[] {
  const p = clean(problem);
  const templates: Record<ThinkingMethod, Reframe> = {
    inversion: {
      method: 'inversion',
      question: `How would we deliberately make “${p}” worse?`,
      frame: 'Identify failure-producing behaviors, then invert them into design principles.',
    },
    first_principles: {
      method: 'first_principles',
      question: `What must remain true if every convention around “${p}” is removed?`,
      frame: 'Separate physical/logical necessities from habits, policies, and inherited architecture.',
    },
    cross_domain_analogy: {
      method: 'cross_domain_analogy',
      question: `Which unrelated domain has already solved the structural pattern behind “${p}”?`,
      frame: 'Transfer principles, not surface features, and state where the analogy fails.',
    },
    biomimicry: {
      method: 'biomimicry',
      question: `How would a living system coordinate, recover, or adapt around “${p}”?`,
      frame: 'Look for decentralized feedback, specialization, redundancy, and adaptation.',
    },
    indirect_strategy: {
      method: 'indirect_strategy',
      question: 'Where is resistance strongest, and how can we make it irrelevant instead of confronting it?',
      frame: 'Change incentives, terrain, defaults, or dependencies so the desired behavior becomes easier.',
    },
    constraint_manipulation: {
      method: 'constraint_manipulation',
      question: `What appears when one key constraint in “${p}” is removed, inverted, or made 10× stricter?`,
      frame: 'Use extreme constraints to expose hidden architectural principles.',
    },
    idea_collision: {
      method: 'idea_collision',
      question: `What emerges if two unrelated operating models are forced to solve “${p}” together?`,
      frame: 'Combine mechanisms rather than merely combining vocabulary.',
    },
    contrarian: {
      method: 'contrarian',
      question: `What accepted best practice around “${p}” could be locally wrong?`,
      frame: 'Challenge consensus only where evidence, incentives, or context differ.',
    },
  };
  return methods.map((method) => templates[method]);
}

export function thinkReverse(problem: string): {
  antiGoal: string;
  failureMoves: string[];
  invertedPrinciples: string[];
} {
  const p = clean(problem);
  return {
    antiGoal: `Make the outcome behind “${p}” fail as reliably as possible.`,
    failureMoves: [
      'increase friction at every handoff',
      'hide feedback until late',
      'reward local optimization over system outcomes',
      'make recovery expensive',
      'add irreversible decisions early',
    ],
    invertedPrinciples: [
      'remove avoidable handoffs',
      'surface feedback earlier',
      'align incentives with end-to-end outcomes',
      'make rollback cheap',
      'delay irreversible commitments',
    ],
  };
}

export function crossDomainAnalogy(problem: string, domains: string[]): unknown[] {
  const p = clean(problem);
  return domains.map((domain) => {
    const pattern = DOMAIN_PATTERNS[domain] ?? {
      principle: 'identify the domain’s control loop, constraints, and failure-recovery mechanism',
      mapping: 'map roles, signals, resources, bottlenecks, and feedback to the target problem',
      breakage: 'the analogy is exploratory; validate transferred assumptions experimentally',
    };
    return {
      domain,
      problem: p,
      transferablePrinciple: pattern.principle,
      mapping: pattern.mapping,
      whereAnalogyBreaks: pattern.breakage,
    };
  });
}

export function bioInspire(problem: string, patterns: string[]): unknown[] {
  return patterns.map((pattern) => ({
    pattern,
    problem: clean(problem),
    principle: BIO_PATTERNS[pattern]
      ?? 'Observe adaptation, resource flow, local coordination, and recovery in the chosen biological pattern.',
    designQuestion: `What would “${clean(problem)}” look like if ${pattern} were the governing coordination mechanism?`,
  }));
}

export function indirectStrategy(problem: string): unknown {
  const p = clean(problem);
  return {
    objective: p,
    sequence: [
      'Locate the point of maximum direct resistance.',
      'Identify the dependency, incentive, default, or bottleneck sustaining that resistance.',
      'Change the environment around the resistance instead of escalating pressure.',
      'Create a low-friction path where the desired behavior becomes the default.',
      'Measure second-order effects and preserve an exit path.',
    ],
  };
}

export function breakConstraints(problem: string, constraint?: string): unknown[] {
  const c = clean(constraint || 'the dominant constraint');
  const p = clean(problem);
  return [
    ['remove', `Assume ${c} disappears completely.`],
    ['invert', `Assume the opposite of ${c} becomes mandatory.`],
    ['10x_stricter', `Make ${c} ten times stricter than today.`],
    ['zero_resource', 'Assume almost no extra people, money, or infrastructure are available.'],
    ['no_network', 'Assume coordination cannot depend on synchronous network access.'],
  ].map(([mode, experiment]) => ({
    mode,
    problem: p,
    experiment,
    purpose: 'Expose a principle that remains useful after restoring realistic constraints.',
  }));
}

export function ideaCollision(problem: string, conceptA: string, conceptB: string): unknown {
  return {
    problem: clean(problem),
    conceptA: clean(conceptA),
    conceptB: clean(conceptB),
    collisionProtocol: [
      `Extract the operating mechanism from ${clean(conceptA)}.`,
      `Extract the operating mechanism from ${clean(conceptB)}.`,
      'Find one tension and one complement between the mechanisms.',
      'Build a hybrid mechanism for the target problem.',
      'Define the smallest experiment that can falsify the hybrid.',
    ],
  };
}

function isCapabilitySystem(problem: string): boolean {
  return capabilityLanguage(problem);
}

function mechanismFor(method: ThinkingMethod, problem: string, objective?: string): MechanismCandidate {
  const p = clean(problem);
  const capabilitySystem = isCapabilitySystem(p);
  const generic: Record<ThinkingMethod, Omit<MechanismCandidate,
    'method' | 'targetProblem' | 'objectiveAlignment' | 'alignmentDecision' | 'alignmentRationale' | 'driftSignals'
  >> = {
    inversion: {
      title: 'Anti-failure contract',
      removedAssumption: 'Failures should be handled after they occur.',
      mechanism: 'Turn the most damaging failure modes into explicit preconditions and cheap rollback paths before execution.',
      components: ['failure-mode ledger', 'preflight invariant gate', 'rollback path', 'early feedback signal'],
      controlFlow: ['enumerate failure moves', 'convert them to invariants', 'gate execution', 'rollback on violation'],
      tradeoffs: ['more up-front checks', 'some valid edge cases may be rejected'],
      falsificationTest: 'Disable one guard in a controlled test and verify whether the predicted failure becomes easier to trigger.',
    },
    first_principles: {
      title: 'Minimum invariant kernel',
      removedAssumption: 'Existing boundaries and conventions must remain intact.',
      mechanism: 'Reduce the system to the smallest invariants required for the objective, then rebuild optional behavior around those invariants.',
      components: ['invariant registry', 'minimal execution kernel', 'optional adapters'],
      controlFlow: ['identify non-negotiable invariants', 'remove inherited policy', 'run minimal path', 'add adapters only when evidence requires them'],
      tradeoffs: ['migration cost', 'existing convenience features may disappear'],
      falsificationTest: 'Prototype the minimal path and measure whether removed conventions were actually necessary for correctness.',
    },
    cross_domain_analogy: {
      title: 'Boundary-and-signal architecture',
      removedAssumption: 'Coordination requires shared internals.',
      mechanism: 'Borrow the biological/aviation pattern of strong boundaries, constrained signals, instrumentation, and explicit recovery.',
      components: ['boundary contract', 'signal channel', 'health instrumentation', 'recovery protocol'],
      controlFlow: ['publish contract', 'exchange bounded signals', 'observe health', 'isolate and recover degraded components'],
      tradeoffs: ['extra protocol design', 'analogy can overfit if transferred literally'],
      falsificationTest: 'Replace one shared-internal dependency with a bounded signal interface and compare failure isolation.',
    },
    biomimicry: {
      title: 'Adaptive immune loop',
      removedAssumption: 'All participants should remain equally trusted and equally routable.',
      mechanism: 'Use local health signals, anomaly detection, quarantine, recovery, and remembered signatures to keep local failures from becoming systemic.',
      components: ['health score', 'anomaly detector', 'quarantine state', 'recovery probe', 'failure-signature memory'],
      controlFlow: ['observe', 'score', 'quarantine anomalies', 'probe recovery', 'restore gradually'],
      tradeoffs: ['false positives can isolate healthy components', 'state and thresholds require tuning'],
      falsificationTest: 'Inject repeated faults into one participant and verify that blast radius shrinks without blocking healthy peers.',
    },
    indirect_strategy: {
      title: 'Default-path leverage loop',
      removedAssumption: 'The desired behavior must be enforced directly.',
      mechanism: 'Change routing defaults, incentives, and dependency shape so the preferred behavior is cheaper and more automatic than the undesired behavior.',
      components: ['outcome telemetry', 'default selector', 'cost/quality score', 'fallback path'],
      controlFlow: ['measure outcomes', 'score alternatives', 'adjust default', 'preserve escape hatch'],
      tradeoffs: ['feedback can be gamed', 'poor metrics can optimize the wrong outcome'],
      falsificationTest: 'Change only the default path for a small cohort and compare behavior without adding enforcement.',
    },
    constraint_manipulation: {
      title: 'Constraint-switch architecture',
      removedAssumption: 'The dominant constraint is fixed.',
      mechanism: 'Design for extreme variants of the main constraint and retain the mechanism that remains useful when normal conditions return.',
      components: ['constraint modes', 'degraded-mode path', 'resource budget', 'restoration gate'],
      controlFlow: ['select extreme mode', 'execute constrained path', 'record surviving mechanisms', 'restore realistic constraints'],
      tradeoffs: ['extreme scenarios may be unrealistic', 'can over-optimize rare conditions'],
      falsificationTest: 'Run the same workflow under a 10× stricter constraint and check whether the proposed principle still improves the objective.',
    },
    idea_collision: {
      title: 'Dual-loop hybrid',
      removedAssumption: 'One operating model must own the entire solution.',
      mechanism: 'Combine one mechanism optimized for exploration with another optimized for control, joined by an explicit arbitration rule.',
      components: ['exploration loop', 'control loop', 'arbiter', 'shared evidence record'],
      controlFlow: ['explore alternatives', 'score evidence', 'arbitrate', 'execute bounded choice', 'feed result back'],
      tradeoffs: ['coordination overhead', 'arbiter can become a bottleneck'],
      falsificationTest: 'Compare the hybrid with each mechanism alone on the same bounded task.',
    },
    contrarian: {
      title: 'Best-practice exception gate',
      removedAssumption: 'A generally accepted best practice is locally optimal.',
      mechanism: 'Permit a narrowly scoped exception only when local evidence beats the default and the exception has an automatic expiry.',
      components: ['default policy', 'exception hypothesis', 'evidence gate', 'expiry/rollback'],
      controlFlow: ['state default', 'state exception hypothesis', 'collect evidence', 'grant temporary exception', 'expire or promote'],
      tradeoffs: ['can rationalize bad shortcuts', 'requires disciplined evidence thresholds'],
      falsificationTest: 'Run the exception in a small scope with an expiry and compare against the default policy.',
    },
  };

  const result = { ...generic[method], method };

  const specialized: Partial<Record<ThinkingMethod, Partial<MechanismCandidate>>> = {
    inversion: {
      title: 'Capability ownership contract + collision detector',
      mechanism: 'Require every capability provider to declare ownership, side effects, trust requirements, and fallback semantics; reject ambiguous overlaps before routing.',
      components: ['capability manifest', 'ownership index', 'overlap detector', 'fallback contract'],
      controlFlow: ['publish manifest', 'detect overlap', 'resolve owner/priority', 'route', 'record outcome'],
    },
    first_principles: {
      title: 'Capability registry and policy router',
      mechanism: 'Route by declared capability and policy rather than by server name; MCP servers remain replaceable providers behind a small contract.',
      components: ['capability registry', 'policy router', 'provider adapter', 'result contract'],
      controlFlow: ['normalize intent', 'resolve capability', 'apply policy', 'select provider', 'validate result'],
    },
    cross_domain_analogy: {
      title: 'Membrane + signal bus',
      mechanism: 'Treat each MCP as a bounded cell: expose a narrow capability membrane, communicate through typed signals, and keep internal state private.',
      components: ['typed manifest', 'event/signal bus', 'health probe', 'adapter boundary'],
      controlFlow: ['discover capability', 'send typed request', 'observe health/result', 'isolate failure', 'reroute if possible'],
    },
    biomimicry: {
      title: 'Tool immune system',
      mechanism: 'Maintain per-tool health/trust scores; quarantine repeatedly failing or policy-violating tools, probe them later, and remember failure signatures.',
      components: ['health score', 'trust score', 'quarantine registry', 'probe scheduler', 'failure fingerprint store'],
      controlFlow: ['invoke', 'score result', 'fingerprint failure', 'quarantine when threshold trips', 'probe', 'gradually restore'],
    },
    indirect_strategy: {
      title: 'Outcome-driven adaptive routing',
      mechanism: 'Make the best-performing safe provider the default using telemetry, rather than hard-coding preferred MCPs or asking the model to remember routing rules.',
      components: ['routing telemetry', 'quality/latency score', 'policy constraints', 'adaptive default', 'manual override'],
      controlFlow: ['collect outcome', 'update score', 'filter by policy', 'choose default', 'retain override/fallback'],
    },
    constraint_manipulation: {
      title: 'Offline-first capability manifests',
      mechanism: 'Assume live discovery can fail: cache bounded manifests and routing policy so capability selection survives tunnel/network outages and degrades explicitly.',
      components: ['signed/cached manifest', 'TTL/version', 'degraded-mode router', 'refresh protocol'],
      controlFlow: ['load cache', 'validate freshness', 'route locally when safe', 'degrade/deny when stale-sensitive', 'refresh when connectivity returns'],
    },
    idea_collision: {
      title: 'Policy router × evolutionary telemetry',
      mechanism: 'Combine deterministic safety/policy filtering with evidence-driven provider ranking; learning may reorder eligible tools but can never bypass policy.',
      components: ['hard policy gate', 'eligible provider set', 'outcome scorer', 'exploration budget', 'rollback snapshot'],
      controlFlow: ['filter by policy', 'rank eligible providers', 'occasionally explore', 'measure outcome', 'update ranking', 'rollback bad policy state'],
    },
    contrarian: {
      title: 'Single-purpose MCP rule',
      mechanism: 'Reject the “one universal MCP” instinct: keep servers narrow and move composition/routing into an orchestrator with explicit contracts.',
      components: ['single-responsibility providers', 'orchestrator', 'capability contract', 'composition trace'],
      controlFlow: ['resolve task', 'compose narrow capabilities', 'execute each bounded step', 'trace handoffs', 'validate final outcome'],
    },
  };
  const selected = capabilitySystem ? { ...result, ...specialized[method], method } : result;
  const contextualMechanism = `${selected.mechanism} Apply it specifically to “${p}” and keep only the parts that causally move that outcome.`;
  const score = objectiveAlignmentScore({
    problem: p,
    objective,
    candidate: `${selected.title}. ${contextualMechanism}. ${selected.components.join(' ')}. ${selected.controlFlow.join(' ')}`,
  });
  const decision = alignmentDecision(score);
  const driftSignals: string[] = [];
  if (score < 0.48) driftSignals.push('Weak semantic/causal overlap with the stated objective.');
  if (isCapabilitySystem(`${p} ${objective ?? ''}`) !== isCapabilitySystem(`${selected.title} ${selected.mechanism}`)) {
    driftSignals.push('Candidate appears to operate in a different problem domain than the target.');
  }
  return {
    ...selected,
    mechanism: decision === 'reframe'
      ? `To directly serve “${clean(objective || p)}”, use this only as a bounded mechanism: ${contextualMechanism}`
      : contextualMechanism,
    targetProblem: p,
    objectiveAlignment: score,
    alignmentDecision: decision,
    alignmentRationale: `${Math.round(score * 100)}% objective affinity based on shared target concepts, domain fit, and explicit decision context.`,
    driftSignals,
  };
}

export function generateMechanisms(problem: string, methods: ThinkingMethod[] = [
  'inversion', 'first_principles', 'cross_domain_analogy', 'biomimicry', 'indirect_strategy', 'constraint_manipulation',
], objective?: string): MechanismCandidate[] {
  return [...new Set(methods)].map((method) => mechanismFor(method, problem, objective));
}

export function challengeIdea(input: { idea: string; objective?: string; assumptions?: string[] }): IdeaChallenge {
  const claim = clean(input.idea);
  const objective = clean(input.objective || 'the stated objective');
  const neutralObjective = !input.objective;
  const score = neutralObjective ? 0.5 : objectiveAlignmentScore({ problem: objective, objective, candidate: claim });
  const decision = neutralObjective ? 'accept' : alignmentDecision(score);
  const routing = /route|routing|rank|provider|selector/i.test(claim);
  const health = /health|quarantine|anomal|isolate|recovery probe/i.test(claim);
  const contract = /policy|manifest|registry|ownership|contract|schema/i.test(claim);
  const offline = /offline|cache|cached|disconnect|network|tunnel/i.test(claim);
  const challengeFocus = routing ? 'routing feedback and measurement bias'
    : health ? 'threshold quality, false isolation, and recovery behavior'
      : contract ? 'contract freshness, ownership ambiguity, and control-plane concentration'
        : offline ? 'staleness, degraded-mode safety, and reconnection behavior'
          : 'candidate-specific causal link, operational overhead, and failure containment';
  const tailoredAssumption = routing
    ? 'Provider outcome signals are comparable enough that ranking does not reward easier workloads or noisy telemetry.'
    : health
      ? 'Health thresholds distinguish transient noise from genuine degradation without quarantining healthy participants.'
      : contract
        ? 'Capability/ownership metadata stays fresh enough that a registry or policy gate does not encode stale reality.'
        : offline
          ? 'Cached state remains safe to use for the exact decisions allowed during disconnected operation.'
          : `The specific mechanism “${claim}” has a causal path to ${objective}, not merely a plausible narrative.`;
  const tailoredFailure = routing
    ? 'Adaptive routing creates a feedback loop where winners receive more traffic, making weak alternatives look progressively worse.'
    : health
      ? 'False-positive quarantine removes healthy capacity and causes the protection mechanism itself to create an outage.'
      : contract
        ? 'The registry/policy layer becomes a stale or centralized bottleneck whose failure blocks otherwise healthy providers.'
        : offline
          ? 'A stale cached decision is treated as authoritative after the conditions that made it safe have changed.'
          : `The candidate “${claim}” optimizes a proxy while the stated objective remains unchanged.`;
  return {
    claim,
    challengeFocus,
    objectiveAlignment: score,
    alignmentDecision: decision,
    hiddenAssumptions: [
      ...(input.assumptions ?? []).map(clean).filter(Boolean),
      tailoredAssumption,
      'The mechanism addresses a root cause rather than moving the bottleneck elsewhere.',
      'The required signals are measurable with acceptable latency and quality.',
      'Participants cannot cheaply game the mechanism or its metrics.',
    ],
    failureModes: [
      tailoredFailure,
      'The mechanism adds coordination cost larger than the problem it removes.',
      'A local optimization improves the metric while degrading the end-to-end objective.',
      'Fallback or recovery paths exist on paper but are not exercised until an incident.',
    ],
    secondOrderEffects: [
      'New control points can become bottlenecks or concentrations of authority.',
      'Operators may adapt behavior to the metric instead of the underlying objective.',
      'Successful automation can hide skill or observability gaps until an edge case appears.',
    ],
    strongestCounterargument: decision === 'reject'
      ? `This candidate is weakly aligned to ${objective}; solving the original decision directly is preferable to polishing this mechanism.`
      : `A simpler change may achieve ${objective} with less state, coupling, and operational surface area.`,
    evidenceNeeded: [
      `candidate-specific trace showing how “${claim}” changes ${objective}`,
      'baseline outcome metric',
      'failure/rollback trace',
      'comparison against the simplest viable alternative',
    ],
    killCriteria: [
      `the candidate does not causally improve ${objective}`,
      'no measurable improvement over baseline',
      'rollback is unreliable',
      'new failure blast radius exceeds the baseline',
    ],
  };
}

export function synthesizeIdeas(input: { problem: string; objective?: string; ideas: string[] }): IdeaSynthesis {
  const problem = clean(input.problem);
  const objective = clean(input.objective || problem);
  const deduped = deduplicateCandidateTexts(input.ideas);
  const evaluated = deduped.unique.map((candidate) => ({
    candidate,
    score: objectiveAlignmentScore({ problem, objective, candidate }),
  }));
  let aligned = evaluated.filter((item) => alignmentDecision(item.score) !== 'reject');
  if (!aligned.length && evaluated.length) aligned = [evaluated.sort((a, b) => b.score - a.score)[0]!];
  aligned.sort((a, b) => b.score - a.score);
  const preserved = aligned.slice(0, 3).map((item) => item.candidate);
  const rejectedForDrift = evaluated
    .filter((item) => alignmentDecision(item.score) === 'reject' && !preserved.includes(item.candidate))
    .map((item) => `Reject as objective drift (${Math.round(item.score * 100)}% affinity): ${item.candidate}`);
  const deferred = aligned.slice(3).map((item) => `Defer until evidence shows unique value: ${item.candidate}`);
  const primary = preserved[0] ?? 'the strongest objective-aligned candidate';
  const secondary = preserved[1];
  const decision = secondary
    ? `For “${problem}”, use “${primary}” as the primary mechanism and add “${secondary}” only as a bounded supporting control when it improves the same objective.`
    : `For “${problem}”, proceed with “${primary}” as the narrowest candidate that still addresses the original decision.`;
  return {
    decision,
    deduplicatedIdeas: deduped.unique,
    rejectedAsDuplicates: deduped.duplicates,
    commonGround: [
      'Keep the mechanism observable and reversible.',
      'Separate hard constraints from adaptive optimization.',
      'Prefer explicit interfaces over hidden coupling.',
    ],
    conflicts: deduped.unique.length > 1
      ? ['The candidates may optimize different layers; combining all of them would increase control-plane complexity.']
      : [],
    hybrid: {
      name: 'Objective-anchored bounded hybrid',
      mechanism: `${decision} Preserve explicit rollback and measure the original objective “${objective}”; do not add a candidate merely because it is novel or compatible.`,
      preservedParts: preserved,
      rejectedParts: [...rejectedForDrift, ...deferred],
    },
    assumptions: [
      'The candidate mechanisms can expose comparable outcome signals.',
      'A deterministic boundary can contain experimentation.',
    ],
    firstExperiment: `Test “${primary}” first in one narrow workflow against the original objective before adding any secondary candidate; require a clean rollback before expanding scope.`,
  };
}

export function experimentDesign(input: { idea: string; objective?: string; constraint?: string }): ExperimentDesign {
  const idea = clean(input.idea);
  const objective = clean(input.objective || 'improve the target outcome');
  const constraint = clean(input.constraint || 'existing production safety constraints');
  const metric = /route|routing|rank|provider|selector/i.test(idea)
    ? 'successful objective-aligned routing rate, p95 routing latency, failed/incorrect invocation rate, and override frequency'
    : /health|quarantine|anomal|isolate/i.test(idea)
      ? 'fault-containment rate, false-quarantine rate, healthy capacity retained, and mean time to recovery'
      : /policy|manifest|registry|ownership|contract/i.test(idea)
        ? 'ambiguous capability collisions blocked, false-rejection rate, stale-contract errors, and decision latency'
        : /offline|cache|disconnect|network|tunnel/i.test(idea)
          ? 'safe completion rate while disconnected, stale-decision rate, denied-unsafe-action rate, and refresh recovery time'
          : /\b(ci|build|pipeline|test)\b/i.test(`${idea} ${objective}`)
            ? 'end-to-end CI wall-clock duration, failed pipeline rate, and compute-minutes per successful run'
            : `objective delta attributable to activating “${idea}”, paired with failure rate and operator overhead`;
  return {
    candidate: idea,
    objective,
    hypothesis: `If we introduce “${idea}” in a bounded scope, then it will ${objective} without violating ${constraint}.`,
    minimalPrototype: [
      'Choose one representative workflow and capture its baseline.',
      'Implement only the mechanism required to test the causal claim.',
      'Add structured telemetry plus an explicit off switch.',
      'Run against a control/baseline path with the same workload.',
    ],
    primaryMetric: `For this candidate, measure ${metric} against the same-workload baseline.`,
    successThreshold: `A material improvement in “${objective}” on the candidate-specific metric with no increase in severe failures and acceptable added overhead.`,
    falsificationCondition: `Reject “${idea}” if ${metric} does not beat baseline, the gain disappears after controlling for workload, or the candidate creates a larger failure/recovery cost.`,
    timebox: 'One bounded evaluation cycle; stop as soon as enough evidence exists to accept or reject the causal claim.',
    blastRadius: 'Single workflow, cohort, repository, service, or other smallest independently reversible scope.',
    rollback: 'Keep the previous path intact and switch back through one explicit configuration/feature gate.',
    evidenceToCapture: ['before/after metrics', 'candidate activation trace', 'decision/routing trace', 'failure samples', 'rollback result', 'operator intervention time'],
  };
}

function idea(method: ThinkingMethod, problem: string, objective: string, index: number, noveltyLevel: 'low' | 'balanced' | 'high'): Idea {
  const baseline: Record<ThinkingMethod, [number, number, number]> = {
    inversion: [0.66, 0.88, 0.82], first_principles: [0.72, 0.8, 0.9], cross_domain_analogy: [0.84, 0.66, 0.8],
    biomimicry: [0.88, 0.58, 0.72], indirect_strategy: [0.77, 0.78, 0.91], constraint_manipulation: [0.8, 0.72, 0.83],
    idea_collision: [0.93, 0.52, 0.69], contrarian: [0.79, 0.62, 0.76],
  };
  const [baseNovelty, baseFeasibility, leverage] = baseline[method];
  const noveltyDelta = noveltyLevel === 'high' ? 0.08 : noveltyLevel === 'low' ? -0.1 : 0;
  const feasibilityDelta = noveltyLevel === 'high' ? -0.06 : noveltyLevel === 'low' ? 0.06 : 0;
  const mechanism = mechanismFor(method, problem, objective);
  const priorityScore = clamp01(
    mechanism.objectiveAlignment * 0.4
      + clamp01(baseNovelty + noveltyDelta + index * 0.005) * 0.2
      + clamp01(baseFeasibility + feasibilityDelta - index * 0.005) * 0.2
      + clamp01(leverage) * 0.2,
  );
  return {
    title: mechanism.title,
    method,
    principle: reframeProblem(problem, [method])[0]!.frame,
    proposal: mechanism.mechanism,
    novelty: clamp01(baseNovelty + noveltyDelta + index * 0.005),
    feasibility: clamp01(baseFeasibility + feasibilityDelta - index * 0.005),
    leverage: clamp01(leverage),
    objectiveAlignment: mechanism.objectiveAlignment,
    alignmentDecision: mechanism.alignmentDecision,
    priorityScore,
    risks: mechanism.tradeoffs,
    firstExperiment: mechanism.falsificationTest,
  };
}

export function unconventionalSolve(input: {
  problem: string;
  objective?: string;
  constraints?: string[];
  methods?: ThinkingMethod[];
  branches?: number;
  novelty?: 'low' | 'balanced' | 'high';
}): {
  analysis: ProblemAnalysis;
  reframes: Reframe[];
  ideas: Idea[];
  mechanisms: MechanismCandidate[];
  challenges: IdeaChallenge[];
  synthesis: IdeaSynthesis;
  experiment: ExperimentDesign;
  synthesisPrompt: string;
  rejectedCandidates: Idea[];
  duplicateCandidates: number;
} {
  const methods: ThinkingMethod[] = input.methods?.length ? input.methods : [
    'inversion', 'first_principles', 'cross_domain_analogy', 'biomimicry', 'indirect_strategy', 'constraint_manipulation',
  ];
  const branches = Math.max(2, Math.min(input.branches ?? 6, 12));
  const novelty = input.novelty ?? 'balanced';
  const analysis = analyzeProblem({ problem: input.problem, objective: input.objective, constraints: input.constraints });
  const branchMethods = Array.from({ length: branches }, (_, index) => methods[index % methods.length]!);
  const mechanisms = branchMethods.map((method) => mechanismFor(method, input.problem, analysis.objective));
  const rawIdeas = branchMethods.map((method, index) => idea(method, input.problem, analysis.objective, index, novelty));
  const rejectedCandidates = rawIdeas.filter((item) => item.alignmentDecision === 'reject');
  const alignedIdeas = rawIdeas.filter((item) => item.alignmentDecision !== 'reject').sort((a, b) => b.priorityScore - a.priorityScore);
  const ideas: Idea[] = [];
  let duplicateCandidates = 0;
  for (const candidate of alignedIdeas) {
    const duplicate = ideas.some((existing) => semanticSimilarity(`${existing.title} ${existing.proposal}`, `${candidate.title} ${candidate.proposal}`) >= 0.72);
    if (duplicate) duplicateCandidates += 1;
    else ideas.push(candidate);
  }
  const top = ideas.slice(0, Math.min(3, ideas.length));
  const synthesis = synthesizeIdeas({ problem: input.problem, objective: analysis.objective, ideas: top.map((item) => item.proposal) });
  return {
    analysis,
    reframes: reframeProblem(input.problem, methods),
    ideas,
    mechanisms,
    challenges: top.map((item) => challengeIdea({ idea: item.proposal, objective: analysis.objective })),
    synthesis,
    experiment: experimentDesign({ idea: synthesis.hybrid.mechanism, objective: analysis.objective }),
    rejectedCandidates,
    duplicateCandidates,
    synthesisPrompt: 'Compatibility field: synthesis is now computed directly. Review the structured synthesis, challenge its assumptions, and validate it with the returned falsification experiment.',
  };
}
