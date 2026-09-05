import assert from "node:assert/strict";
import test from "node:test";
import {
  candidateDeployArgs,
  isImmutableImage,
  reconcilePlan,
  revisionGateFailures,
  trafficSnapshot
} from "../scripts/cloud-run-guarded-rollout.mjs";

function healthyRevision(image = "image") {
  return {
    metadata: {
      annotations: { "autoscaling.knative.dev/maxScale": "1" }
    },
    spec: {
      containerConcurrency: 1,
      timeoutSeconds: 300,
      containers: [{
        image,
        resources: { limits: { cpu: "1", memory: "2Gi" } }
      }]
    },
    status: {
      conditions: [
        { type: "Ready", status: "True" },
        { type: "ContainerHealthy", status: "True" }
      ]
    }
  };
}

test("guarded rollout accepts only immutable image digests", () => {
  const digest = `us-central1-docker.pkg.dev/p/r/i@sha256:${"a".repeat(64)}`;
  assert.equal(isImmutableImage(digest), true);
  assert.equal(isImmutableImage("us-central1-docker.pkg.dev/p/r/i:latest"), false);
  assert.equal(isImmutableImage(`image@sha256:${"g".repeat(64)}`), false);
});

test("traffic snapshot detects desired/status drift without treating tags as serving traffic", () => {
  const snapshot = trafficSnapshot({
    spec: {
      traffic: [
        { revisionName: "failed", percent: 100 },
        { revisionName: "old", tag: "old" }
      ]
    },
    status: {
      traffic: [
        { revisionName: "healthy", percent: 100 },
        { revisionName: "old", tag: "old", url: "https://old.example" }
      ]
    }
  });
  assert.deepEqual(snapshot, {
    desiredRevision: "failed",
    observedRevision: "healthy",
    staleDesiredTraffic: true
  });
});

test("stale desired traffic is reconciled only from an unready desired revision to the healthy observed revision", () => {
  const service = {
    spec: { traffic: [{ revisionName: "failed", percent: 100 }] },
    status: { traffic: [{ revisionName: "healthy", percent: 100 }] }
  };
  const plan = reconcilePlan(service, { status: { conditions: [] } }, healthyRevision());
  assert.deepEqual(plan, {
    kind: "reconcile",
    desiredRevision: "failed",
    observedRevision: "healthy",
    staleDesiredTraffic: true,
    targetRevision: "healthy"
  });
  assert.throws(
    () => reconcilePlan(service, healthyRevision(), healthyRevision()),
    /both revisions are healthy/
  );
});

test("candidate deploy is always zero-traffic and pins production resource boundaries", () => {
  const image = `us-central1-docker.pkg.dev/p/r/i@sha256:${"b".repeat(64)}`;
  const args = candidateDeployArgs({
    service: "maps-browser-mcp",
    project: "mcp-runtime-ksk",
    region: "us-central1",
    image,
    suffix: "candidate170",
    tag: "candidate170",
    timeoutSeconds: 300
  });
  const joined = args.join(" ");
  for (const required of [
    "--no-traffic",
    `--image ${image}`,
    "--concurrency 1",
    "--max-instances 1",
    "--cpu 1",
    "--memory 2Gi",
    "--timeout 300",
    "--revision-suffix candidate170",
    "--tag candidate170"
  ]) {
    assert.ok(joined.includes(required), `missing ${required}`);
  }
});

test("candidate revision gate requires readiness, capacity, timeout, and exact digest", () => {
  const image = `us-central1-docker.pkg.dev/p/r/i@sha256:${"c".repeat(64)}`;
  assert.deepEqual(revisionGateFailures(healthyRevision(image), { image, timeoutSeconds: 300 }), []);
  const bad = healthyRevision("other");
  bad.status.conditions = [];
  bad.spec.containerConcurrency = 2;
  assert.deepEqual(
    revisionGateFailures(bad, { image, timeoutSeconds: 300 }),
    ["Ready=True", "ContainerHealthy=True", "concurrency=1", "immutable image digest match"]
  );
});
