# @chatgpt-pilot/skill-hub — Dynamic Skills Engine

Skill Hub is a lightweight, high-performance gateway that indexes, searches, and dynamically executes curated agent workflows from the `skills/` repository.

---

## Key Features

- **139+ Curated Skills**: Covers software engineering, cloud infrastructure (Docker, K8s, Terraform), mobile (React Native, Flutter, iOS, Android), data engineering & ML, security auditing, TDD, systematic debugging, and product strategy.
- **Lazy Procedure Loading**: Advertises concise descriptors (`skills_list`) during initialization, fetching deep step-by-step instructions (`skills_get_spec`) only when activated.
- **Zero-Config Discovery**: Automatically discovers the root `skills/` directory when running inside `chatgpt-pilot`.

---

## MCP Tools

| Tool | Purpose | Arguments |
|---|---|---|
| `skills_list` | List all available skills with concise descriptions | `{ filter?: string }` |
| `skills_get_spec` | Retrieve full instructions, scripts, and examples for a skill | `{ name: string }` |
| `skills_run` | Execute a skill workflow procedure against current context | `{ name: string, input?: Record<string, unknown> }` |
