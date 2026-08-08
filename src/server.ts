import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { loadConfig } from "./config.js";
import { MapsUrlCompiler } from "./maps/url-compiler.js";
import { PolicyEngine, PolicyError } from "./policy/policy-engine.js";
import { ChromeProcess } from "./browser/chrome-process.js";
import { MapsBrowserRuntime, BrowserRuntimeError } from "./browser/runtime.js";
import { SemanticController } from "./browser/semantic-controller.js";
import { VisibleStateReader } from "./browser/visible-state-reader.js";
import { TRAVEL_MODES } from "./types.js";

const config = loadConfig();
const compiler = new MapsUrlCompiler();
const policy = new PolicyEngine({
  interactiveAssist: config.policy.interactiveAssist,
  maxActionsPerMinute: config.policy.maxActionsPerMinute
});
const chrome = new ChromeProcess(config.browser);
const runtime = new MapsBrowserRuntime(chrome, policy);
const controller = new SemanticController(runtime, compiler);
const reader = new VisibleStateReader(runtime, {
  maxNodes: config.policy.maxAxNodes,
  maxChars: config.policy.maxReadChars
});

function jsonResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }]
  };
}

function errorResult(error: unknown) {
  const known = error instanceof PolicyError || error instanceof BrowserRuntimeError;
  const code = known ? error.code : "INTERNAL_ERROR";
  const message = error instanceof Error ? error.message : "Unknown error";
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ error: code, message }) }],
    isError: true
  };
}

function consume(): void {
  policy.consumeAction();
}

export function buildServer(): McpServer {
  const server = new McpServer({ name: "maps-browser-mcp", version: "0.1.0" });

  server.registerTool(
    "maps_search",
    {
      description: "Open a single user-directed Google Maps search in the dedicated browser session.",
      inputSchema: z.object({ query: z.string().min(1).max(500) })
    },
    async ({ query }) => {
      try {
        consume();
        policy.assertSearchQuery(query);
        const compiled = compiler.search(query);
        const result = await runtime.navigate(compiled.url, compiled.action);
        return jsonResult({ opened: true, url: result.url });
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "maps_directions",
    {
      description: "Open Google Maps directions. Origin may be omitted so Google Maps can use the browser/device location when available.",
      inputSchema: z.object({
        origin: z.string().min(1).max(300).optional(),
        destination: z.string().min(1).max(300),
        mode: z.enum(TRAVEL_MODES).default("transit")
      })
    },
    async ({ origin, destination, mode }) => {
      try {
        consume();
        const compiled = compiler.directions({ origin, destination, mode });
        const result = await runtime.navigate(compiled.url, compiled.action);
        return jsonResult({ opened: true, url: result.url, mode });
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "maps_show",
    {
      description: "Open Google Maps centered on coordinates using an official Maps URL.",
      inputSchema: z.object({
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
        zoom: z.number().min(0).max(21).optional()
      })
    },
    async (input) => {
      try {
        consume();
        const compiled = compiler.show(input);
        const result = await runtime.navigate(compiled.url, compiled.action);
        return jsonResult({ opened: true, url: result.url });
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "maps_streetview",
    {
      description: "Open Street View at coordinates using an official Google Maps URL.",
      inputSchema: z.object({
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
        heading: z.number().min(0).max(360).optional(),
        pitch: z.number().min(-90).max(90).optional(),
        fov: z.number().min(10).max(100).optional()
      })
    },
    async (input) => {
      try {
        consume();
        const compiled = compiler.streetview(input);
        const result = await runtime.navigate(compiled.url, compiled.action);
        return jsonResult({ opened: true, url: result.url });
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "maps_select_result",
    {
      description: "Select one of the currently displayed Google Maps place results by zero-based index. This does not expose a generic browser click primitive.",
      inputSchema: z.object({ index: z.number().int().min(0).max(19) })
    },
    async ({ index }) => {
      try {
        consume();
        return jsonResult(await controller.selectResult(index));
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "maps_select_route",
    {
      description: "Select one of the currently displayed route candidates by zero-based index using bounded Google Maps UI heuristics.",
      inputSchema: z.object({ index: z.number().int().min(0).max(11) })
    },
    async ({ index }) => {
      try {
        consume();
        return jsonResult(await controller.selectRoute(index));
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "maps_set_travel_mode",
    {
      description: "Change the travel mode of the active directions request by rebuilding the official Maps URL instead of exploring the DOM.",
      inputSchema: z.object({ mode: z.enum(TRAVEL_MODES) })
    },
    async ({ mode }) => {
      try {
        consume();
        return jsonResult(await controller.setTravelMode(mode));
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "maps_read_place_summary",
    {
      description: "Read a small, bounded summary from the current Google Maps place UI. Disabled by default; no full DOM, reviews, or persistent dataset extraction.",
      inputSchema: z.object({})
    },
    async () => {
      try {
        consume();
        policy.assertInteractiveAssistEnabled();
        return jsonResult(await reader.read("place"));
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "maps_read_route_summary",
    {
      description: "Read a small, bounded summary from the current Google Maps route UI. Disabled by default and intended only for the user's active request.",
      inputSchema: z.object({})
    },
    async () => {
      try {
        consume();
        policy.assertInteractiveAssistEnabled();
        return jsonResult(await reader.read("route"));
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  return server;
}

export async function shutdownRuntime(): Promise<void> {
  await runtime.close();
}

export { config };
