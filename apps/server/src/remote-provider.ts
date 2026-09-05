import type { Tool } from '@modelcontextprotocol/server';
import type { ToolProvider } from './gateway.js';
import type { ToolSpec } from './tools.js';

export interface RemoteToolDescriptor {
  name: string;
  description?: string;
  inputSchema?: Tool['inputSchema'];
  annotations?: Partial<ToolSpec['annotations']>;
}

export interface RemoteMcpAdapter {
  discoverTools(): Promise<readonly RemoteToolDescriptor[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
}

export interface RemoteProviderOptions {
  id: string;
  adapter: RemoteMcpAdapter;
  /** Override only when an existing integration requires a different public namespace. */
  publicName?: (providerId: string, remoteToolName: string) => string;
  /** Optional explicit allow-list. Missing requested tools fail startup to catch provider contract drift. */
  includeTools?: readonly string[];
}

function defaultPublicName(providerId: string, remoteToolName: string): string {
  return `${providerId}_${remoteToolName}`;
}

function normalizeAnnotations(value: RemoteToolDescriptor['annotations']): ToolSpec['annotations'] {
  // External tools fail closed when authority metadata is absent. A provider must
  // positively declare read-only behavior before the gateway advertises it as such.
  return {
    readOnlyHint: value?.readOnlyHint === true,
    destructiveHint: value?.destructiveHint ?? value?.readOnlyHint !== true,
    openWorldHint: value?.openWorldHint ?? true,
  };
}

function validateProviderId(id: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(id)) {
    throw new Error(`Invalid remote provider id "${id}".`);
  }
}

function validateRemoteToolName(name: string): void {
  if (!name || name.length > 128) throw new Error(`Invalid remote tool name "${name}".`);
}

/**
 * Materialize one remote MCP server as a ToolProvider.
 *
 * Discovery happens once during construction of the provider so the public MCP
 * surface is deterministic for that runtime. Refresh/reconnect policy belongs to
 * the transport adapter, not to the gateway registry.
 */
export async function createRemoteMcpProvider(options: RemoteProviderOptions): Promise<ToolProvider> {
  validateProviderId(options.id);
  const publicName = options.publicName ?? defaultPublicName;
  const discovered = await options.adapter.discoverTools();
  const byRemoteName = new Map(discovered.map((tool) => [tool.name, tool]));
  const remoteTools = options.includeTools
    ? options.includeTools.map((name) => {
        const tool = byRemoteName.get(name);
        if (!tool) throw new Error(`Remote provider ${options.id} is missing required tool "${name}".`);
        return tool;
      })
    : discovered;
  const specs: ToolSpec[] = remoteTools.map((remote) => {
    validateRemoteToolName(remote.name);
    const name = publicName(options.id, remote.name);
    if (!name) throw new Error(`Remote provider ${options.id} produced an empty public tool name for ${remote.name}.`);
    return {
      name,
      description: remote.description ?? `Remote MCP tool ${remote.name} from provider ${options.id}.`,
      inputSchema: remote.inputSchema ?? { type: 'object', properties: {} },
      annotations: normalizeAnnotations(remote.annotations),
      handler: (args) => options.adapter.callTool(remote.name, args),
    };
  });

  return {
    id: options.id,
    tools: () => specs,
  };
}
