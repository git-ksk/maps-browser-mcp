#!/bin/sh
set -eu

: "${MCP_CORE_BEARER_TOKEN:?MCP_CORE_BEARER_TOKEN is required}"

core_pid=""
gateway_pid=""
xvfb_pid=""
openbox_pid=""
cleanup_started="false"
graphics_cleanup_started="false"

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

cleanup_graphics() {
  [ "$graphics_cleanup_started" = "false" ] || return 0
  graphics_cleanup_started="true"
  [ -z "$openbox_pid" ] || kill -TERM "$openbox_pid" 2>/dev/null || true
  [ -z "$xvfb_pid" ] || kill -TERM "$xvfb_pid" 2>/dev/null || true
  [ -z "$openbox_pid" ] || wait "$openbox_pid" 2>/dev/null || true
  [ -z "$xvfb_pid" ] || wait "$xvfb_pid" 2>/dev/null || true
}

start_linux_webrtc_graphics() {
  [ "${MAPS_CREDENTIAL_SAFE_TRANSPORT:-external}" = "webrtc_takeover" ] || return 0
  : "${MAPS_WEBRTC_TAKEOVER_DISPLAY_NAME:?MAPS_WEBRTC_TAKEOVER_DISPLAY_NAME is required for Linux webrtc_takeover}"
  : "${MAPS_WEBRTC_TAKEOVER_HOST_EXECUTABLE:?MAPS_WEBRTC_TAKEOVER_HOST_EXECUTABLE is required for Linux webrtc_takeover}"
  [ -x "$MAPS_WEBRTC_TAKEOVER_HOST_EXECUTABLE" ] || {
    echo "[maps-webrtc] Linux Handoff host executable is unavailable" >&2
    return 1
  }
  display_number="${MAPS_WEBRTC_TAKEOVER_DISPLAY_NAME#:}"
  display_number="${display_number%%.*}"
  case "$display_number" in
    ''|*[!0-9]*) echo "[maps-webrtc] invalid local X11 display" >&2; return 1 ;;
  esac
  export DISPLAY="$MAPS_WEBRTC_TAKEOVER_DISPLAY_NAME"
  mkdir -p "$XDG_RUNTIME_DIR"
  chmod 700 "$XDG_RUNTIME_DIR"
  Xvfb "$DISPLAY" -screen 0 1280x800x24 -nolisten tcp -ac >/dev/null 2>&1 &
  xvfb_pid=$!
  x_socket="/tmp/.X11-unix/X${display_number}"
  attempt=0
  while [ ! -S "$x_socket" ]; do
    kill -0 "$xvfb_pid" 2>/dev/null || { echo "[maps-webrtc] Xvfb exited before readiness" >&2; return 1; }
    attempt=$((attempt + 1))
    [ "$attempt" -lt 100 ] || { echo "[maps-webrtc] Xvfb readiness timed out" >&2; return 1; }
    sleep 0.05
  done
  openbox --sm-disable >/dev/null 2>&1 &
  openbox_pid=$!
  sleep 0.2
  kill -0 "$openbox_pid" 2>/dev/null || { echo "[maps-webrtc] Openbox exited before readiness" >&2; return 1; }
}

graceful_shutdown() {
  trap - INT TERM EXIT
  cleanup_processes
  if ! profile_checkpoint; then
    echo "[maps-profile] graceful shutdown checkpoint failed" >&2
  fi
  cleanup_graphics
  exit 0
}

exit_cleanup() {
  cleanup_processes
  cleanup_graphics
}

trap graceful_shutdown INT TERM
trap exit_cleanup EXIT

profile_restore
start_linux_webrtc_graphics

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

if ! node reference/oauth-gateway/wait-for-core.mjs; then
  echo "[maps-oauth-gateway] private core failed readiness before public startup" >&2
  exit 1
fi
kill -0 "$core_pid" 2>/dev/null || {
  echo "[maps-oauth-gateway] private core exited before public startup" >&2
  exit 1
}

node reference/oauth-gateway/server.mjs &
gateway_pid=$!

while kill -0 "$core_pid" 2>/dev/null && kill -0 "$gateway_pid" 2>/dev/null; do
  if [ -n "$xvfb_pid" ] && ! kill -0 "$xvfb_pid" 2>/dev/null; then
    echo "[maps-webrtc] Xvfb exited unexpectedly" >&2
    break
  fi
  if [ -n "$openbox_pid" ] && ! kill -0 "$openbox_pid" 2>/dev/null; then
    echo "[maps-webrtc] Openbox exited unexpectedly" >&2
    break
  fi
  sleep 1
done

exit 1
