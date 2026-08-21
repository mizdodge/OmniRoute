import assert from "node:assert/strict";
import test from "node:test";

import {
  activateAdaptiveRoleWeight,
  calculateScore,
  DEFAULT_WEIGHTS,
  type ScoringFactors,
} from "@omniroute/open-sse/services/autoCombo/scoring.ts";
import {
  classifyAdaptiveTask,
  getAdaptiveRoleWeight,
} from "@omniroute/open-sse/services/autoCombo/taskClassification.ts";

const neutralFactors: ScoringFactors = {
  quota: 0.5,
  health: 0.5,
  costInv: 0.5,
  latencyInv: 0.5,
  taskFit: 0.5,
  stability: 0.5,
  tierPriority: 0.5,
  tierAffinity: 0.5,
  specificityMatch: 0.5,
  contextAffinity: 0.5,
  cacheAffinity: 0.5,
  sessionAvailability: 0.5,
  resetWindowAffinity: 0.5,
  connectionDensity: 0.5,
};

test("simple intent prefers Fast Worker when no complex request signal is present", () => {
  assert.deepEqual(classifyAdaptiveTask("simple", { messages: [{ role: "user" }] }, 20), {
    complexity: "simple",
    preferredRole: "fastWorker",
    signals: ["intent:simple"],
  });
});

test("math and reasoning intents prefer Strong Reasoning", () => {
  for (const intent of ["math", "reasoning"] as const) {
    const result = classifyAdaptiveTask(intent, {}, 20, "solve this carefully");
    assert.equal(result.complexity, "complex");
    assert.equal(result.preferredRole, "strongReasoning");
  }
});

test("coding intent distinguishes routine IDE work from difficult engineering", () => {
  const light = classifyAdaptiveTask("code", {}, 40, "run the formatter on this file");
  const heavy = classifyAdaptiveTask(
    "code",
    {},
    120,
    "trace the root cause and refactor the architecture across multiple files"
  );
  const ambiguous = classifyAdaptiveTask("code", {}, 40, "update this endpoint");

  assert.equal(light.preferredRole, "fastWorker");
  assert.deepEqual(light.signals, ["code:light"]);
  assert.equal(heavy.preferredRole, "strongReasoning");
  assert.deepEqual(heavy.signals, ["code:heavy"]);
  assert.equal(ambiguous.preferredRole, null);
  assert.deepEqual(ambiguous.signals, ["intent:code"]);
});

test("an IDE automation continuation ignores tool inventory and required-tool metadata", () => {
  const result = classifyAdaptiveTask(
    "code",
    {
      tool_choice: "required",
      tools: Array.from({ length: 58 }, (_, index) => ({ name: `tool_${index}` })),
      messages: [
        { role: "user", content: "run the formatter on this file" },
        { role: "assistant", tool_calls: [{ id: "call-1" }] },
        { role: "tool", content: "formatter completed" },
      ],
    },
    40,
    "run the formatter on this file"
  );

  assert.equal(result.preferredRole, "fastWorker");
  assert.deepEqual(result.signals, ["code:light"]);
});

test("explicit tool choice and large user request conservatively promote ambiguous intent", () => {
  assert.equal(
    classifyAdaptiveTask("medium", { tool_choice: "required" }, 50).preferredRole,
    "strongReasoning"
  );
  assert.equal(classifyAdaptiveTask("creative", {}, 2_000).preferredRole, "strongReasoning");
});

test("available tool schemas and long conversation history do not override current-user intent", () => {
  const result = classifyAdaptiveTask(
    "medium",
    {
      tools: [{ type: "function" }],
      messages: Array.from({ length: 12 }, () => ({ role: "user", content: "history" })),
    },
    50
  );

  assert.equal(result.preferredRole, null);
  assert.deepEqual(result.signals, ["intent:medium"]);
});

test("ambiguous medium and creative requests remain neutral without complexity signals", () => {
  assert.equal(classifyAdaptiveTask("medium", {}, 100).preferredRole, null);
  assert.equal(classifyAdaptiveTask("creative", {}, 100).preferredRole, null);
});

test("mode packs bias Ship Fast toward Fast Worker and Quality First toward Strong Reasoning", () => {
  assert.ok(
    getAdaptiveRoleWeight("ship-fast", "fastWorker") >
      getAdaptiveRoleWeight("ship-fast", "strongReasoning")
  );
  assert.ok(
    getAdaptiveRoleWeight("quality-first", "strongReasoning") >
      getAdaptiveRoleWeight("quality-first", "fastWorker")
  );
});

test("adaptive role weight boosts only matching pool suitability", () => {
  const weights = activateAdaptiveRoleWeight(DEFAULT_WEIGHTS, "fastWorker", 0.16);
  const fastScore = calculateScore({ ...neutralFactors, fastWorkerPoolSuitability: 1 }, weights);
  const ordinaryScore = calculateScore(neutralFactors, weights);

  assert.ok(fastScore > ordinaryScore);
  assert.equal(weights.strongReasoningPoolSuitability, 0);
  assert.ok(Math.abs(Object.values(weights).reduce((sum, value) => sum + value, 0) - 1) < 1e-9);
});

test("neutral adaptive preference preserves ordinary scoring", () => {
  const weights = activateAdaptiveRoleWeight(DEFAULT_WEIGHTS, null, 0.2);
  assert.equal(
    calculateScore(neutralFactors, weights),
    calculateScore(neutralFactors, DEFAULT_WEIGHTS)
  );
});
