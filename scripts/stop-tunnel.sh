#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
client_path="${project_root}/tools/tunnel-client-v0.0.13/tunnel-client"
watchdog_pid_file="${project_root}/.tunnel/watch-tunnel.pid"

if [[ ! -x "${client_path}" ]]; then
  echo "Tunnel client not found or not executable: ${client_path}" >&2
  exit 1
fi

if [[ -f "${watchdog_pid_file}" ]]; then
  watchdog_pid="$(cat "${watchdog_pid_file}" 2>/dev/null || true)"
  if [[ "${watchdog_pid}" =~ ^[0-9]+$ ]]; then kill "${watchdog_pid}" 2>/dev/null || true; fi
  rm -f "${watchdog_pid_file}"
fi

"${client_path}" runtimes stop chatgpt-machine
