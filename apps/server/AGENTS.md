# Server Agent Operating Guidelines

Please refer to the master [AGENTS.md](../../AGENTS.md) at the repository root for full operating guidelines, architectural invariants, capability mappings, and security review checklists.

Key server-specific files:
- `src/tools.ts`: Primary tool definitions, argument schemas, and execution handlers.
- `src/supervisor.ts`: Supervisor daemon, worker monitoring, and circuit breaker.
- `src/verification.ts`: Pre-commit verification gates.
- `src/index.ts`: Stdio & HTTP Streamable transports.
