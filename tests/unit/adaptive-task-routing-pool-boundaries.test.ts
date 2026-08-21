import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRolePoolFailoverOrder,
  resolveRolePoolCandidates,
} from "@omniroute/open-sse/services/combo/rolePools.ts";
import { applyPromptCacheAffinity } from "@omniroute/open-sse/services/combo/promptCacheAffinity.ts";
import type { ResolvedComboTarget } from "@omniroute/open-sse/services/combo/types.ts";
import {
  classifyTask,
  reorderByTaskWeight,
} from "@omniroute/open-sse/services/taskAwareRouting.ts";

function target(stepId: string, modelStr: string): ResolvedComboTarget {
  return {
    kind: "model",
    stepId,
    executionKey: `${stepId}>connection`,
    modelStr,
    provider: "provider",
    providerId: "provider",
    connectionId: `${stepId}-connection`,
    weight: 0,
    label: null,
  };
}

function fallbackTiers(targets: ResolvedComboTarget[]): number[] {
  return targets.map(
    (target) =>
      (target as ResolvedComboTarget & { _omnirouteAdaptiveFallbackTier?: number })
        ._omnirouteAdaptiveFallbackTier ?? -1
  );
}

test("Strong routing exhausts Strong pool, then Fast pool, then General", () => {
  const strongA = target("strong-a", "provider/ultra-a");
  const strongB = target("strong-b", "provider/ultra-b");
  const fastA = target("fast-a", "provider/flash-a");
  const generalA = target("general-a", "provider/general-a");
  const pools = resolveRolePoolCandidates(
    {
      strongReasoningModelRefs: ["strong-a", "strong-b"],
      fastWorkerModelRefs: ["fast-a"],
    },
    [generalA, fastA, strongB, strongA]
  );

  const ordered = buildRolePoolFailoverOrder(pools, "strongReasoning");

  assert.deepEqual(
    ordered.map((entry) => entry.stepId),
    ["strong-b", "strong-a", "fast-a", "general-a"]
  );
  assert.deepEqual(fallbackTiers(ordered), [0, 0, 1, 2]);
});

test("Fast routing exhausts Fast pool, then Strong pool, then General", () => {
  const strongA = target("strong-a", "provider/ultra-a");
  const fastA = target("fast-a", "provider/flash-a");
  const fastB = target("fast-b", "provider/flash-b");
  const generalA = target("general-a", "provider/general-a");
  const pools = resolveRolePoolCandidates(
    {
      strongReasoningModelRefs: ["strong-a"],
      fastWorkerModelRefs: ["fast-a", "fast-b"],
    },
    [strongA, generalA, fastB, fastA]
  );

  const ordered = buildRolePoolFailoverOrder(pools, "fastWorker");

  assert.deepEqual(
    ordered.map((entry) => entry.stepId),
    ["fast-b", "fast-a", "strong-a", "general-a"]
  );
  assert.deepEqual(fallbackTiers(ordered), [0, 0, 1, 2]);
});

test("task-route may rearrange models inside a pool but never crosses adaptive pool boundaries", () => {
  const pools = resolveRolePoolCandidates(
    {
      strongReasoningModelRefs: ["strong-mini", "strong-ultra"],
      fastWorkerModelRefs: ["fast-heavy", "fast-lite"],
    },
    [
      target("general-a", "provider/general"),
      target("fast-heavy", "provider/gpt-5-pro"),
      target("strong-mini", "provider/mini"),
      target("fast-lite", "provider/flash"),
      target("strong-ultra", "provider/ultra"),
    ]
  );
  const fallback = buildRolePoolFailoverOrder(pools, "strongReasoning");
  const task = classifyTask({
    messages: [{ role: "user", content: "debug architecture and implement this end-to-end" }],
    reasoning_effort: "high",
  });

  const reordered = reorderByTaskWeight(fallback, task);

  assert.deepEqual(fallbackTiers(reordered), [0, 0, 1, 1, 2]);
  assert.deepEqual(
    new Set(reordered.slice(0, 2).map((entry) => entry.stepId)),
    new Set(["strong-mini", "strong-ultra"])
  );
  assert.deepEqual(
    new Set(reordered.slice(2, 4).map((entry) => entry.stepId)),
    new Set(["fast-heavy", "fast-lite"])
  );
  assert.equal(reordered[4]?.stepId, "general-a");
});

test("prompt-cache affinity cannot promote a fallback from a later adaptive pool", () => {
  const pools = resolveRolePoolCandidates(
    {
      strongReasoningModelRefs: ["strong-a", "strong-b"],
      fastWorkerModelRefs: ["fast-a", "fast-b"],
    },
    [
      target("general-a", "provider/general"),
      target("fast-a", "provider/flash-a"),
      target("strong-a", "provider/ultra-a"),
      target("fast-b", "provider/flash-b"),
      target("strong-b", "provider/ultra-b"),
    ]
  );
  const fallback = buildRolePoolFailoverOrder(pools, "strongReasoning");

  const affinity = applyPromptCacheAffinity(
    fallback,
    { prompt_cache_key: "adaptive-tier-regression" },
    true,
    "global"
  );

  assert.deepEqual(fallbackTiers(affinity.targets), [0, 0, 1, 1, 2]);
  assert.deepEqual(
    new Set(affinity.targets.slice(0, 2).map((entry) => entry.stepId)),
    new Set(["strong-a", "strong-b"])
  );
  assert.deepEqual(
    new Set(affinity.targets.slice(2, 4).map((entry) => entry.stepId)),
    new Set(["fast-a", "fast-b"])
  );
  assert.equal(affinity.targets[4]?.stepId, "general-a");
});
