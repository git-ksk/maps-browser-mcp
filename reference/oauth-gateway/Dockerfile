FROM node:22-bookworm-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3 AS build

WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential pkg-config libx11-dev libxtst-dev libatspi2.0-dev \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci --ignore-scripts \
    && node_modules/mcp-execution-handoff/scripts/build-linux-xtest-helper.sh \
    && node_modules/mcp-execution-handoff/scripts/build-linux-atspi-helper.sh \
    && node_modules/mcp-execution-handoff/scripts/build-linux-window-authority-helper.sh
COPY src ./src
COPY scripts/clean-dist.mjs ./scripts/clean-dist.mjs
RUN npm run build

WORKDIR /app/reference/oauth-gateway
COPY reference/oauth-gateway/package.json reference/oauth-gateway/package-lock.json ./
RUN npm ci --ignore-scripts

FROM node:22-bookworm-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3 AS runtime

ENV NODE_ENV=production \
    HOME=/home/mcp \
    PORT=8080 \
    MCP_CORE_URL=http://127.0.0.1:8081/mcp \
    MAPS_CHROME_EXECUTABLE=/usr/bin/chromium \
    MAPS_CHROME_PROFILE_DIR=/tmp/maps-browser-mcp/chrome-profile \
    MAPS_HEADLESS=true \
    DISPLAY=:99 \
    MAPS_WEBRTC_TAKEOVER_DISPLAY_NAME=:99 \
    MAPS_WEBRTC_TAKEOVER_HOST_EXECUTABLE=/app/node_modules/.bin/handoff-linux-webrtc-host \
    XDG_CONFIG_HOME=/tmp/maps-browser-mcp/xdg-config \
    XDG_CACHE_HOME=/tmp/maps-browser-mcp/xdg-cache \
    XDG_RUNTIME_DIR=/tmp/maps-browser-mcp/xdg-runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends chromium chromium-sandbox ca-certificates fonts-noto-cjk xvfb openbox xdotool ffmpeg \
    && chromium --version \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system mcp \
    && useradd --system --gid mcp --create-home --home-dir /home/mcp mcp \
    && mkdir -p /tmp/.X11-unix /tmp/maps-browser-mcp/chrome-profile /tmp/maps-browser-mcp/xdg-config /tmp/maps-browser-mcp/xdg-cache /tmp/maps-browser-mcp/xdg-runtime \
    && chmod 1777 /tmp/.X11-unix \
    && chmod 700 /tmp/maps-browser-mcp/xdg-runtime \
    && chown -R mcp:mcp /tmp/maps-browser-mcp /home/mcp

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/node_modules/mcp-execution-handoff/dist/native/mcp-handoff-linux-xtest-helper /app/node_modules/mcp-execution-handoff/dist/native/mcp-handoff-linux-xtest-helper
COPY --from=build /app/node_modules/mcp-execution-handoff/dist/native/mcp-handoff-linux-atspi-helper /app/node_modules/mcp-execution-handoff/dist/native/mcp-handoff-linux-atspi-helper
COPY --from=build /app/node_modules/mcp-execution-handoff/dist/native/mcp-handoff-linux-window-authority-helper /app/node_modules/mcp-execution-handoff/dist/native/mcp-handoff-linux-window-authority-helper
RUN test -x /app/node_modules/mcp-execution-handoff/dist/native/mcp-handoff-linux-xtest-helper \
    && test -x /app/node_modules/mcp-execution-handoff/dist/native/mcp-handoff-linux-atspi-helper \
    && test -x /app/node_modules/mcp-execution-handoff/dist/native/mcp-handoff-linux-window-authority-helper
COPY --from=build /app/dist ./dist
COPY scripts/linux-webrtc-container-acceptance.mjs ./scripts/linux-webrtc-container-acceptance.mjs

WORKDIR /app/reference/oauth-gateway
COPY reference/oauth-gateway/package.json reference/oauth-gateway/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY reference/oauth-gateway/*.mjs ./
COPY reference/oauth-gateway/entrypoint.sh ./

WORKDIR /app
RUN chown -R mcp:mcp /app/reference/oauth-gateway
USER mcp

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e 'fetch("http://127.0.0.1:8080/healthz").then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))'

CMD ["./reference/oauth-gateway/entrypoint.sh"]
