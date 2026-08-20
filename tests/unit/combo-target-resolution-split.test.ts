import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Split guard for the #3501 god-file decomposition (PR 2): the target-resolution
// stage of handleComboChat (wildcard expansion → weighted step groups → known
// context overflow → strategy ordering → stickiness/eval/compat/context filters →
// task-aware reorder → prompt-cache affinity → pre-screen) was extracted verbatim
// into resolveComboTargetPipeline. These tests pin the leaf's own contract: the
// shape it hands back to the attempt loop, the pass-through ordering for the plain
// `priority` path, and the `earlyResponse` exit for a request that exceeds every
// target's known context window. The strategy-specific branches stay covered
// end-to-end by the combo-* consumer suites through combo.ts.

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-combo-target-resolution-"));
const ORIGINAL_DATA_DIR = process.env.DATA_DIR;
process.env.DATA_DIR = TEST_DATA_DIR;

const core = await import("../../src/lib/db/core.ts");
const { saveModelsDevCapabilities, clearModelsDevCapabilities } =
  await import("../../src/lib/modelsDevSync.ts");
const { resolveComboTargetPipeline } =
  await import("../../open-sse/services/combo/targetResolution.ts");

test.after(() => {
  core.resetDbInstance();
  if (ORIGINAL_DATA_DIR === undefined) {
    delete process.env.DATA_DIR;
  } else {
    process.env.DATA_DIR = ORIGINAL_DATA_DIR;
  }
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

test.beforeEach(() => {
  clearModelsDevCapabilities();
});

const noopLog = { info() {}, warn() {}, error() {}, debug() {} } as never;

function capabilityEntry(limitContext: number) {
  return {
    tool_call: true,
    reasoning: false,
    attachment: false,
    structured_output: true,
    temperature: true,
    modalities_input: JSON.stringify(["text"]),
    modalities_output: JSON.stringify(["text"]),
    knowledge_cutoff: null,
    release_date: null,
    last_updated: null,
    status: null,
    family: null,
    open_weights: false,
    limit_context: limitContext,
    limit_input: limitContext,
    limit_output: 4096,
    interleaved_field: null,
  };
}

const deps = (overrides: Record<string, unknown> = {}): never =>
  ({
    body: { messages: [{ role: "user", content: "hi" }] },
    combo: { id: "c1", name: "c1", models: ["openai/gpt-4o", "anthropic/claude-3"], config: {} },
    strategy: "priority",
    config: {},
    settings: null,
    allCombos: null,
    relayOptions: null,
    signal: null,
    apiKeyAllowedConnections: null,
    log: noopLog,
    resilienceSettings: { providerCooldown: { enabled: false } },
    isModelAvailable: undefined,
    handleSingleModelWithTimeout: async () => new Response("{}"),
    buildAutoCandidates: async () => [],
    ...overrides,
  }) as never;

test("exports resolveComboTargetPipeline", () => {
  assert.equal(typeof resolveComboTargetPipeline, "function");
});

test("priority strategy resolves combo models into orderedTargets in declared order", async () => {
  const result = await resolveComboTargetPipeline(deps());
  assert.ok(!("earlyResponse" in result), "expected a resolved pipeline, not an early response");
  if ("earlyResponse" in result) return;
  assert.deepEqual(
    result.orderedTargets.map((t) => t.modelStr),
    ["openai/gpt-4o", "anthropic/claude-3"]
  );
});

test("returns the derived values the attempt loop consumes", async () => {
  const result = await resolveComboTargetPipeline(deps());
  assert.ok(!("earlyResponse" in result));
  if ("earlyResponse" in result) return;
  assert.equal(typeof result.stickyWeightedLimit, "number");
  assert.equal(typeof result.getWeightedStepKeyForTarget, "function");
  assert.ok(result.preScreenMap instanceof Map);
  assert.equal(result.sticky.messageHash === null || typeof result.sticky.messageHash, "string");
  // Non-weighted strategies have no weighted step resolution, so the mapper is a
  // constant null — the sticky-weighted write-back in combo.ts is then skipped.
  assert.equal(result.getWeightedStepKeyForTarget(result.orderedTargets[0]), null);
});

test("an empty combo yields an empty target pool (combo.ts turns it into a 404)", async () => {
  const result = await resolveComboTargetPipeline(deps({ combo: { name: "empty", models: [] } }));
  assert.ok(!("earlyResponse" in result));
  if ("earlyResponse" in result) return;
  assert.deepEqual(result.orderedTargets, []);
});

test("auto keeps its adaptive primary when legacy task routing sees many advertised tools", async () => {
  const lightning = "nvidia/nvidia/nemotron-3.5-lightning-30b-a3b";
  const ultra = "nvidia/nvidia/nemotron-3-ultra-550b-a55b";
  const infoMessages: string[] = [];
  const result = await resolveComboTargetPipeline(
    deps({
      log: {
        ...noopLog,
        info(_tag: unknown, message: unknown) {
          infoMessages.push(String(message));
        },
      },
      strategy: "auto",
      combo: {
        id: "adaptive-primary-authority",
        name: "adaptive-primary-authority",
        models: [
          { id: "lightning-step", model: lightning },
          { id: "ultra-step", model: ultra },
        ],
        autoConfig: {
          candidatePool: ["nvidia"],
          explorationRate: 0,
          modePack: "ship-fast",
          fastWorkerModelRefs: ["lightning-step"],
          strongReasoningModelRefs: ["ultra-step"],
        },
      },
      config: { compatFilterFailOpen: true },
      body: {
        messages: [
          { role: "system", content: "IDE metadata ".repeat(1_500) },
          { role: "user", content: "hi" },
        ],
        tools: Array.from({ length: 58 }, (_, index) => ({
          type: "function",
          function: { name: `tool_${index}`, parameters: { type: "object" } },
        })),
      },
      buildAutoCandidates: async (targets: Array<Record<string, unknown>>) =>
        targets.map((target) => {
          const modelStr = String(target.modelStr);
          const separator = modelStr.indexOf("/");
          return {
            ...target,
            model: separator >= 0 ? modelStr.slice(separator + 1) : modelStr,
            quotaRemaining: 100,
            quotaTotal: 100,
            circuitBreakerState: "CLOSED",
            costPer1MTokens: 1,
            p95LatencyMs: 100,
            latencyStdDev: 10,
            errorRate: 0,
          };
        }),
    })
  );

  assert.ok(!("earlyResponse" in result));
  if ("earlyResponse" in result) return;
  assert.equal(
    result.orderedTargets[0]?.modelStr,
    lightning,
    "legacy many-tools-large-context routing must not replace Auto's selected primary"
  );
  assert.equal(result.orderedTargets[1]?.modelStr, ultra, "Ultra remains the first fallback");
  const taskRouteLog = infoMessages.find((message) => message.startsWith("task-route "));
  assert.ok(
    taskRouteLog,
    `expected task-route observability log, got: ${infoMessages.join(" | ")}`
  );
  assert.match(
    taskRouteLog,
    new RegExp(
      `^task-route task=light \\(adaptive-role:fastWorker\\) scope=fallback-only ` +
        `primary=${lightning} fallbacks=${ultra} cacheKey=[a-f0-9]+$`
    )
  );
});

test("task-route cannot override a Fast profile primary selected from the general pool", async () => {
  const lightning = "nvidia/nvidia/nemotron-3.5-lightning-30b-a3b";
  const ultra = "nvidia/nvidia/nemotron-3-ultra-550b-a55b";
  const zeroWeights = {
    quota: 0,
    health: 0,
    costInv: 0,
    latencyInv: 1,
    taskFit: 0,
    stability: 0,
    tierPriority: 0,
    tierAffinity: 0,
    specificityMatch: 0,
    contextAffinity: 0,
    cacheAffinity: 0,
    sessionAvailability: 0,
    resetWindowAffinity: 0,
    connectionDensity: 0,
    fastWorkerPoolSuitability: 0,
    strongReasoningPoolSuitability: 0,
  };
  const result = await resolveComboTargetPipeline(
    deps({
      strategy: "auto",
      combo: {
        id: "general-primary-authority",
        name: "general-primary-authority",
        models: [
          { id: "lightning-step", model: lightning },
          { id: "ultra-step", model: ultra },
        ],
        autoConfig: {
          candidatePool: ["nvidia"],
          explorationRate: 0,
          fastWorkerWeights: zeroWeights,
        },
      },
      config: { compatFilterFailOpen: true },
      body: {
        messages: [
          { role: "system", content: "IDE metadata ".repeat(1_500) },
          { role: "user", content: "hi" },
        ],
        tools: Array.from({ length: 58 }, (_, index) => ({
          type: "function",
          function: { name: `tool_${index}`, parameters: { type: "object" } },
        })),
      },
      buildAutoCandidates: async (targets: Array<Record<string, unknown>>) =>
        targets.map((target) => ({
          ...target,
          model: String(target.modelStr).split("/").slice(1).join("/"),
          quotaRemaining: 100,
          quotaTotal: 100,
          circuitBreakerState: "CLOSED",
          costPer1MTokens: 1,
          p95LatencyMs: String(target.stepId) === "lightning-step" ? 10 : 5000,
          latencyStdDev: 10,
          errorRate: 0,
        })),
    })
  );

  assert.ok(!("earlyResponse" in result));
  if ("earlyResponse" in result) return;
  assert.equal(result.orderedTargets[0]?.modelStr, lightning);
  assert.equal(result.orderedTargets[1]?.modelStr, ultra);
});

test("request exceeding every known context window returns a 400 earlyResponse", async () => {
  saveModelsDevCapabilities({
    "unit-target-resolution": {
      tiny: capabilityEntry(8_000),
      small: capabilityEntry(16_000),
    },
  });

  const result = await resolveComboTargetPipeline(
    deps({
      combo: {
        id: "c2",
        name: "known-context-overflow",
        models: ["unit-target-resolution/tiny", "unit-target-resolution/small"],
        config: {},
      },
      body: { messages: [{ role: "user", content: "word ".repeat(200_000) }] },
    })
  );

  assert.ok("earlyResponse" in result, "expected a context-overflow early response");
  if (!("earlyResponse" in result)) return;
  assert.equal(result.earlyResponse.status, 400);
  const body = (await result.earlyResponse.json()) as {
    error?: { code?: string };
    diagnostics?: { terminalReason?: string; attempted?: number };
  };
  assert.equal(body.error?.code, "context_length_exceeded");
  assert.equal(body.diagnostics?.terminalReason, "context_length_exceeded");
  assert.equal(body.diagnostics?.attempted, 0);
});

// #8790: maxContextWindow rejects every target whose known context window
// exceeds the configured ceiling. When that empties the pool, the
// context-requirements guard (applyContinuityFilters → #8786's
// buildEmptyComboTargetsPayload) must surface a 404 context_requirements_exhausted
// early response instead of letting an empty orderedTargets[] fall through to the
// attempt loop.
test("maxContextWindow rejecting every target returns a 404 context_requirements_exhausted earlyResponse", async () => {
  saveModelsDevCapabilities({
    "unit-target-resolution-max": {
      big1: capabilityEntry(500_000),
      big2: capabilityEntry(1_000_000),
    },
  });

  const result = await resolveComboTargetPipeline(
    deps({
      combo: {
        id: "c3",
        name: "max-context-window-exhausted",
        models: ["unit-target-resolution-max/big1", "unit-target-resolution-max/big2"],
        config: {},
      },
      config: {
        contextRequirements: { maxContextWindow: 128_000, contextFilterMode: "strict" },
      },
    })
  );

  assert.ok("earlyResponse" in result, "expected a context-requirements-exhausted early response");
  if (!("earlyResponse" in result)) return;
  assert.equal(result.earlyResponse.status, 404);
  const body = (await result.earlyResponse.json()) as {
    error?: { code?: string };
    diagnostics?: { terminalReason?: string; excluded?: unknown[] };
  };
  assert.equal(body.error?.code, "model_not_found");
  assert.equal(body.diagnostics?.terminalReason, "context_requirements_exhausted");
  assert.equal(body.diagnostics?.excluded?.length, 2);
});
