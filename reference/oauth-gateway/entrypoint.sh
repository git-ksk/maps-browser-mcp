#!/bin/sh
set -eu

: "${MCP_CORE_BEARER_TOKEN:?MCP_CORE_BEARER_TOKEN is required}"

core_pid=""
gateway_pid=""
cleanup_started="false"

profile_restore() {
  [ -n "${MAPS_PROFILE_SNAPSHOT_BUCKET:-}" ] || return 0
  node reference/oauth-gateway/profile-snapshot.mjs restore
}

profile_checkpoint() {
  [ -n "${MAPS_PROFILE_SNAPSHOT_BUCKET:-}" ] || return 0
  node reference/oauth-gateway/profile-snapshot.mjs checkpoint --browser-stopped
}

cleanup_processes() {
  [ "$cleanup_started" = "false" ] || return 0
  cleanup_started="true"
  [ -z "$gateway_pid" ] || kill -TERM "$gateway_pid" 2>/dev/null || true
  [ -z "$core_pid" ] || kill -TERM "$core_pid" 2>/dev/null || true
  [ -z "$gateway_pid" ] || wait "$gateway_pid" 2>/dev/null || true
  [ -z "$core_pid" ] || wait "$core_pid" 2>/dev/null || true
}

graceful_shutdown() {
  trap - INT TERM EXIT
  cleanup_processes
  if ! profile_checkpoint; then
    echo "[maps-profile] graceful shutdown checkpoint failed" >&2
  fi
  exit 0
}

trap graceful_shutdown INT TERM
trap cleanup_processes EXIT

profile_restore

if [ -n "${MAPS_PROFILE_SNAPSHOT_BUCKET:-}" ] && [ -z "${MAPS_BROWSER_STOPPED_CHECKPOINT_MODULE:-}" ]; then
  MAPS_BROWSER_STOPPED_CHECKPOINT_MODULE="$(pwd)/reference/oauth-gateway/profile-checkpoint-provider.mjs"
  export MAPS_BROWSER_STOPPED_CHECKPOINT_MODULE
fi

env \
  MCP_HTTP_HOST=127.0.0.1 \
  MCP_HTTP_PORT=8081 \
  MCP_AUTH_PROVIDER=static-bearer \
  MCP_BEARER_TOKEN="$MCP_CORE_BEARER_TOKEN" \
  node dist/index.js --http &
core_pid=$!

node reference/oauth-gateway/server.mjs &
gateway_pid=$!

while kill -0 "$core_pid" 2>/dev/null && kill -0 "$gateway_pid" 2>/dev/null; do
  sleep 1
done

exit 1
