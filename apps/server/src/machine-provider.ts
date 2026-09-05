import { createToolSpecs, type ToolContext } from './tools.js';
import type { ToolProvider } from './gateway.js';

/**
 * Backward-compatible adapter that contributes the existing machine tool
 * surface to the gateway without renaming or wrapping individual tools.
 */
export function createMachineProvider(context: ToolContext): ToolProvider {
  const specs = createToolSpecs(context);
  return {
    id: 'machine',
    tools: () => specs,
  };
}
