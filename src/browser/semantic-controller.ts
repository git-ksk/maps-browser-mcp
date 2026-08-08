import type { TravelMode } from "../types.js";
import { MapsUrlCompiler } from "../maps/url-compiler.js";
import { MapsBrowserRuntime, BrowserRuntimeError } from "./runtime.js";

export class SemanticController {
  constructor(
    private readonly runtime: MapsBrowserRuntime,
    private readonly compiler: MapsUrlCompiler
  ) {}

  async selectResult(index: number): Promise<{ selected: string }> {
    if (!Number.isInteger(index) || index < 0 || index > 19) {
      throw new Error("index must be an integer between 0 and 19");
    }
    return { selected: await this.runtime.clickPlaceResult(index) };
  }

  async selectRoute(index: number): Promise<{ selected: string }> {
    if (!Number.isInteger(index) || index < 0 || index > 11) {
      throw new Error("index must be an integer between 0 and 11");
    }
    return { selected: await this.runtime.clickRouteResult(index) };
  }

  async setTravelMode(mode: TravelMode): Promise<{ url: string; mode: TravelMode }> {
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
      mode
    });
    const result = await this.runtime.navigate(compiled.url, compiled.action);
    return { url: result.url, mode };
  }
}
