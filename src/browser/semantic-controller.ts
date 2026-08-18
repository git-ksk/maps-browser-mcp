import type { TravelMode } from "../types.js";
import { MapsUrlCompiler } from "../maps/url-compiler.js";
import { searchNearbyFromVerifiedPlace, type NearbySearchResult } from "./place-nearby.js";
import { openVerifiedPlacePhotoSurface, type PlacePhotoSurfaceResult } from "./place-photos.js";
import { getVerifiedPlaceShareLink, type PlaceShareLinkResult } from "./place-share.js";
import { getVerifiedSearchShareLink, type SearchShareLinkResult } from "./search-share.js";
import {
  readVerifiedSearchSuggestions,
  selectVerifiedSearchSuggestion,
  type SearchSuggestionSelectionResult,
  type SearchSuggestionsResult
} from "./search-suggestions.js";
import { selectVerifiedPlaceTab, type PlaceTab, type PlaceTabSelectionResult } from "./place-tabs.js";
import { expandVerifiedOpeningHours, type OpeningHoursExpansionResult } from "./place-opening-hours.js";
import { setVerifiedSearchRating, type SearchRating, type SearchRatingFilterResult } from "./search-rating-filter.js";
import { zoomVerifiedSearch, type SearchZoomDirection, type SearchZoomResult } from "./search-zoom.js";
import { setVerifiedTransitTime, type TransitTimeMode, type TransitTimeResult } from "./transit-time.js";
import { swapVerifiedRouteEndpoints, type RouteSwapResult } from "./route-swap.js";
import { getVerifiedRouteShareLink, type RouteShareLinkResult } from "./route-share.js";
import { selectVerifiedRecommendedTravelMode, type RecommendedTravelModeResult } from "./recommended-mode.js";
import { MapsBrowserRuntime, BrowserRuntimeError } from "./runtime.js";
import { readVerifiedPlaceSaveState, type PlaceSaveStateResult } from "./place-save-state.js";
import { saveVerifiedPlaceToExistingList, type PlaceSaveToListResult } from "./place-save-action.js";
import {
  readVerifiedRouteSendTargets,
  sendVerifiedRouteToDevice,
  type RouteSendActionInput,
  type RouteSendIdentity,
  type RouteSendResult,
  type RouteSendTargetsResult
} from "./route-send.js";

export class SemanticController {
  constructor(
    private readonly runtime: MapsBrowserRuntime,
    private readonly compiler: MapsUrlCompiler
  ) {}

  async readAuthenticatedReadiness(): Promise<{ state: "signed_in" | "signed_out" | "unknown" }> {
    return { state: await this.runtime.readAuthenticatedReadiness() };
  }

  async requestHumanSignIn(): Promise<{ state: "signed_in" }> {
    return this.runtime.requestHumanSignIn();
  }

  async readPlaceSaveState(expectedLabel: string): Promise<PlaceSaveStateResult> {
    return readVerifiedPlaceSaveState(this.runtime, expectedLabel);
  }

  async savePlaceToList(expectedPlaceLabel: string, listIndex: number, expectedListLabel: string): Promise<PlaceSaveToListResult> {
    return saveVerifiedPlaceToExistingList(this.runtime, expectedPlaceLabel, listIndex, expectedListLabel);
  }

  async readRouteSendTargets(identity: RouteSendIdentity): Promise<RouteSendTargetsResult> {
    return readVerifiedRouteSendTargets(this.runtime, identity);
  }

  async sendRouteToDevice(
    input: RouteSendActionInput,
    approvedEpoch: number,
    consumeApproval: () => void
  ): Promise<RouteSendResult> {
    return sendVerifiedRouteToDevice(this.runtime, input, approvedEpoch, consumeApproval);
  }

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

  async getSearchShareLink(expectedQuery: string): Promise<SearchShareLinkResult> {
    return getVerifiedSearchShareLink(this.runtime, expectedQuery);
  }

  async readSearchSuggestions(query: string): Promise<SearchSuggestionsResult> {
    return readVerifiedSearchSuggestions(this.runtime, this.compiler, query);
  }

  async selectSearchSuggestion(
    query: string,
    index: number,
    expectedLabel: string
  ): Promise<SearchSuggestionSelectionResult> {
    return selectVerifiedSearchSuggestion(this.runtime, query, index, expectedLabel);
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

  async setSearchRating(expectedQuery: string, rating: SearchRating): Promise<SearchRatingFilterResult> {
    return setVerifiedSearchRating(this.runtime, expectedQuery, rating);
  }

  async zoomSearch(expectedQuery: string, direction: SearchZoomDirection): Promise<SearchZoomResult> {
    return zoomVerifiedSearch(this.runtime, expectedQuery, direction);
  }

  async setTransitTime(
    expectedOrigin: string,
    expectedDestination: string,
    mode: TransitTimeMode,
    time: string
  ): Promise<TransitTimeResult> {
    return setVerifiedTransitTime(this.runtime, expectedOrigin, expectedDestination, mode, time);
  }

  async swapRouteEndpoints(expectedOrigin: string, expectedDestination: string): Promise<RouteSwapResult> {
    return swapVerifiedRouteEndpoints(this.runtime, this.compiler, expectedOrigin, expectedDestination);
  }

  async getRouteShareLink(expectedOrigin: string, expectedDestination: string): Promise<RouteShareLinkResult> {
    return getVerifiedRouteShareLink(this.runtime, expectedOrigin, expectedDestination);
  }

  async setRecommendedTravelMode(
    expectedOrigin: string,
    expectedDestination: string
  ): Promise<RecommendedTravelModeResult> {
    return selectVerifiedRecommendedTravelMode(this.runtime, expectedOrigin, expectedDestination);
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
