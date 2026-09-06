export type StoppedBrowserProfileCheckpointReason = "credential_safe_sign_in";

export interface StoppedBrowserProfileCheckpointContext {
  reason: StoppedBrowserProfileCheckpointReason;
}

export interface StoppedBrowserProfileCandidateValidation {
  archiveEntries: number;
  requiredProfileFiles: number;
  sqliteDatabasesChecked: number;
}

export interface StoppedBrowserProfileCandidate {
  object: string;
  generation: string;
  bytes: number;
  sha256: string;
  createdAt: string;
  basePointerGeneration: string;
  validation: StoppedBrowserProfileCandidateValidation;
}

export interface StoppedBrowserProfileCheckpointModule {
  /**
   * Preferred two-phase deployment contract. Stage one stopped-profile candidate without changing
   * the durable current pointer and without mutating the local profile directory.
   */
  stageStoppedBrowserProfileCandidate?(
    context: StoppedBrowserProfileCheckpointContext
  ): StoppedBrowserProfileCandidate | Promise<StoppedBrowserProfileCandidate>;
  /** Promote only the exact staged candidate after fresh Agent stable signed-in verification. */
  promoteStoppedBrowserProfileCandidate?(
    context: StoppedBrowserProfileCheckpointContext,
    candidate: StoppedBrowserProfileCandidate
  ): void | Promise<void>;

  /**
   * Legacy compatibility seam. A deployment may prepare a stopped profile before verification, but
   * it must not publish an unverified durable profile as current.
   */
  prepareStoppedBrowserProfileForVerification?(
    context: StoppedBrowserProfileCheckpointContext
  ): void | Promise<void>;
  /** Legacy one-phase publish/checkpoint hook retained for compatible non-candidate providers. */
  checkpointStoppedBrowserProfile?(
    context: StoppedBrowserProfileCheckpointContext
  ): void | Promise<void>;
}

export type StoppedBrowserProfilePreparationHook = (
  context: StoppedBrowserProfileCheckpointContext
) => Promise<StoppedBrowserProfileCandidate | undefined>;

export type StoppedBrowserProfileCheckpointHook = (
  context: StoppedBrowserProfileCheckpointContext,
  candidate?: StoppedBrowserProfileCandidate
) => Promise<void>;

function assertSupportedContext(context: StoppedBrowserProfileCheckpointContext): void {
  if (context.reason !== "credential_safe_sign_in") {
    throw new Error("Unsupported stopped browser profile checkpoint reason");
  }
}

function assertSafeInteger(value: unknown, field: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`Browser profile candidate ${field} must be a non-negative safe integer`);
  }
}

function assertDecimalGeneration(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new Error(`Browser profile candidate ${field} must be a decimal generation string`);
  }
}

function assertExactKeys(value: object, allowed: readonly string[], field: string): void {
  const allowedSet = new Set(allowed);
  const extra = Object.keys(value).filter((key) => !allowedSet.has(key));
  if (extra.length > 0) {
    throw new Error(`Browser profile candidate ${field} contains unsupported metadata fields`);
  }
}

function validateCandidateMetadata(value: unknown): StoppedBrowserProfileCandidate {
  if (!value || typeof value !== "object") {
    throw new Error("Browser profile candidate metadata is required");
  }
  const candidate = value as Partial<StoppedBrowserProfileCandidate>;
  assertExactKeys(
    candidate,
    ["object", "generation", "bytes", "sha256", "createdAt", "basePointerGeneration", "validation"],
    "record"
  );
  if (typeof candidate.object !== "string" || candidate.object.length === 0 || candidate.object.length > 1024) {
    throw new Error("Browser profile candidate object must be a bounded non-empty string");
  }
  assertDecimalGeneration(candidate.generation, "generation");
  assertSafeInteger(candidate.bytes, "bytes");
  if (typeof candidate.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(candidate.sha256)) {
    throw new Error("Browser profile candidate sha256 is invalid");
  }
  if (typeof candidate.createdAt !== "string" || Number.isNaN(Date.parse(candidate.createdAt))) {
    throw new Error("Browser profile candidate createdAt is invalid");
  }
  assertDecimalGeneration(candidate.basePointerGeneration, "basePointerGeneration");
  if (!candidate.validation || typeof candidate.validation !== "object") {
    throw new Error("Browser profile candidate validation metadata is required");
  }
  assertExactKeys(
    candidate.validation,
    ["archiveEntries", "requiredProfileFiles", "sqliteDatabasesChecked"],
    "validation"
  );
  assertSafeInteger(candidate.validation.archiveEntries, "validation.archiveEntries");
  assertSafeInteger(candidate.validation.requiredProfileFiles, "validation.requiredProfileFiles");
  assertSafeInteger(candidate.validation.sqliteDatabasesChecked, "validation.sqliteDatabasesChecked");
  return candidate as StoppedBrowserProfileCandidate;
}

function createStoppedBrowserProfileModuleLoader(
  moduleSpecifier: string | undefined
): () => Promise<StoppedBrowserProfileCheckpointModule | undefined> {
  if (!moduleSpecifier) return async () => undefined;
  let modulePromise: Promise<StoppedBrowserProfileCheckpointModule> | undefined;
  return async () => {
    modulePromise ??= import(moduleSpecifier).then((value: unknown) => {
      const candidate = value as Partial<StoppedBrowserProfileCheckpointModule> | undefined;
      if (!candidate) {
        throw new Error(`Browser profile checkpoint module ${moduleSpecifier} is invalid`);
      }
      const hasStage = candidate.stageStoppedBrowserProfileCandidate !== undefined;
      const hasPromote = candidate.promoteStoppedBrowserProfileCandidate !== undefined;
      if (hasStage !== hasPromote) {
        throw new Error(
          `Browser profile checkpoint module ${moduleSpecifier} must export stageStoppedBrowserProfileCandidate() and promoteStoppedBrowserProfileCandidate() together`
        );
      }
      if (hasStage) {
        if (typeof candidate.stageStoppedBrowserProfileCandidate !== "function") {
          throw new Error(
            `Browser profile checkpoint module ${moduleSpecifier} stageStoppedBrowserProfileCandidate must be a function`
          );
        }
        if (typeof candidate.promoteStoppedBrowserProfileCandidate !== "function") {
          throw new Error(
            `Browser profile checkpoint module ${moduleSpecifier} promoteStoppedBrowserProfileCandidate must be a function`
          );
        }
      } else if (typeof candidate.checkpointStoppedBrowserProfile !== "function") {
        throw new Error(
          `Browser profile checkpoint module ${moduleSpecifier} must export the candidate stage/promote pair or checkpointStoppedBrowserProfile()`
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
    if (!provider) return undefined;
    if (provider.stageStoppedBrowserProfileCandidate) {
      return validateCandidateMetadata(
        await provider.stageStoppedBrowserProfileCandidate({ reason: context.reason })
      );
    }
    await provider.prepareStoppedBrowserProfileForVerification?.({ reason: context.reason });
    return undefined;
  };
}

export function createStoppedBrowserProfileCheckpointHook(
  moduleSpecifier: string | undefined
): StoppedBrowserProfileCheckpointHook {
  const load = createStoppedBrowserProfileModuleLoader(moduleSpecifier);
  return async (context, candidate) => {
    assertSupportedContext(context);
    const provider = await load();
    if (!provider) return;
    if (provider.promoteStoppedBrowserProfileCandidate) {
      if (!candidate) throw new Error("Browser profile candidate is required for promotion");
      await provider.promoteStoppedBrowserProfileCandidate(
        { reason: context.reason },
        validateCandidateMetadata(candidate)
      );
      return;
    }
    await provider.checkpointStoppedBrowserProfile?.({ reason: context.reason });
  };
}
