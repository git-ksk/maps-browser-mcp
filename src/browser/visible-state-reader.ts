import type { VisibleStateSummary } from "../types.js";
import { MapsBrowserRuntime } from "./runtime.js";

const ROUTE_HINT = /(\d+\s*(min|mins|hr|hrs|分|時間)|depart|arrive|via|乗換|発|着|徒歩|電車|train|bus|transit)/i;
const PLACE_HINT = /(★|rating|reviews?|open|closed|営業時間|営業中|閉店|住所|address|電話|phone|km|m\b)/i;

function valueToString(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function compactText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export class VisibleStateReader {
  constructor(
    private readonly runtime: MapsBrowserRuntime,
    private readonly options: { maxNodes: number; maxChars: number }
  ) {}

  async read(kind: "place" | "route"): Promise<VisibleStateSummary> {
    const client = await this.runtime.getClient();
    const { DOM, Accessibility } = client;
    await Accessibility.enable();

    try {
      const { root } = await DOM.getDocument({ depth: 2, pierce: false });
      const mainResult = await DOM.querySelector({
        nodeId: root.nodeId,
        selector: '[role="main"]'
      });
      const rootNodeId = mainResult.nodeId || root.nodeId;
      const partial = await Accessibility.getPartialAXTree({
        nodeId: rootNodeId,
        fetchRelatives: false
      });
      const rootAx = partial.nodes.find((node) => !node.ignored) ?? partial.nodes[0];
      if (!rootAx) {
        return { kind, lines: [], truncated: false, source: "google_maps_accessibility_tree" };
      }

      const queue: Array<{ id: string; depth: number }> = [{ id: rootAx.nodeId, depth: 0 }];
      const seenNodes = new Set<string>();
      const seenLines = new Set<string>();
      const lines: string[] = [];
      let visited = 0;
      let chars = 0;
      let truncated = false;

      while (queue.length > 0) {
        const current = queue.shift();
        if (!current || seenNodes.has(current.id)) continue;
        seenNodes.add(current.id);
        if (visited >= this.options.maxNodes) {
          truncated = true;
          break;
        }
        visited += 1;

        const children = await Accessibility.getChildAXNodes({ id: current.id });
        for (const node of children.nodes) {
          if (node.nodeId && current.depth < 6) {
            queue.push({ id: node.nodeId, depth: current.depth + 1 });
          }
          if (node.ignored) continue;
          const role = compactText(valueToString(node.role?.value));
          const name = compactText(valueToString(node.name?.value));
          const value = compactText(valueToString(node.value?.value));
          const text = compactText([role !== "generic" ? name : "", value].filter(Boolean).join(" — "));
          if (!text || text.length < 2 || seenLines.has(text)) continue;
          if (kind === "route" && !ROUTE_HINT.test(text)) continue;
          if (kind === "place" && lines.length >= 3 && !PLACE_HINT.test(text)) continue;

          const boundedLine = text.slice(0, 240);
          if (chars + boundedLine.length > this.options.maxChars) {
            truncated = true;
            break;
          }
          seenLines.add(text);
          lines.push(boundedLine);
          chars += boundedLine.length;
          if (lines.length >= 16) {
            truncated = true;
            break;
          }
        }
        if (truncated) break;
      }

      return {
        kind,
        lines,
        truncated,
        source: "google_maps_accessibility_tree"
      };
    } finally {
      await Accessibility.disable().catch(() => undefined);
    }
  }
}
