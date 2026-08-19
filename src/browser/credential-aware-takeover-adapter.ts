import type { TakeoverBrowserAdapter } from "mcp-execution-handoff/browser-takeover";
import { CuaHumanTakeoverAdapter } from "./cua-human-takeover-adapter.js";

export class CredentialAwareTakeoverAdapter implements TakeoverBrowserAdapter {
  constructor(
    private readonly standard: TakeoverBrowserAdapter,
    private readonly credentialSafe: CuaHumanTakeoverAdapter
  ) {}

  captureHumanTakeoverFrame(interventionId: string, epoch: number) {
    return this.backend(interventionId, epoch).captureHumanTakeoverFrame(interventionId, epoch);
  }
  streamHumanTakeoverFrames(interventionId: string, epoch: number, signal: AbortSignal) {
    const backend = this.backend(interventionId, epoch);
    return backend.streamHumanTakeoverFrames?.(interventionId, epoch, signal);
  }
  tapHumanTakeover(interventionId: string, epoch: number, x: number, y: number) {
    return this.backend(interventionId, epoch).tapHumanTakeover(interventionId, epoch, x, y);
  }
  scrollHumanTakeover(interventionId: string, epoch: number, deltaY: number) {
    return this.backend(interventionId, epoch).scrollHumanTakeover(interventionId, epoch, deltaY);
  }
  insertHumanTakeoverText(interventionId: string, epoch: number, text: string) {
    return this.backend(interventionId, epoch).insertHumanTakeoverText(interventionId, epoch, text);
  }
  pressHumanTakeoverKey(interventionId: string, epoch: number, key: string) {
    return this.backend(interventionId, epoch).pressHumanTakeoverKey(interventionId, epoch, key);
  }

  private backend(interventionId: string, epoch: number): TakeoverBrowserAdapter {
    return this.credentialSafe.owns(interventionId, epoch) ? this.credentialSafe : this.standard;
  }
}
