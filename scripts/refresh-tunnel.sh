#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
log_dir="${project_root}/.tunnel"
log_path="${log_dir}/refresh-tunnel.log"
mkdir -p "${log_dir}"

nohup bash -c '
  set -euo pipefail
  project_root="$1"
  log_path="$2"
  sleep 2
  {
    printf "%s worker started\n" "$(date -Is)"
    "${project_root}/scripts/stop-tunnel.sh" || true
    sleep 1
    "${project_root}/scripts/start-tunnel.sh"
    sleep 1
    "${project_root}/scripts/status-tunnel.sh"
    printf "%s worker completed\n" "$(date -Is)"
  } >>"${log_path}" 2>&1
' _ "${project_root}" "${log_path}" >/dev/null 2>&1 &

printf 'restart scheduled\nlog: %s\n' "${log_path}"
