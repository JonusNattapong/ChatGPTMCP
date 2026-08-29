#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
platform="$(uname -s)"
case "$(uname -m)" in
  arm64|aarch64) asset_arch="arm64" ;;
  x86_64) asset_arch="amd64" ;;
  *) echo "Unsupported macOS architecture: $(uname -m)" >&2; exit 1 ;;
esac

client_path="${project_root}/tools/tunnel-client-v0.0.13/tunnel-client"
if [[ "${platform}" == "Darwin" ]]; then
  profile_dir="${HOME}/Library/Application Support/tunnel-client"
else
  profile_dir="${XDG_CONFIG_HOME:-${HOME}/.config}/tunnel-client"
fi
tunnel_id="${OPENAI_TUNNEL_ID:?Set OPENAI_TUNNEL_ID before starting the tunnel.}"
organization_id="${OPENAI_ORGANIZATION_ID:?Set OPENAI_ORGANIZATION_ID before starting the tunnel.}"
workspace_root="${MCP_WORKSPACE_ROOT:-${project_root}}"
if [[ "${platform}" == "Darwin" ]]; then
  runtime_key="$(security find-generic-password -a "${USER}" -s chatgpt-machine-mcp-tunnel -w)"
else
  key_file="${project_root}/.tunnel/control-plane-api-key"
  if [[ -n "${CONTROL_PLANE_API_KEY:-}" ]]; then
    runtime_key="${CONTROL_PLANE_API_KEY}"
  elif [[ -r "${key_file}" ]]; then
    if [[ "$(stat -c '%a' "${key_file}")" != "600" ]]; then
      echo "Runtime key file must have mode 600: ${key_file}" >&2
      exit 1
    fi
    runtime_key="$(<"${key_file}")"
  else
    echo "Set CONTROL_PLANE_API_KEY or create ${key_file} with mode 600." >&2
    exit 1
  fi
fi

if [[ ! -x "${client_path}" ]]; then
  echo "Tunnel client not found or not executable: ${client_path}" >&2
  asset_os="$(tr '[:upper:]' '[:lower:]' <<<"${platform}")"
  echo "Download tunnel-client-v0.0.13-${asset_os}-${asset_arch}.zip, extract it there, then run chmod +x on tunnel-client." >&2
  exit 1
fi
if [[ "${runtime_key}" != sk-* ]]; then
  echo "Keychain entry did not return a valid runtime API key." >&2
  exit 1
fi

mkdir -p "${profile_dir}"
CONTROL_PLANE_API_KEY="${runtime_key}" "${client_path}" runtimes connect \
  --alias chatgpt-machine \
  --admin-profile default \
  --profile chatgpt-machine-runtime \
  --profile-dir "${profile_dir}" \
  --tunnel-id "${tunnel_id}" \
  --organization-id "${organization_id}" \
  --runtime-api-key env:CONTROL_PLANE_API_KEY \
  --mcp-command "node ${project_root}/dist/index.js --root ${workspace_root} --dangerously-open-machine"

"${project_root}/scripts/status-tunnel.sh"
