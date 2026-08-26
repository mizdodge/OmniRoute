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
import {
  classifyWithConfigDetailed,
  DEFAULT_INTENT_CONFIG,
} from "@omniroute/open-sse/services/intentClassifier.ts";

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
  assert.deepEqual(classifyAdaptiveTask("simple", { messages: [{ role: "user" }] }, 20, "hi"), {
    complexity: "simple",
    preferredRole: "fastWorker",
    scores: { fastWorker: 0.8, strongReasoning: 0 },
    margin: 0.8,
    factorScores: {
      "intent:simple": { fastWorker: 0.75, strongReasoning: 0 },
      "short-current-request": { fastWorker: 0.2, strongReasoning: 0 },
    },
    decisionSource: "deterministic",
    decisionReason: "recognized-simple-intent",
    requiresAiClassifier: false,
    signals: ["intent:simple", "short-current-request"],
  });
});

test("deterministic heuristic compares Fast and Strong evidence before selecting a role", () => {
  const fast = classifyAdaptiveTask("code", {}, 40, "run the formatter on this file");
  const medium = classifyAdaptiveTask("medium", {}, 40, "classify these items");
  const neutral = classifyAdaptiveTask("creative", {}, 40, "write a poem about rain");
  const strong = classifyAdaptiveTask(
    "reasoning",
    { tool_choice: "required", reasoning_effort: "high" },
    2_500,
    "reason through this carefully"
  );

  assert.deepEqual(fast.scores, { fastWorker: 0.85, strongReasoning: 0.25 });
  assert.equal(fast.margin, 0.6);
  assert.deepEqual(medium.scores, { fastWorker: 0.48, strongReasoning: 0 });
  assert.equal(medium.margin, 0.48);
  assert.deepEqual(neutral.scores, { fastWorker: 0.32, strongReasoning: 0.25 });
  assert.equal(neutral.margin, 0.07);
  assert.ok(strong.scores.strongReasoning > 0.99);
  assert.deepEqual(strong.factorScores, {
    "intent:reasoning": { fastWorker: 0, strongReasoning: 0.8 },
    "explicit-tool-choice": { fastWorker: 0, strongReasoning: 0.6 },
    "long-current-request": { fastWorker: 0, strongReasoning: 0.65 },
    "high-reasoning-effort": { fastWorker: 0, strongReasoning: 0.85 },
  });
  assert.equal(fast.preferredRole, "fastWorker");
  assert.equal(medium.preferredRole, "fastWorker");
  assert.equal(neutral.preferredRole, null);
  assert.equal(strong.preferredRole, "strongReasoning");
});

test("conflicting Fast and Strong evidence stays neutral for the AI tie-breaker", () => {
  const result = classifyAdaptiveTask(
    "code",
    { reasoning_effort: "high" },
    40,
    "run the formatter on this file"
  );

  assert.equal(result.preferredRole, null);
  assert.equal(result.complexity, "neutral");
  assert.ok(result.scores.fastWorker >= 0.8);
  assert.ok(result.scores.strongReasoning >= 0.8);
  assert.ok(result.margin < 0.18);
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
  assert.deepEqual(light.signals, ["intent:code", "short-current-request", "code:light"]);
  assert.equal(heavy.preferredRole, "strongReasoning");
  assert.deepEqual(heavy.signals, ["intent:code", "short-current-request", "code:heavy"]);
  assert.equal(ambiguous.preferredRole, null);
  assert.deepEqual(ambiguous.signals, ["intent:code", "short-current-request"]);
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
  assert.deepEqual(result.signals, ["intent:code", "short-current-request", "code:light"]);
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

  assert.equal(result.preferredRole, "fastWorker");
  assert.deepEqual(result.signals, ["intent:medium"]);
});

test("ordinary medium prefers Fast while creative ambiguity remains neutral", () => {
  assert.equal(
    classifyAdaptiveTask("medium", {}, 100, "classify these items").preferredRole,
    "fastWorker"
  );
  assert.equal(
    classifyAdaptiveTask("creative", {}, 100, "write a poem about rain").preferredRole,
    null
  );
});

test("unrecognized deterministic intent stays neutral for the AI classifier", () => {
  const prompt = "Menurut kamu bagaimana hasil ini?";
  const intent = classifyWithConfigDetailed(prompt, DEFAULT_INTENT_CONFIG);
  const result = classifyAdaptiveTask(intent.type, {}, 40, prompt, undefined, intent);

  assert.deepEqual(result.scores, { fastWorker: 0.48, strongReasoning: 0 });
  assert.equal(result.preferredRole, null);
  assert.equal(result.complexity, "neutral");
  assert.equal(result.requiresAiClassifier, true);
  assert.equal(result.decisionSource, "fallback");
  assert.equal(result.decisionReason, "unrecognized-intent");
});

test("recognized Indonesian intent remains deterministic", () => {
  const prompt = "Tolong ringkas teks ini.";
  const intent = classifyWithConfigDetailed(prompt, DEFAULT_INTENT_CONFIG);
  const result = classifyAdaptiveTask(intent.type, {}, 20, prompt, undefined, intent);

  assert.equal(result.preferredRole, "fastWorker");
  assert.equal(result.requiresAiClassifier, false);
  assert.equal(result.decisionSource, "deterministic");
  assert.equal(result.decisionReason, "recognized-simple-intent");
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
