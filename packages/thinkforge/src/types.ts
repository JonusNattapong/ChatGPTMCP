export const THINKING_METHODS = [
  'inversion',
  'first_principles',
  'cross_domain_analogy',
  'biomimicry',
  'indirect_strategy',
  'constraint_manipulation',
  'idea_collision',
  'contrarian',
] as const;

export type ThinkingMethod = (typeof THINKING_METHODS)[number];

export type AlignmentDecision = 'accept' | 'reframe' | 'reject';

export interface ProblemAnalysis {
  problem: string;
  objective: string;
  assumptions: string[];
  hardConstraints: string[];
  softConstraints: string[];
  stakeholders: string[];
  unknowns: string[];
}

export interface Reframe {
  method: ThinkingMethod;
  question: string;
  frame: string;
}

export interface Idea {
  title: string;
  method: ThinkingMethod;
  principle: string;
  proposal: string;
  novelty: number;
  feasibility: number;
  leverage: number;
  objectiveAlignment: number;
  alignmentDecision: AlignmentDecision;
  priorityScore: number;
  risks: string[];
  firstExperiment: string;
}

export interface MechanismCandidate {
  title: string;
  method: ThinkingMethod;
  removedAssumption: string;
  mechanism: string;
  components: string[];
  controlFlow: string[];
  tradeoffs: string[];
  falsificationTest: string;
  targetProblem: string;
  objectiveAlignment: number;
  alignmentDecision: AlignmentDecision;
  alignmentRationale: string;
  driftSignals: string[];
}

export interface IdeaChallenge {
  claim: string;
  challengeFocus: string;
  objectiveAlignment: number;
  alignmentDecision: AlignmentDecision;
  hiddenAssumptions: string[];
  failureModes: string[];
  secondOrderEffects: string[];
  strongestCounterargument: string;
  evidenceNeeded: string[];
  killCriteria: string[];
}

export interface IdeaSynthesis {
  decision: string;
  deduplicatedIdeas: string[];
  rejectedAsDuplicates: string[];
  commonGround: string[];
  conflicts: string[];
  hybrid: {
    name: string;
    mechanism: string;
    preservedParts: string[];
    rejectedParts: string[];
  };
  assumptions: string[];
  firstExperiment: string;
}

export interface ExperimentDesign {
  candidate: string;
  objective: string;
  hypothesis: string;
  minimalPrototype: string[];
  primaryMetric: string;
  successThreshold: string;
  falsificationCondition: string;
  timebox: string;
  blastRadius: string;
  rollback: string;
  evidenceToCapture: string[];
}

export interface ThoughtNode {
  id: string;
  sessionId: string;
  parentId: string | null;
  kind: string;
  method: string | null;
  payload: unknown;
  createdAt: string;
}
