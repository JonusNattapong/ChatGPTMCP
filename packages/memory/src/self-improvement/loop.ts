import { runImproveCycle } from './engine';

export type LoopState = {
  running: boolean;
  intervalMs: number;
  cycleCount: number;
  lastRunAt: number | null;
  lastError: string | null;
};

let loopTimer: ReturnType<typeof setInterval> | null = null;
const state: LoopState = {
  running: false,
  intervalMs: 30 * 60 * 1000, // 30 minutes default
  cycleCount: 0,
  lastRunAt: null,
  lastError: null,
};

export function getLoopState(): Readonly<LoopState> {
  return { ...state };
}

/**
 * Start the self-improvement background loop.
 * Runs one cycle immediately, then repeats on interval.
 */
export function startLoop(intervalMs = state.intervalMs): void {
  if (state.running) return;

  state.running = true;
  state.intervalMs = intervalMs;

  // Run first cycle immediately
  runCycle().catch(() => {});

  loopTimer = setInterval(() => {
    runCycle().catch(() => {});
  }, intervalMs);
}

export function stopLoop(): void {
  state.running = false;
  if (loopTimer !== null) {
    clearInterval(loopTimer);
    loopTimer = null;
  }
}

async function runCycle(): Promise<void> {
  if (!state.running) return;

  try {
    const result = await runImproveCycle();
    state.cycleCount++;
    state.lastRunAt = Date.now();
    state.lastError = null;
    console.error(
      `[ourbook-mcp] Self-improvement cycle #${state.cycleCount} complete: ` +
        `${result.bumped.accessed_bumped + result.bumped.important_bumped} bumped, ` +
        `${result.merged.merged} merged, ` +
        `${result.pruned.decayed_pruned + result.pruned.old_pruned + result.pruned.superseded_pruned} pruned, ` +
        `${result.mined.patterns_found} patterns`,
    );
  } catch (error) {
    state.lastError = error instanceof Error ? error.message : String(error);
    console.error('[ourbook-mcp] Self-improvement cycle failed:', state.lastError);
  }
}
