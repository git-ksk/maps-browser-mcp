FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json tsconfig.json ./
RUN npm ci --ignore-scripts

COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    MAPS_CHROME_EXECUTABLE=/usr/bin/chromium \
    MAPS_CHROME_PROFILE_DIR=/tmp/maps-browser-mcp/chrome-profile \
    MAPS_HEADLESS=true

RUN apt-get update \
    && apt-get install -y --no-install-recommends chromium chromium-sandbox ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system mcp \
    && useradd --system --gid mcp --create-home --home-dir /home/mcp mcp \
    && mkdir -p /tmp/maps-browser-mcp/chrome-profile \
    && chown -R mcp:mcp /tmp/maps-browser-mcp /home/mcp

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts \
    && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY scripts/smoke-browser.mjs ./scripts/smoke-browser.mjs

USER mcp

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e 'const p=process.env.MCP_HTTP_PORT||process.env.PORT||"8787";fetch(`http://127.0.0.1:${p}/healthz`).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))'

CMD ["node", "dist/index.js", "--http"]
