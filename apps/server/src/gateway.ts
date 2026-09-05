import type { ToolSpec } from './tools.js';

export interface ToolProvider {
  /** Stable provider identity used for diagnostics and routing ownership. */
  id: string;
  /** Public MCP tools exposed by this provider. Tool names must be globally unique. */
  tools(): readonly ToolSpec[];
}

export interface ResolvedTool {
  providerId: string;
  spec: ToolSpec;
}

export interface ProviderSummary {
  id: string;
  toolCount: number;
  tools: string[];
}

/**
 * Registry and routing seam for the MCP tool surface.
 *
 * Existing machine tools can be registered unchanged while future capability
 * providers contribute additional tools. Name collisions fail at construction
 * time so routing can never become order-dependent.
 */
export class ToolGateway {
  readonly #tools: ToolSpec[];
  readonly #byName = new Map<string, ResolvedTool>();
  readonly #providers: ProviderSummary[];

  constructor(providers: readonly ToolProvider[]) {
    const providerIds = new Set<string>();
    const tools: ToolSpec[] = [];
    const summaries: ProviderSummary[] = [];

    for (const provider of providers) {
      if (!provider.id) throw new Error('Provider id must be a non-empty string.');
      if (providerIds.has(provider.id)) throw new Error(`Duplicate provider id "${provider.id}".`);
      providerIds.add(provider.id);

      const providerTools = [...provider.tools()];
      const names: string[] = [];

      for (const spec of providerTools) {
        const existing = this.#byName.get(spec.name);
        if (existing) {
          throw new Error(
            `Duplicate tool name "${spec.name}" exposed by providers "${existing.providerId}" and "${provider.id}".`,
          );
        }
        this.#byName.set(spec.name, { providerId: provider.id, spec });
        tools.push(spec);
        names.push(spec.name);
      }

      summaries.push({ id: provider.id, toolCount: names.length, tools: names });
    }

    this.#tools = tools;
    this.#providers = summaries;
  }

  listTools(): readonly ToolSpec[] {
    return this.#tools;
  }

  resolve(name: string): ResolvedTool | undefined {
    return this.#byName.get(name);
  }

  providers(): readonly ProviderSummary[] {
    return this.#providers;
  }
}
