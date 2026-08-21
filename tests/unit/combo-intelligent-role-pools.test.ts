import assert from "node:assert/strict";
import test from "node:test";

import { parseAutoConfig } from "@omniroute/open-sse/services/combo/autoConfig.ts";
import {
  buildRolePoolFailoverOrder,
  resolveRolePoolCandidates,
} from "@omniroute/open-sse/services/combo/rolePools.ts";
import type { ResolvedComboTarget } from "@omniroute/open-sse/services/combo/types.ts";
import {
  DEFAULT_INTELLIGENT_WEIGHTS,
  buildIntelligentRoleModelOptions,
  mergeIntelligentRoutingBuilderConfig,
  normalizeIntelligentRolePoolConfig,
  normalizeIntelligentRoutingConfig,
  toggleIntelligentRoleModelRef,
} from "@/lib/combos/intelligentRouting";
import { normalizeComboModels } from "@/lib/combos/steps";
import { comboRuntimeConfigSchema } from "@/shared/validation/schemas/combo";

const modelSteps = [
  {
    id: "fast-connection-a",
    kind: "model",
    model: "provider/shared-model",
    providerId: "provider",
    connectionId: "connection-a",
    weight: 0,
  },
  {
    id: "strong-connection-b",
    kind: "model",
    model: "provider/shared-model",
    providerId: "provider",
    connectionId: "connection-b",
    weight: 0,
  },
  {
    id: "ordinary-step",
    kind: "model",
    model: "provider/ordinary-model",
    providerId: "provider",
    weight: 0,
  },
  { id: "nested-combo", kind: "combo-ref", comboName: "nested", weight: 0 },
] as const;

function target(stepId: string, connectionId: string, modelStr = "provider/shared-model") {
  return {
    kind: "model",
    stepId,
    executionKey: `${stepId}>${connectionId}`,
    modelStr,
    provider: "provider",
    providerId: "provider",
    connectionId,
    weight: 0,
    label: null,
  } satisfies ResolvedComboTarget;
}

test("role-pool config normalizes duplicates and removes stale or non-model step refs", () => {
  const normalized = normalizeIntelligentRolePoolConfig(
    {
      candidatePool: ["provider"],
      fastWorkerModelRefs: [
        " fast-connection-a ",
        "fast-connection-a",
        "missing-step",
        "nested-combo",
        42,
      ],
      strongReasoningModelRefs: ["strong-connection-b", "fast-connection-a"],
      adaptiveJudgeModelRef: " strong-connection-b ",
      timeoutMs: 30_000,
    },
    modelSteps
  );

  assert.deepEqual(normalized.fastWorkerModelRefs, ["fast-connection-a"]);
  assert.deepEqual(normalized.strongReasoningModelRefs, [
    "strong-connection-b",
    "fast-connection-a",
  ]);
  assert.equal(normalized.adaptiveJudgeModelRef, "strong-connection-b");
  assert.deepEqual(normalized.candidatePool, ["provider"]);
  assert.equal(normalized.timeoutMs, 30_000);
});

test("missing role pools preserve backward-compatible intelligent routing config", () => {
  const normalized = normalizeIntelligentRoutingConfig({ candidatePool: ["provider"] });

  assert.equal("fastWorkerModelRefs" in normalized, false);
  assert.equal("strongReasoningModelRefs" in normalized, false);
  assert.equal("adaptiveJudgeModelRef" in normalized, false);
});

test("builder merge removes role-weight overrides that switched back to inherited defaults", () => {
  const previous = {
    timeoutMs: 30_000,
    weights: DEFAULT_INTELLIGENT_WEIGHTS,
    fastWorkerWeights: { ...DEFAULT_INTELLIGENT_WEIGHTS, quota: 0.9 },
    strongReasoningWeights: { ...DEFAULT_INTELLIGENT_WEIGHTS, taskFit: 0.7 },
  };
  const next = normalizeIntelligentRoutingConfig({
    weights: DEFAULT_INTELLIGENT_WEIGHTS,
    strongReasoningWeights: previous.strongReasoningWeights,
  });

  const merged = mergeIntelligentRoutingBuilderConfig(previous, next);

  assert.equal("fastWorkerWeights" in merged, false);
  assert.deepEqual(merged.strongReasoningWeights, previous.strongReasoningWeights);
  assert.equal(merged.timeoutMs, 30_000, "unrelated Combo config must remain intact");
});

test("AI Judger accepts exactly one current Combo model Step and prunes stale refs", () => {
  const valid = normalizeIntelligentRolePoolConfig(
    { adaptiveJudgeModelRef: " strong-connection-b " },
    modelSteps
  );
  const stale = normalizeIntelligentRolePoolConfig(
    { adaptiveJudgeModelRef: "missing-step" },
    modelSteps
  );
  const nested = normalizeIntelligentRolePoolConfig(
    { adaptiveJudgeModelRef: "nested-combo" },
    modelSteps
  );

  assert.equal(valid.adaptiveJudgeModelRef, "strong-connection-b");
  assert.equal("adaptiveJudgeModelRef" in stale, false);
  assert.equal("adaptiveJudgeModelRef" in nested, false);
});

test("role-specific weight profiles normalize independently and remain optional", () => {
  const normalized = normalizeIntelligentRoutingConfig({
    weights: DEFAULT_INTELLIGENT_WEIGHTS,
    fastWorkerWeights: { ...DEFAULT_INTELLIGENT_WEIGHTS, latencyInv: 0.9 },
    strongReasoningWeights: { ...DEFAULT_INTELLIGENT_WEIGHTS, taskFit: 0.8 },
  });

  assert.equal(normalized.fastWorkerWeights?.latencyInv, 0.9);
  assert.equal(normalized.strongReasoningWeights?.taskFit, 0.8);
  assert.equal(
    "fastWorkerWeights" in
      normalizeIntelligentRoutingConfig({ weights: DEFAULT_INTELLIGENT_WEIGHTS }),
    false
  );
});

test("combo runtime schema accepts role pools and rejects malformed references", () => {
  const parsed = comboRuntimeConfigSchema.parse({
    fastWorkerModelRefs: ["fast-connection-a"],
    strongReasoningModelRefs: ["strong-connection-b", "fast-connection-a"],
    adaptiveJudgeModelRef: "ordinary-step",
  });

  assert.deepEqual(parsed.fastWorkerModelRefs, ["fast-connection-a"]);
  assert.equal(parsed.adaptiveJudgeModelRef, "ordinary-step");
  assert.equal(
    comboRuntimeConfigSchema.safeParse({ adaptiveJudgeModelRef: ["ordinary-step"] }).success,
    false
  );
  assert.equal(comboRuntimeConfigSchema.safeParse({ fastWorkerModelRefs: [""] }).success, false);
  assert.equal(
    comboRuntimeConfigSchema.safeParse({ strongReasoningModelRefs: "strong-connection-b" }).success,
    false
  );
  assert.equal(
    comboRuntimeConfigSchema.safeParse({
      fastWorkerWeights: { ...DEFAULT_INTELLIGENT_WEIGHTS, latencyInv: 0.8 },
      strongReasoningWeights: { ...DEFAULT_INTELLIGENT_WEIGHTS, taskFit: 0.7 },
    }).success,
    true
  );
});

test("runtime resolution preserves connection-specific identity and overlapping membership", () => {
  const eligibleTargets = [
    target("fast-connection-a", "connection-a"),
    target("strong-connection-b", "connection-b"),
    target("ordinary-step", "connection-c", "provider/ordinary-model"),
  ];
  const pools = resolveRolePoolCandidates(
    {
      fastWorkerModelRefs: ["fast-connection-a"],
      strongReasoningModelRefs: ["strong-connection-b", "fast-connection-a"],
    },
    eligibleTargets
  );

  assert.deepEqual(
    pools.fastWorker.map((entry) => entry.connectionId),
    ["connection-a"]
  );
  assert.deepEqual(
    pools.strongReasoning.map((entry) => entry.connectionId),
    ["connection-a", "connection-b"]
  );
  assert.deepEqual(
    pools.unassigned.map((entry) => entry.stepId),
    ["ordinary-step"]
  );
});

test("a selected AI Judger stays judge-only unless it is explicitly assigned a worker role", () => {
  const fast = target("fast-connection-a", "connection-a");
  const strong = target("strong-connection-b", "connection-b");
  const judge = target("ordinary-step", "connection-c", "provider/judge-model");
  const pools = resolveRolePoolCandidates(
    {
      fastWorkerModelRefs: ["fast-connection-a"],
      strongReasoningModelRefs: ["strong-connection-b"],
      adaptiveJudgeModelRef: "ordinary-step",
    },
    [fast, strong, judge]
  );

  assert.deepEqual(
    pools.all.map((entry) => entry.stepId),
    ["fast-connection-a", "strong-connection-b"]
  );
  assert.deepEqual(pools.unassigned, []);
  assert.deepEqual(
    buildRolePoolFailoverOrder(pools, "strongReasoning").map((entry) => entry.stepId),
    ["strong-connection-b", "fast-connection-a"]
  );
});

test("a Judger explicitly assigned to Strong Reasoning may also serve as a worker", () => {
  const judge = target("ordinary-step", "connection-c", "provider/judge-model");
  const pools = resolveRolePoolCandidates(
    {
      strongReasoningModelRefs: ["ordinary-step"],
      adaptiveJudgeModelRef: "ordinary-step",
    },
    [judge]
  );

  assert.deepEqual(
    pools.strongReasoning.map((entry) => entry.stepId),
    ["ordinary-step"]
  );
  assert.deepEqual(
    pools.all.map((entry) => entry.stepId),
    ["ordinary-step"]
  );
});

test("runtime resolution only returns eligible targets and builds a finite cross-role fallback", () => {
  const strong = target("strong-connection-b", "connection-b");
  const ordinary = target("ordinary-step", "connection-c", "provider/ordinary-model");
  const pools = resolveRolePoolCandidates(
    {
      fastWorkerModelRefs: ["fast-connection-a"],
      strongReasoningModelRefs: ["strong-connection-b"],
    },
    [strong, ordinary]
  );
  const ordered = buildRolePoolFailoverOrder(pools, "fastWorker");

  assert.deepEqual(pools.fastWorker, []);
  assert.deepEqual(
    ordered.map((entry) => entry.stepId),
    ["strong-connection-b", "ordinary-step"]
  );
  assert.equal(new Set(ordered.map((entry) => entry.executionKey)).size, ordered.length);
});

test("auto config exposes resolved role pools without changing scoring weights or ordering", () => {
  const fast = target("fast-connection-a", "connection-a");
  const ordinary = target("ordinary-step", "connection-c", "provider/ordinary-model");
  const parsed = parseAutoConfig(
    {
      name: "adaptive-foundation",
      models: modelSteps,
      config: { fastWorkerModelRefs: ["fast-connection-a"] },
    },
    [fast, ordinary]
  );

  assert.deepEqual(
    parsed.rolePools.fastWorker.map((entry) => entry.stepId),
    ["fast-connection-a"]
  );
  assert.deepEqual(
    parsed.rolePools.unassigned.map((entry) => entry.stepId),
    ["ordinary-step"]
  );
});

test("role selector options come only from this Combo's explicit model Steps", () => {
  const options = buildIntelligentRoleModelOptions(modelSteps);

  assert.deepEqual(
    options.map((option) => ({
      stepId: option.stepId,
      model: option.model,
      connectionId: option.connectionId,
    })),
    [
      {
        stepId: "fast-connection-a",
        model: "provider/shared-model",
        connectionId: "connection-a",
      },
      {
        stepId: "strong-connection-b",
        model: "provider/shared-model",
        connectionId: "connection-b",
      },
      {
        stepId: "ordinary-step",
        model: "provider/ordinary-model",
        connectionId: null,
      },
    ]
  );
});

test("materialized draft Step IDs survive reorder and keep role references stable", () => {
  const materialized = normalizeComboModels(
    [
      {
        kind: "model",
        model: "provider/fast",
        providerId: "provider",
        connectionId: "connection-a",
        weight: 0,
      },
      {
        kind: "model",
        model: "provider/strong",
        providerId: "provider",
        connectionId: "connection-b",
        weight: 0,
      },
    ],
    { comboName: "adaptive-combo" }
  );
  const fastStepId = materialized[0]?.id;
  const reordered = normalizeComboModels([materialized[1], materialized[0]], {
    comboName: "renamed-combo",
  });

  assert.ok(fastStepId);
  assert.equal(reordered[1]?.id, fastStepId);
  assert.deepEqual(
    buildIntelligentRoleModelOptions(reordered).map((option) => option.stepId),
    [materialized[1]?.id, fastStepId]
  );
});

test("role-selector toggles prune stale refs and support independent multi-selection", () => {
  const available = ["fast-connection-a", "strong-connection-b"];
  const added = toggleIntelligentRoleModelRef(
    ["missing-step", "fast-connection-a"],
    "strong-connection-b",
    available
  );
  const removed = toggleIntelligentRoleModelRef(added, "fast-connection-a", available);

  assert.deepEqual(added, ["fast-connection-a", "strong-connection-b"]);
  assert.deepEqual(removed, ["strong-connection-b"]);
});
