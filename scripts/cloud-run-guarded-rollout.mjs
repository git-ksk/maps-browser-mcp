import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const DEFAULT_PROJECT = "mcp-runtime-ksk";
const DEFAULT_REGION = "us-central1";
const DEFAULT_SERVICE = "maps-browser-mcp";

function required(value, name) {
  assert(typeof value === "string" && value.trim(), `${name} is required`);
  return value.trim();
}

export function isImmutableImage(value) {
  return typeof value === "string" && /@sha256:[0-9a-f]{64}$/i.test(value);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    env: options.env ? { ...process.env, ...options.env } : process.env,
    maxBuffer: 16 * 1024 * 1024
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.slice(0, 3).join(" ")} failed with exit ${result.status ?? "unknown"}`);
  }
  const stdout = result.stdout?.trim() || "";
  return options.json ? JSON.parse(stdout || "null") : stdout;
}

function gcloudJson(args) {
  return run("gcloud", [...args, "--format=json"], { json: true });
}

function gcloud(args) {
  return run("gcloud", [...args, "--quiet"]);
}

function parseArgs(argv) {
  let command;
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!command && !token.startsWith("--")) {
      command = token;
      continue;
    }
    if (!token.startsWith("--")) throw new Error(`Unexpected positional argument: ${token}`);
    const eq = token.indexOf("=");
    if (eq > 2) {
      args[token.slice(2, eq)] = token.slice(eq + 1);
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) throw new Error(`Missing value for --${key}`);
    args[key] = next;
    i += 1;
  }
  return { command, args };
}

export function trafficSnapshot(service) {
  const spec = Array.isArray(service?.spec?.traffic) ? service.spec.traffic : [];
  const status = Array.isArray(service?.status?.traffic) ? service.status.traffic : [];
  const desired = spec.filter((entry) => Number(entry?.percent || 0) > 0);
  const observed = status.filter((entry) => Number(entry?.percent || 0) > 0);
  assert.equal(desired.length, 1, "desired traffic must have exactly one serving revision");
  assert.equal(observed.length, 1, "observed traffic must have exactly one serving revision");
  assert.equal(Number(desired[0].percent), 100, "desired traffic must be 100% on one revision");
  assert.equal(Number(observed[0].percent), 100, "observed traffic must be 100% on one revision");
  const desiredRevision = required(desired[0].revisionName, "desired serving revision");
  const observedRevision = required(observed[0].revisionName, "observed serving revision");
  return {
    desiredRevision,
    observedRevision,
    staleDesiredTraffic: desiredRevision !== observedRevision
  };
}

function conditionTrue(revision, type) {
  return Array.isArray(revision?.status?.conditions) && revision.status.conditions.some(
    (condition) => condition?.type === type && condition?.status === "True"
  );
}

export function revisionGateFailures(revision, { image, timeoutSeconds }) {
  const failures = [];
  if (!conditionTrue(revision, "Ready")) failures.push("Ready=True");
  if (!conditionTrue(revision, "ContainerHealthy")) failures.push("ContainerHealthy=True");
  if (Number(revision?.spec?.containerConcurrency) !== 1) failures.push("concurrency=1");
  if (String(revision?.metadata?.annotations?.["autoscaling.knative.dev/maxScale"] ?? "") !== "1") failures.push("maxScale=1");
  if (String(revision?.spec?.containers?.[0]?.resources?.limits?.cpu ?? "") !== "1") failures.push("cpu=1");
  if (String(revision?.spec?.containers?.[0]?.resources?.limits?.memory ?? "") !== "2Gi") failures.push("memory=2Gi");
  if (Number(revision?.spec?.timeoutSeconds) !== Number(timeoutSeconds)) failures.push(`timeout=${timeoutSeconds}s`);
  if (image && String(revision?.spec?.containers?.[0]?.image ?? "") !== image) failures.push("immutable image digest match");
  return failures;
}

export function candidateDeployArgs({ service, project, region, image, suffix, tag, timeoutSeconds }) {
  assert(isImmutableImage(image), "candidate image must use an immutable @sha256 digest");
  assert(/^[a-z][a-z0-9-]{0,62}$/.test(required(suffix, "revision suffix")), "revision suffix is invalid");
  assert(/^[a-z][a-z0-9-]{0,62}$/.test(required(tag, "candidate tag")), "candidate tag is invalid");
  assert(Number.isSafeInteger(Number(timeoutSeconds)) && Number(timeoutSeconds) > 0, "timeoutSeconds must be positive");
  return [
    "run", "deploy", service,
    "--project", project,
    "--region", region,
    "--image", image,
    "--revision-suffix", suffix,
    "--tag", tag,
    "--no-traffic",
    "--concurrency", "1",
    "--max-instances", "1",
    "--cpu", "1",
    "--memory", "2Gi",
    "--timeout", String(timeoutSeconds)
  ];
}

function describeService(project, region, service) {
  return gcloudJson(["run", "services", "describe", service, "--project", project, "--region", region]);
}

function describeRevision(project, region, revision) {
  return gcloudJson(["run", "revisions", "describe", revision, "--project", project, "--region", region]);
}

function revisionHealthy(revision) {
  return conditionTrue(revision, "Ready") && conditionTrue(revision, "ContainerHealthy");
}

export function reconcilePlan(serviceJson, desiredRevisionJson, observedRevisionJson) {
  const traffic = trafficSnapshot(serviceJson);
  if (!traffic.staleDesiredTraffic) return { kind: "none", ...traffic };
  assert(revisionHealthy(observedRevisionJson), "observed production revision is not healthy");
  assert(!revisionHealthy(desiredRevisionJson), "desired/status traffic differ while both revisions are healthy; refusing ambiguous reconciliation");
  return { kind: "reconcile", ...traffic, targetRevision: traffic.observedRevision };
}

function reconcileDesiredTraffic({ project, region, service, serviceJson }) {
  const current = trafficSnapshot(serviceJson);
  if (!current.staleDesiredTraffic) return current;
  const desired = describeRevision(project, region, current.desiredRevision);
  const observed = describeRevision(project, region, current.observedRevision);
  const plan = reconcilePlan(serviceJson, desired, observed);
  assert.equal(plan.kind, "reconcile");
  gcloud([
    "run", "services", "update-traffic", service,
    "--project", project,
    "--region", region,
    "--to-revisions", `${plan.targetRevision}=100`
  ]);
  const after = trafficSnapshot(describeService(project, region, service));
  assert.equal(after.desiredRevision, current.observedRevision, "desired traffic reconciliation did not converge");
  assert.equal(after.observedRevision, current.observedRevision, "healthy production traffic changed during reconciliation");
  return after;
}

function tagUrl(serviceJson, tag, revision) {
  const traffic = Array.isArray(serviceJson?.status?.traffic) ? serviceJson.status.traffic : [];
  return traffic.find((entry) => entry?.tag === tag && entry?.revisionName === revision)?.url;
}

function startupErrorCount({ project, service, revision, createdAt }) {
  const filter = [
    'resource.type="cloud_run_revision"',
    `resource.labels.service_name="${service}"`,
    `resource.labels.revision_name="${revision}"`,
    `timestamp>="${createdAt}"`,
    "severity>=ERROR"
  ].join(" AND ");
  const rows = gcloudJson(["logging", "read", filter, "--project", project, "--limit", "200"]);
  return Array.isArray(rows) ? rows.length : 0;
}

function publicOriginPreflight(advertisedOrigin, requestOrigin) {
  run(process.execPath, ["scripts/cloud-run-public-origin-preflight.mjs"], {
    env: {
      MCP_PUBLIC_BASE_URL: advertisedOrigin,
      MAPS_TAKEOVER_PUBLIC_BASE_URL: advertisedOrigin,
      MCP_PREFLIGHT_REQUEST_ORIGIN: requestOrigin
    }
  });
}

function verifyCandidate({ project, region, service, revisionName, image, timeoutSeconds, advertisedOrigin, requestOrigin }) {
  const revision = describeRevision(project, region, revisionName);
  const failures = revisionGateFailures(revision, { image, timeoutSeconds });
  assert.deepEqual(failures, [], `candidate gates failed: ${failures.join(", ")}`);
  const createdAt = required(revision?.metadata?.creationTimestamp, "candidate creation timestamp");
  assert.equal(startupErrorCount({ project, service, revision: revisionName, createdAt }), 0, "candidate has ERROR-level logs before cutover");
  publicOriginPreflight(advertisedOrigin, requestOrigin);
}

function emit(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function common(args, env) {
  return {
    project: args.project || env.MAPS_ROLLOUT_PROJECT || DEFAULT_PROJECT,
    region: args.region || env.MAPS_ROLLOUT_REGION || DEFAULT_REGION,
    service: args.service || env.MAPS_ROLLOUT_SERVICE || DEFAULT_SERVICE
  };
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const { command, args } = parseArgs(argv);
  assert(["inspect", "prepare", "cutover", "rollback"].includes(command), "command must be inspect, prepare, cutover, or rollback");
  const cfg = common(args, env);
  let serviceJson = describeService(cfg.project, cfg.region, cfg.service);
  const canonicalOrigin = required(serviceJson?.status?.url, "canonical service URL");
  const timeoutSeconds = Number(serviceJson?.spec?.template?.spec?.timeoutSeconds);

  if (command === "inspect") {
    emit({ command, service: cfg.service, canonicalOrigin, timeoutSeconds, ...trafficSnapshot(serviceJson) });
    return;
  }

  if (command === "prepare") {
    const image = args.image || env.MAPS_ROLLOUT_IMAGE;
    assert(isImmutableImage(image), "prepare requires immutable --image @sha256 digest");
    const suffix = required(args.suffix || env.MAPS_ROLLOUT_REVISION_SUFFIX, "--suffix");
    const tag = required(args.tag || env.MAPS_ROLLOUT_TAG, "--tag");
    const production = reconcileDesiredTraffic({ ...cfg, serviceJson });
    const priorRevision = production.observedRevision;
    gcloud(candidateDeployArgs({ ...cfg, image, suffix, tag, timeoutSeconds }));
    serviceJson = describeService(cfg.project, cfg.region, cfg.service);
    const candidateRevision = required(serviceJson?.status?.latestCreatedRevisionName, "candidate revision");
    assert.notEqual(candidateRevision, priorRevision, "candidate deploy did not create a new revision");
    const candidateTagUrl = required(tagUrl(serviceJson, tag, candidateRevision), "candidate tagged URL");
    verifyCandidate({ ...cfg, revisionName: candidateRevision, image, timeoutSeconds, advertisedOrigin: canonicalOrigin, requestOrigin: candidateTagUrl });
    const after = trafficSnapshot(describeService(cfg.project, cfg.region, cfg.service));
    assert.equal(after.desiredRevision, priorRevision, "prepare changed desired production traffic");
    assert.equal(after.observedRevision, priorRevision, "prepare changed observed production traffic");
    emit({
      command,
      priorRevision,
      candidateRevision,
      image,
      candidateTagUrl,
      canonicalOrigin,
      productionTrafficChanged: false,
      next: "Run cutover with the exact prior/candidate/image/tag values after Human acceptance."
    });
    return;
  }

  if (command === "cutover") {
    const image = args.image || env.MAPS_ROLLOUT_IMAGE;
    assert(isImmutableImage(image), "cutover requires immutable --image @sha256 digest");
    const priorRevision = required(args.prior || env.MAPS_ROLLOUT_PRIOR_REVISION, "--prior");
    const candidateRevision = required(args.candidate || env.MAPS_ROLLOUT_CANDIDATE_REVISION, "--candidate");
    const tag = required(args.tag || env.MAPS_ROLLOUT_TAG, "--tag");
    const before = trafficSnapshot(serviceJson);
    assert.equal(before.desiredRevision, priorRevision, "desired production traffic moved since prepare");
    assert.equal(before.observedRevision, priorRevision, "observed production traffic moved since prepare");
    const candidateTagUrl = required(tagUrl(serviceJson, tag, candidateRevision), "candidate tagged URL");
    verifyCandidate({ ...cfg, revisionName: candidateRevision, image, timeoutSeconds, advertisedOrigin: canonicalOrigin, requestOrigin: candidateTagUrl });
    gcloud([
      "run", "services", "update-traffic", cfg.service,
      "--project", cfg.project,
      "--region", cfg.region,
      "--to-revisions", `${candidateRevision}=100`
    ]);
    serviceJson = describeService(cfg.project, cfg.region, cfg.service);
    const after = trafficSnapshot(serviceJson);
    assert.equal(after.desiredRevision, candidateRevision, "candidate did not receive desired 100% traffic");
    assert.equal(after.observedRevision, candidateRevision, "candidate did not receive observed 100% traffic");
    emit({ command, priorRevision, candidateRevision, image, canonicalOrigin, rollbackRevision: priorRevision });
    return;
  }

  const priorRevision = required(args.prior || env.MAPS_ROLLOUT_PRIOR_REVISION, "--prior");
  assert(revisionHealthy(describeRevision(cfg.project, cfg.region, priorRevision)), "rollback target is not Ready=True and ContainerHealthy=True");
  gcloud([
    "run", "services", "update-traffic", cfg.service,
    "--project", cfg.project,
    "--region", cfg.region,
    "--to-revisions", `${priorRevision}=100`
  ]);
  const after = trafficSnapshot(describeService(cfg.project, cfg.region, cfg.service));
  assert.equal(after.desiredRevision, priorRevision, "rollback desired traffic did not converge");
  assert.equal(after.observedRevision, priorRevision, "rollback observed traffic did not converge");
  emit({ command, priorRevision, restoredTrafficPercent: 100 });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
