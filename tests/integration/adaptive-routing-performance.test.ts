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
  classifyWithConfig,
  DEFAULT_INTENT_CONFIG,
} from "@omniroute/open-sse/services/intentClassifier.ts";

const ITERATIONS = 20_000;
const CANDIDATES_PER_REQUEST = 20;
const MAX_AVERAGE_MS = 1;
const IDE_ENVELOPE = `<environment_info>Windows</environment_info>
<editorContext>Untitled editor</editorContext>
<reminderInstructions>Use code editing tools when needed.</reminderInstructions>
<userRequest>what can you do?</userRequest>`;

const baseFactors: ScoringFactors = {
  quota: 0.8,
  health: 1,
  costInv: 0.7,
  latencyInv: 0.7,
  taskFit: 0.8,
  stability: 0.9,
  tierPriority: 0.5,
  tierAffinity: 0.5,
  specificityMatch: 0.5,
  contextAffinity: 0.5,
  cacheAffinity: 0,
  sessionAvailability: 1,
  resetWindowAffinity: 0.5,
  connectionDensity: 0.3,
};

function benchmarkAdaptiveRequest(): number {
  const classification = classifyAdaptiveTask(
    "reasoning",
    { messages: [{ role: "user", content: "Analyze this architecture" }] },
    800
  );
  const role = classification.preferredRole;
  const weights = activateAdaptiveRoleWeight(
    DEFAULT_WEIGHTS,
    role,
    role ? getAdaptiveRoleWeight("quality-first", role) : 0
  );
  let checksum = 0;
  for (let index = 0; index < CANDIDATES_PER_REQUEST; index++) {
    checksum += calculateScore(
      {
        ...baseFactors,
        strongReasoningPoolSuitability: index % 4 === 0 ? 1 : 0,
      },
      weights
    );
  }
  return checksum;
}

test("adaptive classification plus 20-candidate role scoring averages below 1ms per request", (t) => {
  for (let index = 0; index < 2_000; index++) benchmarkAdaptiveRequest();

  const startedAt = performance.now();
  let checksum = 0;
  for (let index = 0; index < ITERATIONS; index++) checksum += benchmarkAdaptiveRequest();
  const elapsedMs = performance.now() - startedAt;
  const averageMs = elapsedMs / ITERATIONS;

  t.diagnostic(
    `adaptive routing: ${averageMs.toFixed(4)}ms/request average ` +
      `(${ITERATIONS} requests × ${CANDIDATES_PER_REQUEST} candidates)`
  );

  assert.ok(checksum > 0, "benchmark result must be consumed so the work cannot be discarded");
  assert.ok(
    averageMs < MAX_AVERAGE_MS,
    `adaptive routing averaged ${averageMs.toFixed(4)}ms/request; expected <${MAX_AVERAGE_MS}ms`
  );
});

test("IDE-envelope user-intent extraction and classification average below 1ms per request", (t) => {
  for (let index = 0; index < 2_000; index++) {
    classifyWithConfig(IDE_ENVELOPE, DEFAULT_INTENT_CONFIG, "You are a coding agent with tools.");
  }

  const startedAt = performance.now();
  let simpleCount = 0;
  for (let index = 0; index < ITERATIONS; index++) {
    if (
      classifyWithConfig(
        IDE_ENVELOPE,
        DEFAULT_INTENT_CONFIG,
        "You are a coding agent with tools."
      ) === "simple"
    ) {
      simpleCount++;
    }
  }
  const averageMs = (performance.now() - startedAt) / ITERATIONS;

  t.diagnostic(`IDE-envelope intent classification: ${averageMs.toFixed(4)}ms/request average`);
  assert.equal(simpleCount, ITERATIONS);
  assert.ok(
    averageMs < MAX_AVERAGE_MS,
    `IDE-envelope intent classification averaged ${averageMs.toFixed(4)}ms/request; expected <${MAX_AVERAGE_MS}ms`
  );
});
