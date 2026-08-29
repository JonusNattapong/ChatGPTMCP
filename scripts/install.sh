#!/usr/bin/env bash
set -euo pipefail
ROOT="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
if ! command -v node >/dev/null 2>&1; then echo "Node.js 20+ required" >&2; exit 1; fi
NODE_V="$(node --version | sed 's/^v//')"
if ! printf "%s\n20.0.0\n" "$NODE_V" | sort -V -C 2>/dev/null; then
  # fallback simple check
  MAJOR="$(echo "$NODE_V" | cut -d. -f1)"
  if [ "$MAJOR" -lt 20 ]; then echo "Node.js 20+ required, found v$NODE_V" >&2; exit 1; fi
fi
cd "$ROOT"
echo "Installing chatgpt-machine-mcp v1.0.0..."
npm install
npm run build
npm test
if [ "${NO_LINK:-}" != "1" ]; then
  npm link || true
  echo "Linked: chatgpt-local (try: chatgpt-local --help)"
fi
echo "Done. Next: chatgpt-local setup && chatgpt-local up"
