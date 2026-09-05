# @chatgpt-pilot/thinkforge — Cognitive Accelerators

ThinkForge provides cognitive scaffolding and structured thinking tools for AI agents, allowing models to deliberate, diverge, challenge assumptions, and stress-test decisions prior to writing code.

---

## MCP Tools

| Tool | Purpose |
|---|---|
| `think_diverge` | Generate multiple diverse perspectives, hypotheses, and architectural alternatives. |
| `think_converge` | Synthesize ideas, resolve tradeoffs, and extract crisp, actionable decisions. |
| `think_challenge` | Actively stress-test assumptions, spot hidden edge cases, and attack proposals. |
| `think_reframe` | Reframe the core question or problem along different architectural dimensions. |
| `think_perspective_swap`| Evaluate a proposal from alternative viewpoints (e.g. security engineer, end-user, operator). |
| `think_stress_test` | Subject an architecture or plan to extreme scale, network partitions, and cascading failure. |

---

## Usage in ChatGPT Pilot

ThinkForge is registered automatically as the `think` provider in `chatgpt-pilot`:

```bash
# Verify ThinkForge tools
pnpm check
```
