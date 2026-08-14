import type { TravelMode } from "../types.js";
import { MapsUrlCompiler } from "../maps/url-compiler.js";
import { searchNearbyFromVerifiedPlace, type NearbySearchResult } from "./place-nearby.js";
import { openVerifiedPlacePhotoSurface, type PlacePhotoSurfaceResult } from "./place-photos.js";
import { getVerifiedPlaceShareLink, type PlaceShareLinkResult } from "./place-share.js";
import { selectVerifiedPlaceTab, type PlaceTab, type PlaceTabSelectionResult } from "./place-tabs.js";
import { expandVerifiedOpeningHours, type OpeningHoursExpansionResult } from "./place-opening-hours.js";
import { MapsBrowserRuntime, BrowserRuntimeError } from "./runtime.js";

export class SemanticController {
  constructor(
    private readonly runtime: MapsBrowserRuntime,
    private readonly compiler: MapsUrlCompiler
  ) {}

  async selectResult(index: number, expectedLabel?: string): Promise<{ selected: string }> {
    if (!Number.isInteger(index) || index < 0 || index > 19) {
      throw new Error("index must be an integer between 0 and 19");
    }
    return { selected: await this.runtime.clickPlaceResult(index, expectedLabel) };
  }

  async selectRoute(index: number, expectedLabel?: string): Promise<{ selected: string }> {
    if (!Number.isInteger(index) || index < 0 || index > 11) {
      throw new Error("index must be an integer between 0 and 11");
    }
    return { selected: await this.runtime.clickRouteResult(index, expectedLabel) };
  }

  async getPlaceShareLink(expectedLabel: string): Promise<PlaceShareLinkResult> {
    return getVerifiedPlaceShareLink(this.runtime, expectedLabel);
  }

  async searchNearby(expectedLabel: string, query: string): Promise<NearbySearchResult> {
    return searchNearbyFromVerifiedPlace(this.runtime, expectedLabel, query);
  }

  async openPlacePhotos(expectedLabel: string): Promise<PlacePhotoSurfaceResult> {
    return openVerifiedPlacePhotoSurface(this.runtime, expectedLabel);
  }

  async selectPlaceTab(expectedLabel: string, tab: PlaceTab): Promise<PlaceTabSelectionResult> {
    return selectVerifiedPlaceTab(this.runtime, expectedLabel, tab);
  }

  async expandOpeningHours(expectedLabel: string): Promise<OpeningHoursExpansionResult> {
    return expandVerifiedOpeningHours(this.runtime, expectedLabel);
  }

  async setTravelMode(mode: TravelMode): Promise<{ url: string; mode: TravelMode }> {
    await this.runtime.assertDirectionsContext();
    const last = this.runtime.getLastAction();
    if (!last || last.kind !== "directions") {
      throw new BrowserRuntimeError(
        "MAPS_NOT_OPEN",
        "No directions request is active. Call maps_directions first."
      );
    }
    const compiled = this.compiler.directions({
      origin: last.origin,
      destination: last.destination,
      mode,
      waypoints: last.waypoints,
      avoid: last.avoid
    });
    const result = await this.runtime.navigate(compiled.url, compiled.action);
    return { url: result.url, mode };
  }
}
