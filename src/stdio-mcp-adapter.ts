import { Client, type CallToolResult } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { ToolError } from './errors.js';
import type { RemoteMcpAdapter, RemoteToolDescriptor } from './remote-provider.js';

export interface StdioMcpAdapterOptions {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  maxBufferSize?: number;
  clientName?: string;
  clientVersion?: string;
}

function parseTextPayload(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

type ToolContentItem = CallToolResult['content'][number];
type TextToolContent = Extract<ToolContentItem, { type: 'text' }>;

function isTextContent(item: ToolContentItem): item is TextToolContent {
  return item.type === 'text';
}

function normalizeToolResult(result: CallToolResult): unknown {
  if (result.isError) {
    const text = result.content
      .filter(isTextContent)
      .map((item) => item.text)
      .join('\n')
      .trim();
    throw new ToolError(
      'REMOTE_ERROR',
      text || 'Remote MCP tool reported an error.',
      'Inspect the remote provider health and tool arguments, then retry.',
    );
  }

  if (result.structuredContent !== undefined) return result.structuredContent;

  const textItems = result.content.filter(isTextContent);
  if (textItems.length === 1 && result.content.length === 1) return parseTextPayload(textItems[0].text);

  return { content: result.content };
}

/**
 * Persistent stdio MCP client used by provider adapters.
 *
 * The child process is started lazily, reused across discovery/calls, bounded by
 * the SDK stdio buffer limit, and closed explicitly with the parent runtime.
 */
export class StdioMcpAdapter implements RemoteMcpAdapter {
  readonly #options: Required<Pick<StdioMcpAdapterOptions, 'timeoutMs' | 'maxBufferSize' | 'clientName' | 'clientVersion'>> & StdioMcpAdapterOptions;
  #client?: Client;
  #transport?: StdioClientTransport;
  #connecting?: Promise<Client>;

  constructor(options: StdioMcpAdapterOptions) {
    if (!options.command.trim()) throw new Error('stdio MCP command must be a non-empty string.');
    this.#options = {
      ...options,
      timeoutMs: options.timeoutMs ?? 30_000,
      maxBufferSize: options.maxBufferSize ?? 4 * 1024 * 1024,
      clientName: options.clientName ?? 'chatgpt-machine-mcp-provider',
      clientVersion: options.clientVersion ?? '1.0.0',
    };
  }

  async #connect(): Promise<Client> {
    if (this.#client) return this.#client;
    if (this.#connecting) return this.#connecting;

    this.#connecting = (async () => {
      const transport = new StdioClientTransport({
        command: this.#options.command,
        args: this.#options.args,
        cwd: this.#options.cwd,
        env: this.#options.env,
        stderr: 'pipe',
        maxBufferSize: this.#options.maxBufferSize,
      });
      transport.stderr?.on('data', () => {
        // Intentionally drained without forwarding provider stderr across the MCP boundary.
      });

      const client = new Client(
        { name: this.#options.clientName, version: this.#options.clientVersion },
        { enforceStrictCapabilities: true },
      );
      client.onerror = () => {
        // Request-level failures are surfaced by the awaited SDK call. Avoid noisy
        // provider stderr and never copy remote diagnostics into host logs by default.
      };
      client.onclose = () => {
        if (this.#client === client) this.#client = undefined;
        if (this.#transport === transport) this.#transport = undefined;
      };

      try {
        await client.connect(transport);
      } catch (error) {
        await transport.close().catch(() => undefined);
        throw new ToolError(
          'REMOTE_ERROR',
          `Failed to connect to stdio MCP provider: ${error instanceof Error ? error.message : String(error)}`,
          'Verify the provider command, build output, working directory, and runtime dependencies.',
        );
      }

      this.#transport = transport;
      this.#client = client;
      return client;
    })().finally(() => {
      this.#connecting = undefined;
    });

    return this.#connecting;
  }

  async discoverTools(): Promise<readonly RemoteToolDescriptor[]> {
    const client = await this.#connect();
    const result = await client.listTools(undefined, {
      timeout: this.#options.timeoutMs,
      maxTotalTimeout: this.#options.timeoutMs,
      cacheMode: 'refresh',
    });
    return result.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      annotations: tool.annotations,
    }));
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const client = await this.#connect();
    const result = await client.callTool(
      { name, arguments: args },
      { timeout: this.#options.timeoutMs, maxTotalTimeout: this.#options.timeoutMs },
    );
    return normalizeToolResult(result);
  }

  async close(): Promise<void> {
    const client = this.#client;
    const transport = this.#transport;
    this.#client = undefined;
    this.#transport = undefined;
    this.#connecting = undefined;
    if (client) await client.close().catch(() => undefined);
    else if (transport) await transport.close().catch(() => undefined);
  }
}
