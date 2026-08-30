# Security

ChatGPT Machine MCP is an administrative bridge for a trusted local machine. It is not a hostile multi-tenant sandbox.

## Security boundary

- `WORKSPACE_ONLY` is the default server boundary. File and working-directory paths must remain under the configured root; traversal and symlink/junction escapes are rejected.
- `UNRESTRICTED_MACHINE` is opt-in and gives tools the authority of the operating-system account running the bridge.
- Secret-bearing paths such as `.env`, `.ssh`, and common private-key formats are denied by policy.
- Custom policies can restrict tools, filesystem roots, shell patterns, outbound operations, and approval requirements. Invalid policy tool names or regular expressions fail closed at startup.
- HTTP binding outside loopback requires a bearer token. Token comparison uses a timing-safe comparison.
- Audit records redact common secret values and bound or hash large mutation payloads.

## Supervised runtime

The tunnel-facing stdio entry point is `dist/supervisor.js`. Tool execution occurs in a child MCP worker. If a request exceeds its hard deadline or the worker exits, the supervisor terminates/restarts that worker and replays MCP initialization. This reduces the blast radius of a hung tool but does not make unrestricted tool execution safe for untrusted callers.

While an operator has started a tunnel, the local watchdog may reconnect an unhealthy managed runtime after two failed checks. It does not start a tunnel after sign-in or reboot, and `chatgpt-local down` stops the watchdog before stopping the runtime. Treat `down` as the explicit way to end both remote access and automatic recovery.

## Operational guidance

Keep runtime keys under `.tunnel/` and local configuration/state under `.chatgpt-machine/`; both are ignored by Git. Run the tunnel only under the user account whose machine authority you intend to expose. Stop the tunnel when remote machine access is not required.

Before deploying source changes, run:

```text
npm test
chatgpt-local doctor
chatgpt-local check
```

For suspected vulnerabilities, avoid posting credentials, runtime keys, private machine paths, or other sensitive evidence in public issues. Use a private security-reporting channel for the repository when available.
