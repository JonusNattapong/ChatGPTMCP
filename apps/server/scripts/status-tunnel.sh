#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
client_path="${project_root}/tools/tunnel-client-v0.0.13/tunnel-client"

if [[ ! -x "${client_path}" ]]; then
  echo "Tunnel client not found or not executable: ${client_path}" >&2
  exit 1
fi

"${client_path}" runtimes status chatgpt-machine --json
