import type { VisibleSemanticSignalKind } from "../types.js";

const ROUTE_PATTERNS: ReadonlyArray<[VisibleSemanticSignalKind, RegExp]> = [
  ["duration", /(?:\b\d+\s*(?:min|mins|minute|minutes|hr|hrs|hour|hours)\b|\d+\s*(?:分|時間))/i],
  ["distance", /(?:\b\d+(?:[.,]\d+)?\s*(?:km|mi|mile|miles|meter|meters|metre|metres)\b|\d+(?:[.,]\d+)?\s*(?:km|キロメートル|メートル))/i],
  ["departure", /(?:\bdepart(?:ure|s|ing)?\b|出発|発車|\d{1,2}:\d{2}\s*発)/i],
  ["arrival", /(?:\barriv(?:e|al|es|ing)\b|到着|\d{1,2}:\d{2}\s*着)/i],
  ["via", /(?:\bvia\b|経由)/i],
  ["transit", /(?:\b(?:train|bus|subway|metro|tram|transit|transfer)\b|電車|バス|地下鉄|鉄道|乗換)/i]
];

const PLACE_PATTERNS: ReadonlyArray<[VisibleSemanticSignalKind, RegExp]> = [
  ["rating", /(?:★|\bstars?\b|\brating\b|評価|星\s*[1-5](?:[.,]\d)?)/i],
  ["open_status", /(?:\b(?:open|closed|closing soon)\b|営業中|営業時間外|閉店|まもなく閉店)/i],
  ["distance", /(?:\b\d+(?:[.,]\d+)?\s*(?:km|mi|mile|miles|meter|meters|metre|metres)\b|\d+(?:[.,]\d+)?\s*(?:km|キロメートル|メートル))/i],
  ["address", /(?:\baddress\b|住所)/i],
  ["phone", /(?:\bphone\b|\btelephone\b|\btel\.?\b|電話)/i]
];

export function classifyVisibleSemanticSignals(
  kind: "place" | "route",
  text: string
): VisibleSemanticSignalKind[] {
  const patterns = kind === "route" ? ROUTE_PATTERNS : PLACE_PATTERNS;
  const signals: VisibleSemanticSignalKind[] = [];
  for (const [signal, pattern] of patterns) {
    if (pattern.test(text)) signals.push(signal);
  }
  return signals;
}
