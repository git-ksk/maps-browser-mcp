import type { TravelMode } from "./types.js";

export const MAP_DIRECTIONS_APP_RESOURCE_URI = "ui://maps-browser-mcp/directions.html";
export const MCP_APP_MIME_TYPE = "text/html;profile=mcp-app";
export const MCP_APP_PROTOCOL_VERSION = "2026-01-26";
export const MAP_DIRECTIONS_APP_VERSION = "0.3.0";
export const MAP_DIRECTIONS_FRAME_DOMAINS = ["https://www.google.com"] as const;

export interface MapDirectionsAppData {
  origin: string;
  destination: string;
  mode: TravelMode;
}

function javascriptStringLiteral(value: string): string {
  // Escaping '<' prevents an environment-provided value from terminating the inline script.
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export function buildDirectionsAppHtml(apiKey: string): string {
  const keyLiteral = javascriptStringLiteral(apiKey);
  const protocolVersionLiteral = javascriptStringLiteral(MCP_APP_PROTOCOL_VERSION);
  const appVersionLiteral = javascriptStringLiteral(MAP_DIRECTIONS_APP_VERSION);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Google Maps directions</title>
  <style>
    :root {
      color-scheme: light dark;
      font-family: var(--font-sans, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
      --safe-area-top: 0px;
      --safe-area-right: 0px;
      --safe-area-bottom: 0px;
      --safe-area-left: 0px;
      --map-height: 360px;
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; width: 100%; min-width: 200px; min-height: 200px; }
    body {
      padding:
        calc(8px + var(--safe-area-top))
        calc(8px + var(--safe-area-right))
        calc(8px + var(--safe-area-bottom))
        calc(8px + var(--safe-area-left));
      background: var(--color-background-primary, transparent);
      overflow: auto;
    }
    #status {
      margin: 0 0 8px;
      font-size: 13px;
      line-height: 1.4;
      color: var(--color-text-secondary, currentColor);
      opacity: 0.82;
      overflow-wrap: anywhere;
    }
    #map {
      display: none;
      width: 100%;
      height: var(--map-height);
      min-height: 200px;
      max-height: 520px;
      border: 0;
      border-radius: 10px;
    }
    #map.ready { display: block; }
  </style>
</head>
<body>
  <p id="status" role="status" aria-live="polite">Waiting for route data…</p>
  <iframe
    id="map"
    title="Google Maps directions"
    loading="lazy"
    allowfullscreen
    referrerpolicy="strict-origin-when-cross-origin"
  ></iframe>
  <script>
    (() => {
      "use strict";

      const API_KEY = ${keyLiteral};
      const PROTOCOL_VERSION = ${protocolVersionLiteral};
      const APP_VERSION = ${appVersionLiteral};
      const status = document.getElementById("status");
      const map = document.getElementById("map");
      const root = document.documentElement;
      let initialized = false;
      let tearingDown = false;
      let nextId = 1;
      let currentRoute = null;
      let hostContext = {};
      const pending = new Map();
      let resizeObserver;
      let sizeFrame = 0;
      let lastReportedWidth = -1;
      let lastReportedHeight = -1;

      function post(message) {
        // MCP Apps Views can run behind an opaque-origin sandbox proxy, so the stable
        // protocol uses parent postMessage with a wildcard target. Inbound messages
        // are still accepted only from this View's direct parent.
        window.parent.postMessage(message, "*");
      }

      function request(method, params) {
        const id = nextId++;
        return new Promise((resolve, reject) => {
          pending.set(id, { resolve, reject });
          post({ jsonrpc: "2.0", id, method, params });
        });
      }

      function notify(method, params) {
        if (tearingDown) return;
        const message = { jsonrpc: "2.0", method };
        if (params !== undefined) message.params = params;
        post(message);
      }

      function finiteNumber(value) {
        return typeof value === "number" && Number.isFinite(value) ? value : undefined;
      }

      function boundedPixel(value, max) {
        const number = finiteNumber(value);
        if (number === undefined) return 0;
        return Math.max(0, Math.min(max, Math.round(number)));
      }

      function mergeHostContext(update) {
        if (!update || typeof update !== "object") return;
        hostContext = {
          ...hostContext,
          ...update,
          safeAreaInsets: {
            ...(hostContext.safeAreaInsets || {}),
            ...(update.safeAreaInsets || {})
          },
          containerDimensions: {
            ...(hostContext.containerDimensions || {}),
            ...(update.containerDimensions || {})
          },
          styles: {
            ...(hostContext.styles || {}),
            ...(update.styles || {}),
            variables: {
              ...((hostContext.styles && hostContext.styles.variables) || {}),
              ...((update.styles && update.styles.variables) || {})
            }
          }
        };
      }

      function applyHostContext(update) {
        mergeHostContext(update);

        if (hostContext.theme === "light" || hostContext.theme === "dark") {
          root.style.colorScheme = hostContext.theme;
        }
        if (typeof hostContext.locale === "string" && hostContext.locale.trim()) {
          root.lang = hostContext.locale.trim();
        }

        const variables = hostContext.styles && hostContext.styles.variables;
        if (variables && typeof variables === "object") {
          let count = 0;
          for (const [name, value] of Object.entries(variables)) {
            if (count >= 128) break;
            if (!/^--[a-z0-9-]{1,80}$/i.test(name)) continue;
            if (typeof value !== "string" || value.length > 512) continue;
            root.style.setProperty(name, value);
            count += 1;
          }
        }

        const insets = hostContext.safeAreaInsets || {};
        root.style.setProperty("--safe-area-top", boundedPixel(insets.top, 128) + "px");
        root.style.setProperty("--safe-area-right", boundedPixel(insets.right, 128) + "px");
        root.style.setProperty("--safe-area-bottom", boundedPixel(insets.bottom, 128) + "px");
        root.style.setProperty("--safe-area-left", boundedPixel(insets.left, 128) + "px");

        const dimensions = hostContext.containerDimensions || {};
        const height = finiteNumber(dimensions.height);
        const maxHeight = finiteNumber(dimensions.maxHeight);
        const limit = height ?? maxHeight;
        if (limit !== undefined && limit > 0) {
          // Maps Embed does not support dimensions below 200px. Keep the nested map
          // viable and let the outer View scroll rather than clipping it on a short host.
          const mapHeight = Math.max(200, Math.min(520, Math.floor(limit - 48)));
          root.style.setProperty("--map-height", mapHeight + "px");
        }
      }

      function routeData(value) {
        if (!value || typeof value !== "object") return null;
        const origin = typeof value.origin === "string" ? value.origin.trim() : "";
        const destination = typeof value.destination === "string" ? value.destination.trim() : "";
        const allowedModes = new Set(["driving", "walking", "bicycling", "transit"]);
        const mode = allowedModes.has(value.mode) ? value.mode : "driving";
        if (!origin || !destination) return null;
        return { origin, destination, mode };
      }

      function clearRoute(message) {
        currentRoute = null;
        map.removeAttribute("src");
        map.classList.remove("ready");
        status.textContent = message;
      }

      function renderRoute(value) {
        const route = routeData(value);
        if (!route) return false;

        currentRoute = route;
        const url = new URL("https://www.google.com/maps/embed/v1/directions");
        url.searchParams.set("key", API_KEY);
        url.searchParams.set("origin", route.origin);
        url.searchParams.set("destination", route.destination);
        url.searchParams.set("mode", route.mode);

        status.textContent = "Loading Google Maps directions for " + route.origin + " → " + route.destination + " (" + route.mode + ")…";
        map.src = url.toString();
        map.classList.add("ready");
        return true;
      }

      map.addEventListener("load", () => {
        if (!currentRoute) return;
        status.textContent = currentRoute.origin + " → " + currentRoute.destination + " (" + currentRoute.mode + ")";
      });

      map.addEventListener("error", () => {
        if (!currentRoute) return;
        status.textContent = "Unable to load the Google Maps Embed view. Text route data remains available in the host.";
      });

      window.addEventListener("message", (event) => {
        if (event.source !== window.parent) return;
        const message = event.data;
        if (!message || message.jsonrpc !== "2.0") return;

        if (Object.prototype.hasOwnProperty.call(message, "id") && !message.method) {
          const waiter = pending.get(message.id);
          if (!waiter) return;
          pending.delete(message.id);
          if (message.error) waiter.reject(new Error(message.error.message || "MCP Apps request failed"));
          else waiter.resolve(message.result);
          return;
        }

        if (message.method === "ui/notifications/tool-input") {
          renderRoute(message.params && message.params.arguments);
          return;
        }

        if (message.method === "ui/notifications/tool-result") {
          if (message.params && message.params.isError) {
            clearRoute("The route tool returned an error. Text error details remain available in the host.");
            return;
          }
          renderRoute(message.params && message.params.structuredContent);
          return;
        }

        if (message.method === "ui/notifications/tool-cancelled") {
          clearRoute("Route rendering was cancelled.");
          return;
        }

        if (message.method === "ui/notifications/host-context-changed") {
          applyHostContext(message.params);
          return;
        }

        if (message.method === "ping" && Object.prototype.hasOwnProperty.call(message, "id")) {
          post({ jsonrpc: "2.0", id: message.id, result: {} });
          return;
        }

        if (message.method === "ui/resource-teardown" && Object.prototype.hasOwnProperty.call(message, "id")) {
          tearingDown = true;
          if (resizeObserver) resizeObserver.disconnect();
          if (sizeFrame) cancelAnimationFrame(sizeFrame);
          map.removeAttribute("src");
          currentRoute = null;
          for (const waiter of pending.values()) waiter.reject(new Error("MCP App view was torn down"));
          pending.clear();
          post({ jsonrpc: "2.0", id: message.id, result: {} });
        }
      });

      function reportSize() {
        if (!initialized || tearingDown || sizeFrame) return;
        sizeFrame = requestAnimationFrame(() => {
          sizeFrame = 0;
          if (!initialized || tearingDown) return;
          const width = Math.ceil(document.documentElement.scrollWidth);
          const height = Math.ceil(document.documentElement.scrollHeight);
          if (width === lastReportedWidth && height === lastReportedHeight) return;
          lastReportedWidth = width;
          lastReportedHeight = height;
          notify("ui/notifications/size-changed", { width, height });
        });
      }

      if ("ResizeObserver" in window) {
        resizeObserver = new ResizeObserver(reportSize);
        resizeObserver.observe(document.documentElement);
      }

      request("ui/initialize", {
        protocolVersion: PROTOCOL_VERSION,
        appInfo: { name: "maps-browser-mcp-directions", version: APP_VERSION },
        appCapabilities: { availableDisplayModes: ["inline"] }
      }).then((result) => {
        if (result && result.hostContext) applyHostContext(result.hostContext);
        initialized = true;
        notify("ui/notifications/initialized", {});
        reportSize();
      }).catch((error) => {
        status.textContent = "Unable to initialize the MCP App view: " + error.message;
      });

      window.addEventListener("unhandledrejection", (event) => {
        if (!initialized) status.textContent = "Unable to initialize the MCP App view.";
        event.preventDefault();
      });
    })();
  </script>
</body>
</html>`;
}
