export type StoppedBrowserProfileCheckpointReason = "credential_safe_sign_in";

export interface StoppedBrowserProfileCheckpointContext {
  reason: StoppedBrowserProfileCheckpointReason;
}

export interface StoppedBrowserProfileCheckpointModule {
  /**
   * Optional deployment-owned opaque round-trip performed only while both Human and Agent browsers
   * are stopped. This may replace the local profile directory with a fresh restored copy, but must
   * not publish an unverified durable profile as current.
   */
  prepareStoppedBrowserProfileForVerification?(
    context: StoppedBrowserProfileCheckpointContext
  ): void | Promise<void>;
  /** Publish/checkpoint the profile only after fresh Agent signed-in verification succeeds. */
  checkpointStoppedBrowserProfile(
    context: StoppedBrowserProfileCheckpointContext
  ): void | Promise<void>;
}

export type StoppedBrowserProfilePreparationHook = (
  context: StoppedBrowserProfileCheckpointContext
) => Promise<void>;

export type StoppedBrowserProfileCheckpointHook = (
  context: StoppedBrowserProfileCheckpointContext
) => Promise<void>;

function assertSupportedContext(context: StoppedBrowserProfileCheckpointContext): void {
  if (context.reason !== "credential_safe_sign_in") {
    throw new Error("Unsupported stopped browser profile checkpoint reason");
  }
}

function createStoppedBrowserProfileModuleLoader(
  moduleSpecifier: string | undefined
): () => Promise<StoppedBrowserProfileCheckpointModule | undefined> {
  if (!moduleSpecifier) return async () => undefined;
  let modulePromise: Promise<StoppedBrowserProfileCheckpointModule> | undefined;
  return async () => {
    modulePromise ??= import(moduleSpecifier).then((value: unknown) => {
      const candidate = value as Partial<StoppedBrowserProfileCheckpointModule> | undefined;
      if (!candidate || typeof candidate.checkpointStoppedBrowserProfile !== "function") {
        throw new Error(
          `Browser profile checkpoint module ${moduleSpecifier} must export checkpointStoppedBrowserProfile()`
        );
      }
      if (
        candidate.prepareStoppedBrowserProfileForVerification !== undefined &&
        typeof candidate.prepareStoppedBrowserProfileForVerification !== "function"
      ) {
        throw new Error(
          `Browser profile checkpoint module ${moduleSpecifier} prepareStoppedBrowserProfileForVerification must be a function when provided`
        );
      }
      return candidate as StoppedBrowserProfileCheckpointModule;
    });
    return modulePromise;
  };
}

export function createStoppedBrowserProfilePreparationHook(
  moduleSpecifier: string | undefined
): StoppedBrowserProfilePreparationHook {
  const load = createStoppedBrowserProfileModuleLoader(moduleSpecifier);
  return async (context) => {
    assertSupportedContext(context);
    const provider = await load();
    await provider?.prepareStoppedBrowserProfileForVerification?.({ reason: context.reason });
  };
}

export function createStoppedBrowserProfileCheckpointHook(
  moduleSpecifier: string | undefined
): StoppedBrowserProfileCheckpointHook {
  const load = createStoppedBrowserProfileModuleLoader(moduleSpecifier);
  return async (context) => {
    assertSupportedContext(context);
    const provider = await load();
    await provider?.checkpointStoppedBrowserProfile({ reason: context.reason });
  };
}
