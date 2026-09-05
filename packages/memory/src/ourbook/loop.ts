import { consolidateSharedMemory } from './engine';

export type ConsolidationLoopState = {
  running: boolean;
  checkIntervalMs: number;
  localHour: number;
  lastCheckAt: number | null;
  lastConsolidationAt: number | null;
  lastError: string | null;
};

let timer: ReturnType<typeof setInterval> | null = null;
const state: ConsolidationLoopState = {
  running: false,
  checkIntervalMs: 60 * 60 * 1000,
  localHour: 2,
  lastCheckAt: null,
  lastConsolidationAt: null,
  lastError: null,
};

export function getConsolidationLoopState(): Readonly<ConsolidationLoopState> {
  return { ...state };
}

export function startConsolidationLoop(
  options: { checkIntervalMs?: number; localHour?: number } = {},
) {
  if (state.running) return;

  state.running = true;
  state.checkIntervalMs = Math.max(60_000, options.checkIntervalMs ?? state.checkIntervalMs);
  state.localHour = Math.max(0, Math.min(23, Math.trunc(options.localHour ?? state.localHour)));

  check().catch(() => {});
  timer = setInterval(() => {
    check().catch(() => {});
  }, state.checkIntervalMs);
}

export function stopConsolidationLoop() {
  state.running = false;
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

async function check() {
  if (!state.running) return;
  state.lastCheckAt = Date.now();

  const now = new Date();
  if (now.getHours() < state.localHour) return;

  try {
    const result = await consolidateSharedMemory({ sinceHours: 24 });
    if (result.status === 'consolidated') {
      state.lastConsolidationAt = Date.now();
      console.error(
        `[ourbook-mcp] Nightly consolidation stored ${result.source_count} memories as ${result.consolidation_id}`,
      );
    }
    state.lastError = null;
  } catch (error) {
    state.lastError = error instanceof Error ? error.message : String(error);
    console.error('[ourbook-mcp] Nightly consolidation failed:', state.lastError);
  }
}
