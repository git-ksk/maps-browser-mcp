import {
  checkpointProfileToCloud,
  loadProfileSnapshotConfig,
  prepareProfileForFreshAgentVerification
} from "./profile-snapshot.mjs";

export async function prepareStoppedBrowserProfileForVerification(context) {
  if (!context || context.reason !== "credential_safe_sign_in") {
    throw new Error("unsupported stopped browser profile preparation reason");
  }
  const config = loadProfileSnapshotConfig();
  if (!config.enabled) {
    throw new Error("MAPS_PROFILE_SNAPSHOT_BUCKET is required for the Cloud Run profile provider");
  }
  await prepareProfileForFreshAgentVerification(config);
}

export async function checkpointStoppedBrowserProfile(context) {
  if (!context || context.reason !== "credential_safe_sign_in") {
    throw new Error("unsupported stopped browser profile checkpoint reason");
  }
  const config = loadProfileSnapshotConfig();
  if (!config.enabled) {
    throw new Error("MAPS_PROFILE_SNAPSHOT_BUCKET is required for the Cloud Run checkpoint provider");
  }
  await checkpointProfileToCloud(config);
}
