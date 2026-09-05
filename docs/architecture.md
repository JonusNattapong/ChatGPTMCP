# Architecture

## Boundaries

```text
ChatGPT / Codex
      |
      v
Plugin integration boundary
      |----------------------|
      v                      v
  Skills catalog         MCP endpoint
      |                      |
      | procedure            | capabilities
      |                      v
      +--------------> Tool registry
                             |
                             v
                      external systems
```

## Invariants

1. A skill must not own credentials or transport code.
2. MCP tools must have explicit input contracts and bounded outputs.
3. Shared contracts live in `packages/core`; transport-specific code stays in `packages/mcp-server`.
4. Skills can depend on capabilities semantically, never on a local filesystem path.
5. Remote/web transport must enforce authentication, network policy, request limits, and auditability before production exposure.
6. OpenAI-specific plugin packaging is versioned independently from business capabilities so platform contract changes do not force tool rewrites.

## Initial delivery path

- v0.1: monorepo, MCP core, sample skills, tests, CI.
- v0.2: remote MCP transport + auth + capability discovery.
- v0.3: plugin packaging/registration based on the current OpenAI plugin contract.
- v0.4: optional UI and richer skill publishing automation.
