FROM node:22-bookworm-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3 AS build

WORKDIR /app

COPY package.json package-lock.json tsconfig.json ./
RUN npm ci --ignore-scripts
COPY src ./src
RUN npm run build

COPY adapters/auth-firebase/package.json ./adapters/auth-firebase/package.json
RUN npm install --prefix adapters/auth-firebase --ignore-scripts --package-lock=false
COPY adapters/auth-firebase/index.mjs adapters/auth-firebase/cimd.mjs ./adapters/auth-firebase/

FROM node:22-bookworm-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3 AS runtime

ENV NODE_ENV=production \
    MAPS_CHROME_EXECUTABLE=/usr/bin/chromium \
    MAPS_CHROME_PROFILE_DIR=/tmp/maps-browser-mcp/chrome-profile \
    MAPS_HEADLESS=true \
    XDG_CONFIG_HOME=/tmp/maps-browser-mcp/xdg-config \
    XDG_CACHE_HOME=/tmp/maps-browser-mcp/xdg-cache \
    MCP_AUTH_PROVIDER=module \
    MCP_AUTH_PROVIDER_MODULE=file:///app/adapters/auth-firebase/index.mjs \
    MCP_HTTP_HOST=0.0.0.0 \
    MCP_ALLOW_NONLOOPBACK=true

RUN apt-get update \
    && apt-get install -y --no-install-recommends chromium chromium-sandbox ca-certificates \
    && chromium --version \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system mcp \
    && useradd --system --gid mcp --create-home --home-dir /home/mcp mcp \
    && mkdir -p \
      /tmp/maps-browser-mcp/chrome-profile \
      /tmp/maps-browser-mcp/xdg-config \
      /tmp/maps-browser-mcp/xdg-cache \
    && chown -R mcp:mcp /tmp/maps-browser-mcp /home/mcp

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts \
    && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY --from=build /app/adapters/auth-firebase ./adapters/auth-firebase
COPY scripts/smoke-browser.mjs ./scripts/smoke-browser.mjs

USER mcp

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e 'const p=process.env.MCP_HTTP_PORT||process.env.PORT||"8787";fetch(`http://127.0.0.1:${p}/healthz`).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))'

CMD ["node", "dist/index.js", "--http"]
