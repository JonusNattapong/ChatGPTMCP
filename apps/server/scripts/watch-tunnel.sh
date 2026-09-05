#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
client_path="${project_root}/tools/tunnel-client-v0.0.13/tunnel-client"
start_script="${project_root}/scripts/start-tunnel.sh"
state_dir="${project_root}/.tunnel"
pid_path="${state_dir}/watch-tunnel.pid"
log_path="${state_dir}/watch-tunnel.log"
interval_seconds="${MCP_TUNNEL_WATCH_INTERVAL_SECONDS:-15}"
failure_threshold="${MCP_TUNNEL_WATCH_FAILURE_THRESHOLD:-2}"

[[ "${interval_seconds}" =~ ^[0-9]+$ ]] && (( interval_seconds >= 5 && interval_seconds <= 300 )) || { echo "invalid watchdog interval" >&2; exit 1; }
[[ "${failure_threshold}" =~ ^[0-9]+$ ]] && (( failure_threshold >= 1 && failure_threshold <= 10 )) || { echo "invalid watchdog threshold" >&2; exit 1; }
[[ -x "${client_path}" ]] || { echo "Tunnel client not found: ${client_path}" >&2; exit 1; }
mkdir -p "${state_dir}"

write_log() {
  if [[ -f "${log_path}" ]] && (( $(wc -c <"${log_path}") > 1048576 )); then mv -f "${log_path}" "${log_path}.previous"; fi
  printf '%s %s\n' "$(date -Is)" "$*" >>"${log_path}"
}
ready() {
  local status
  status="$("${client_path}" runtimes status chatgpt-machine --json 2>/dev/null)" || return 1
  [[ "${status}" == *'"process_running":true'* && "${status}" == *'"healthy":true'* && "${status}" == *'"ready":true'* ]]
}
cleanup() { [[ -f "${pid_path}" && "$(cat "${pid_path}")" == "$$" ]] && rm -f "${pid_path}"; }
trap cleanup EXIT INT TERM

failures=0
while true; do
  if ready; then
    failures=0
  else
    ((failures+=1))
    if (( failures >= failure_threshold )); then
      write_log "runtime unhealthy for ${failures} checks; reconnecting"
      if MCP_TUNNEL_WATCHDOG=1 "${start_script}" --no-watchdog >>"${log_path}" 2>&1; then failures=0; else write_log "reconnect command failed"; fi
    fi
  fi
  sleep "${interval_seconds}"
done
