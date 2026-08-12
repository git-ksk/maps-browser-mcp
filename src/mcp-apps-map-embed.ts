import type { TravelMode } from "./types.js";

export const MAP_DIRECTIONS_APP_RESOURCE_URI = "ui://maps-browser-mcp/directions.html";
export const MCP_APP_MIME_TYPE = "text/html;profile=mcp-app";

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

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Google Maps directions</title>
  <style>
    :root { color-scheme: light dark; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    * { box-sizing: border-box; }
    html, body { margin: 0; min-width: 200px; min-height: 200px; }
    body { padding: 8px; background: transparent; }
    #status { margin: 0 0 8px; font-size: 13px; line-height: 1.4; opacity: 0.8; overflow-wrap: anywhere; }
    #map { display: none; width: 100%; min-height: 360px; height: min(56vh, 520px); border: 0; border-radius: 10px; }
    #map.ready { display: block; }
  </style>
</head>
<body>
  <p id="status">Waiting for route data…</p>
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
      const PROTOCOL_VERSION = "2026-01-26";
      const status = document.getElementById("status");
      const map = document.getElementById("map");
      let initialized = false;
      let nextId = 1;
      const pending = new Map();

      function post(message) {
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
        const message = { jsonrpc: "2.0", method };
        if (params !== undefined) message.params = params;
        post(message);
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

      function renderRoute(value) {
        const route = routeData(value);
        if (!route) return false;

        const url = new URL("https://www.google.com/maps/embed/v1/directions");
        url.searchParams.set("key", API_KEY);
        url.searchParams.set("origin", route.origin);
        url.searchParams.set("destination", route.destination);
        url.searchParams.set("mode", route.mode);

        map.src = url.toString();
        map.classList.add("ready");
        status.textContent = route.origin + " → " + route.destination + " (" + route.mode + ")";
        return true;
      }

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
          renderRoute(message.params && message.params.structuredContent);
          return;
        }

        if (message.method === "ui/notifications/tool-cancelled") {
          status.textContent = "Route rendering was cancelled.";
          return;
        }

        if (message.method === "ping" && Object.prototype.hasOwnProperty.call(message, "id")) {
          post({ jsonrpc: "2.0", id: message.id, result: {} });
          return;
        }

        if (message.method === "ui/resource-teardown" && Object.prototype.hasOwnProperty.call(message, "id")) {
          post({ jsonrpc: "2.0", id: message.id, result: {} });
        }
      });

      if ("ResizeObserver" in window) {
        const resizeObserver = new ResizeObserver(() => {
          if (!initialized) return;
          notify("ui/notifications/size-changed", {
            width: Math.ceil(document.documentElement.scrollWidth),
            height: Math.ceil(document.documentElement.scrollHeight)
          });
        });
        resizeObserver.observe(document.documentElement);
      }

      request("ui/initialize", {
        protocolVersion: PROTOCOL_VERSION,
        appInfo: { name: "maps-browser-mcp-directions", version: "0.1.0" },
        appCapabilities: { availableDisplayModes: ["inline"] }
      }).then(() => {
        initialized = true;
        notify("ui/notifications/initialized", {});
        notify("ui/notifications/size-changed", {
          width: Math.ceil(document.documentElement.scrollWidth),
          height: Math.ceil(document.documentElement.scrollHeight)
        });
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
