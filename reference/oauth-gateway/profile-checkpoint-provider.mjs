import {
  loadProfileSnapshotConfig,
  promoteProfileCandidate,
  stageProfileCandidate
} from "./profile-snapshot.mjs";

function assertCredentialSafeContext(context, operation) {
  if (!context || context.reason !== "credential_safe_sign_in") {
    throw new Error(`unsupported stopped browser profile ${operation} reason`);
  }
}

export async function stageStoppedBrowserProfileCandidate(context) {
  assertCredentialSafeContext(context, "candidate staging");
  const config = loadProfileSnapshotConfig();
  if (!config.enabled) {
    throw new Error("MAPS_PROFILE_SNAPSHOT_BUCKET is required for the Cloud Run profile provider");
  }
  const result = await stageProfileCandidate(config);
  return result.candidate;
}

export async function promoteStoppedBrowserProfileCandidate(context, candidate) {
  assertCredentialSafeContext(context, "candidate promotion");
  const config = loadProfileSnapshotConfig();
  if (!config.enabled) {
    throw new Error("MAPS_PROFILE_SNAPSHOT_BUCKET is required for the Cloud Run profile provider");
  }
  await promoteProfileCandidate(config, candidate);
}
