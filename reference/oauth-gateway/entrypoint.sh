#!/bin/sh
set -eu

: "${MCP_CORE_BEARER_TOKEN:?MCP_CORE_BEARER_TOKEN is required}"

core_pid=""
gateway_pid=""

shutdown() {
  trap - INT TERM
  [ -z "$gateway_pid" ] || kill -TERM "$gateway_pid" 2>/dev/null || true
  [ -z "$core_pid" ] || kill -TERM "$core_pid" 2>/dev/null || true
  [ -z "$gateway_pid" ] || wait "$gateway_pid" 2>/dev/null || true
  [ -z "$core_pid" ] || wait "$core_pid" 2>/dev/null || true
}
trap shutdown INT TERM EXIT

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
