export const TRAVEL_MODES = ["driving", "walking", "bicycling", "transit"] as const;

export type TravelMode = (typeof TRAVEL_MODES)[number];

export type MapsAction =
  | { kind: "search"; query: string }
  | {
      kind: "directions";
      origin?: string;
      destination: string;
      mode: TravelMode;
    }
  | { kind: "show"; latitude: number; longitude: number; zoom?: number }
  | {
      kind: "streetview";
      latitude: number;
      longitude: number;
      heading?: number;
      pitch?: number;
      fov?: number;
    };

export interface VisibleStateSummary {
  kind: "place" | "route";
  lines: string[];
  truncated: boolean;
  source: "google_maps_accessibility_tree";
}
