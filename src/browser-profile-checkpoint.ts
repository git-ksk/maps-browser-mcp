export type StoppedBrowserProfileCheckpointReason = "credential_safe_sign_in";

export interface StoppedBrowserProfileCheckpointContext {
  reason: StoppedBrowserProfileCheckpointReason;
}

export interface StoppedBrowserProfileCheckpointModule {
  checkpointStoppedBrowserProfile(
    context: StoppedBrowserProfileCheckpointContext
  ): void | Promise<void>;
}

export type StoppedBrowserProfileCheckpointHook = (
  context: StoppedBrowserProfileCheckpointContext
) => Promise<void>;

export function createStoppedBrowserProfileCheckpointHook(
  moduleSpecifier: string | undefined
): StoppedBrowserProfileCheckpointHook {
  if (!moduleSpecifier) return async () => {};

  let modulePromise: Promise<StoppedBrowserProfileCheckpointModule> | undefined;
  const load = async (): Promise<StoppedBrowserProfileCheckpointModule> => {
    modulePromise ??= import(moduleSpecifier).then((value: unknown) => {
      const candidate = value as Partial<StoppedBrowserProfileCheckpointModule> | undefined;
      if (!candidate || typeof candidate.checkpointStoppedBrowserProfile !== "function") {
        throw new Error(
          `Browser profile checkpoint module ${moduleSpecifier} must export checkpointStoppedBrowserProfile()`
        );
      }
      return candidate as StoppedBrowserProfileCheckpointModule;
    });
    return modulePromise;
  };

  return async (context) => {
    if (context.reason !== "credential_safe_sign_in") {
      throw new Error("Unsupported stopped browser profile checkpoint reason");
    }
    const provider = await load();
    await provider.checkpointStoppedBrowserProfile({ reason: context.reason });
  };
}
