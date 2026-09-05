#!/usr/bin/env bash
set -euo pipefail
ROOT="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
if ! command -v node >/dev/null 2>&1; then echo "Node.js 20+ required" >&2; exit 1; fi
NODE_V="$(node --version | sed 's/^v//')"
MAJOR="${NODE_V%%.*}"
if ! [[ "$MAJOR" =~ ^[0-9]+$ ]] || [ "$MAJOR" -lt 20 ]; then echo "Node.js 20+ required, found v$NODE_V" >&2; exit 1; fi
if [ ! -d "$ROOT" ]; then echo "Root not found: $ROOT" >&2; exit 1; fi
cd "$ROOT"
echo "Installing chatgpt-machine-mcp v1.0.0..."
npm install
npm test
if [ "${NO_LINK:-}" != "1" ]; then
  npm link
  echo "Linked: chatgpt-local (try: chatgpt-local --help)"
fi
echo "Done. Next: chatgpt-local setup && chatgpt-local up"
