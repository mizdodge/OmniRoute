import { test, after } from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_WEIGHTS } from "@omniroute/open-sse/services/autoCombo/scoring.ts";
import { resolveAutoStrategyOrder } from "@omniroute/open-sse/services/combo/resolveAutoStrategy.ts";
import { resetDbInstance } from "@/lib/db/core.ts";

// resolveAutoStrategyOrder loads the LKGP via the DB singleton (dynamic import);
// release the handle so the node:test runner does not hang on teardown (learning #3).
after(() => {
  resetDbInstance();
});

// Split guard for Block J Task 2 (coupled slice): the `if (strategy === "auto")`
// branch of handleComboChat was extracted verbatim into resolveAutoStrategyOrder,
// with `buildAutoCandidates` injected (it lives in combo.ts, so a direct import
// would cycle). These tests pin the DI contract and the two control-flow exits
// that the host now forwards: an early 429 Response, and the default-ordering
// pass-through. The routable-selection path is covered end-to-end by the 60
// consumer tests (router-strategies / auto-combo-engine / combo-strategy-fallbacks).

const noopLog = {
  info() {},
  warn() {},
  error() {},
  debug() {},
} as never;

const target = (provider: string, modelStr: string): never =>
  ({
    kind: "model",
    stepId: "s1",
    executionKey: `${provider}>${modelStr}`,
    modelStr,
    provider,
    providerId: null,
    connectionId: null,
    weight: 1,
    label: null,
  }) as never;

const baseDeps = (buildAutoCandidates: never) =>
  ({
    orderedTargets: [target("openai", "gpt-4o"), target("anthropic", "claude-3")],
    body: { messages: [{ role: "user", content: "hi" }] },
    combo: { id: "c1", name: "autoc", config: {} },
    settings: null,
    config: {},
    relayOptions: null,
    resilienceSettings: { quotaPreflight: { enabled: false } },
    log: noopLog,
    buildAutoCandidates,
  }) as never;

test("exports resolveAutoStrategyOrder", () => {
  assert.equal(typeof resolveAutoStrategyOrder, "function");
});

test("no candidates -> keeps default ordering, no explicit router", async () => {
  const build = (async () => []) as never;
  const result = await resolveAutoStrategyOrder(baseDeps(build));
  assert.ok(!("earlyResponse" in result));
  if ("orderedTargets" in result) {
    assert.equal(result.autoUsedExplicitRouter, false);
    // default ordering preserved (both original targets survive)
    assert.equal(result.orderedTargets.length, 2);
    assert.equal(result.orderedTargets[0].provider, "openai");
  }
});

test("all candidates quota-cutoff-blocked -> early 429 Response", async () => {
  const build = (async () => [
    {
      kind: "model",
      stepId: "s1",
      executionKey: "openai>gpt-4o",
      modelStr: "gpt-4o",
      provider: "openai",
      model: "gpt-4o",
      quotaCutoffBlocked: true,
    },
  ]) as never;
  const result = await resolveAutoStrategyOrder(baseDeps(build));
  assert.ok("earlyResponse" in result);
  if ("earlyResponse" in result) {
    assert.ok(result.earlyResponse instanceof Response);
    assert.equal(result.earlyResponse.status, 429);
  }
});

test("cache affinity scores expanded auto account candidates directly", async () => {
  const candidates = [
    {
      kind: "model",
      stepId: "s1",
      executionKey: "openai>gpt-4o@account-a",
      modelStr: "gpt-4o",
      provider: "openai",
      model: "gpt-4o",
      connectionId: "account-a",
      quotaRemaining: 100,
      quotaTotal: 100,
      circuitBreakerState: "CLOSED",
      costPer1MTokens: 1,
      p95LatencyMs: 100,
      latencyStdDev: 10,
      errorRate: 0,
    },
    {
      kind: "model",
      stepId: "s1",
      executionKey: "openai>gpt-4o@account-b",
      modelStr: "gpt-4o",
      provider: "openai",
      model: "gpt-4o",
      connectionId: "account-b",
      quotaRemaining: 100,
      quotaTotal: 100,
      circuitBreakerState: "CLOSED",
      costPer1MTokens: 1,
      p95LatencyMs: 100,
      latencyStdDev: 10,
      errorRate: 0,
    },
  ];
  const deps = baseDeps((async () => candidates) as never);
  deps.orderedTargets = [target("openai", "gpt-4o")];
  deps.body = { prompt_cache_key: "expanded-account-key", messages: [] };
  deps.combo.autoConfig = {
    candidatePool: ["openai"],
    explorationRate: 0,
    weights: { cacheAffinity: 1 },
  };

  await resolveAutoStrategyOrder(deps);

  assert.deepEqual(candidates.map((candidate) => candidate.cacheAffinity).sort(), [0, 1]);
});

// #7008 follow-up: parseAutoConfig() (see combo-auto-config-split.test.ts) already
// makes `weights` honor a combo's own STORED modePack. But resolveAutoStrategyOrder()
// also supports a per-request `X-OmniRoute-Mode` override (relayOptions.mode) that can
// pick a *different* mode pack than the one stored on the combo for that single
// request — and `weights` must track that EFFECTIVE (post-override) modePack, not the
// stored one, so scoreAutoTargets' fallback ranking doesn't drift from the primary
// selection. These three synthetic candidates are built so every scoring factor is
// IDENTICAL between them except cost/latency/stability, and "dominant" clearly wins
// selection under any weight profile (so the engine's own randomized tier-rotation
// never affects which one becomes `orderedTargets[0]`) — isolating the assertion to
// the *fallback ranking order* of the remaining two, which is exactly what
// scoreAutoTargets (and only scoreAutoTargets) controls.
const weightSensitiveCandidates = () =>
  [
    {
      kind: "model",
      stepId: "dominant",
      executionKey: "groq>dominant-model",
      modelStr: "dominant-model",
      provider: "groq",
      model: "dominant-model",
      quotaRemaining: 100,
      quotaTotal: 100,
      circuitBreakerState: "CLOSED",
      costPer1MTokens: 0.01,
      p95LatencyMs: 10,
      latencyStdDev: 1,
      errorRate: 0,
    },
    {
      // Wins under "quality-first" (high taskFit/stability weight): low latencyStdDev
      // (=> high stability), but the highest cost and highest latency in the pool.
      kind: "model",
      stepId: "quality-leaning",
      executionKey: "openai>model-alpha",
      modelStr: "model-alpha",
      provider: "openai",
      model: "model-alpha",
      quotaRemaining: 100,
      quotaTotal: 100,
      circuitBreakerState: "CLOSED",
      costPer1MTokens: 20,
      p95LatencyMs: 5000,
      latencyStdDev: 1,
      errorRate: 0,
    },
    {
      // Wins under "ship-fast" (high latencyInv/health weight): lowest latency and
      // lowest cost in the pool, but the highest latencyStdDev (=> low stability).
      kind: "model",
      stepId: "speed-leaning",
      executionKey: "anthropic>model-beta",
      modelStr: "model-beta",
      provider: "anthropic",
      model: "model-beta",
      quotaRemaining: 100,
      quotaTotal: 100,
      circuitBreakerState: "CLOSED",
      costPer1MTokens: 1,
      p95LatencyMs: 100,
      latencyStdDev: 900,
      errorRate: 0,
    },
  ] as never;

const weightSensitiveDeps = (autoConfig: Record<string, unknown>, mode?: string) =>
  ({
    orderedTargets: [
      target("groq", "dominant-model"),
      target("openai", "model-alpha"),
      target("anthropic", "model-beta"),
    ],
    body: { messages: [{ role: "user", content: "hi" }] },
    combo: {
      id: "auto-mode-override",
      name: "auto-mode-override",
      autoConfig: {
        // Fixed candidatePool skips the DB-backed expandAutoComboCandidatePool
        // path entirely (see the `candidatePool.length > 0` early-return there) —
        // this test only cares about weight-driven ranking, not pool expansion.
        candidatePool: ["groq", "openai", "anthropic"],
        explorationRate: 0,
        ...autoConfig,
      },
    },
    settings: null,
    config: {},
    relayOptions: mode ? { mode } : null,
    resilienceSettings: { quotaPreflight: { enabled: false } },
    log: noopLog,
    buildAutoCandidates: (async () => weightSensitiveCandidates()) as never,
  }) as never;

test("per-request X-OmniRoute-Mode override changes the EFFECTIVE weights used for fallback ranking, not just selection", async () => {
  // Combo's own stored modePack is "quality-first" (would rank model-alpha before
  // model-beta if the override were ignored), but the request overrides to
  // "ship-fast" for this one call.
  const overridden = await resolveAutoStrategyOrder(
    weightSensitiveDeps({ modePack: "quality-first" }, "ship-fast")
  );
  assert.ok("orderedTargets" in overridden, "expected a normal ordering result, not earlyResponse");
  if (!("orderedTargets" in overridden)) return;

  // A combo natively configured with "ship-fast" (no override at all) is the ground
  // truth for what "effective modePack = ship-fast" should rank like.
  const native = await resolveAutoStrategyOrder(weightSensitiveDeps({ modePack: "ship-fast" }));
  assert.ok("orderedTargets" in native, "expected a normal ordering result, not earlyResponse");
  if (!("orderedTargets" in native)) return;

  // "dominant" overwhelms every weight profile tried here, so it is always the
  // engine's selection (position 0) regardless of any exploration/tier-rotation
  // randomness — the two asserted positions below are populated exclusively by
  // scoreAutoTargets' deterministic weight-driven sort.
  assert.equal(overridden.orderedTargets[0].provider, "groq");
  assert.equal(native.orderedTargets[0].provider, "groq");

  // Ship-fast weights favor low-latency/high-health over stability, so the
  // speed-leaning candidate outranks the quality-leaning one when the effective
  // modePack is ship-fast — whether that's because it's natively configured that
  // way, or because a per-request override made it so.
  assert.equal(
    overridden.orderedTargets[1].provider,
    "anthropic",
    "request-level ship-fast override should rank the speed-leaning candidate above the quality-leaning one"
  );
  assert.equal(overridden.orderedTargets[2].provider, "openai");

  // The override case must match the native ship-fast case EXACTLY — proving the
  // override drives an identical effective weight vector for fallback ranking, not
  // just for the initial selection.
  assert.deepEqual(
    overridden.orderedTargets.map((t) => t.provider),
    native.orderedTargets.map((t) => t.provider)
  );
});

const adaptiveTarget = (stepId: string, provider: string) =>
  ({
    kind: "model",
    stepId,
    executionKey: `${provider}>shared-model`,
    modelStr: `${provider}/shared-model`,
    provider,
    providerId: provider,
    connectionId: null,
    weight: 1,
    label: null,
  }) as never;

const adaptiveCandidates = () =>
  ["fast", "strong", "ordinary"].map((provider) => ({
    kind: "model",
    stepId: `${provider}-step`,
    executionKey: `${provider}>shared-model`,
    modelStr: `${provider}/shared-model`,
    provider,
    model: "shared-model",
    quotaRemaining: 100,
    quotaTotal: 100,
    circuitBreakerState: "CLOSED",
    costPer1MTokens: 1,
    p95LatencyMs: 100,
    latencyStdDev: 10,
    errorRate: 0,
  })) as never;

function adaptiveDeps(name: string, prompt: string, explorationRate = 0) {
  return {
    orderedTargets: [
      adaptiveTarget("ordinary-step", "ordinary"),
      adaptiveTarget("strong-step", "strong"),
      adaptiveTarget("fast-step", "fast"),
    ],
    body: { messages: [{ role: "user", content: prompt }] },
    combo: {
      id: name,
      name,
      autoConfig: {
        candidatePool: ["fast", "strong", "ordinary"],
        explorationRate,
        modePack: "ship-fast",
        fastWorkerModelRefs: ["fast-step"],
        strongReasoningModelRefs: ["strong-step"],
      },
    },
    settings: null,
    config: {},
    relayOptions: null,
    resilienceSettings: { quotaPreflight: { enabled: false } },
    log: noopLog,
    buildAutoCandidates: (async () => adaptiveCandidates()) as never,
  } as never;
}

test("adaptive auto emits readable named pipeline checkpoints", async () => {
  const infoLogs: string[] = [];
  const deps = adaptiveDeps("adaptive-step-logs", "hi");
  deps.log = {
    ...noopLog,
    info(_tag: unknown, message: unknown) {
      infoLogs.push(String(message));
    },
  };

  const result = await resolveAutoStrategyOrder(deps);

  assert.ok("orderedTargets" in result);
  assert.ok(
    infoLogs.some((message) =>
      message.startsWith(
        "[STEP] Language Detector : primary=en | languages=en | mixed=false | " +
          "supported=true | confidence="
      )
    )
  );
  assert.ok(
    infoLogs.some((message) =>
      message.startsWith(
        "[STEP] Task Intent Detector : family=unknown | action=unknown | scope=unknown | " +
          "complexity=unknown | confidence=0.000 | reason=unrecognized-task-family | " +
          "fastEvidence=0.000 | strongEvidence=0.000 | signals="
      )
    )
  );
  assert.ok(
    infoLogs.includes(
      "[STEP] Request Profile Detector : domain=unknown | artifacts=none | risk=unknown | " +
        "complexity=unknown | constraints=0 | confidence=0.000 | " +
        "reason=unrecognized-request-profile | fastEvidence=0.000 | strongEvidence=0.000 | " +
        "signals=profile-domain:unknown,profile-risk:unknown,profile-complexity:unknown"
    )
  );
  assert.ok(
    infoLogs.includes(
      "[STEP] Contextual Request Detector : dependent=false | operation=unknown | " +
        "format=unknown | confidence=0.000 | reason=independent-request | " +
        "signals=contextual-operation:unknown,format:unknown"
    )
  );
  assert.ok(
    infoLogs.some((message) =>
      message.startsWith(
        "[STEP] Adaptive Deterministic : role=fastWorker | complexity=simple | " +
          "reason=recognized-simple-intent | " +
          "intentScore=0.900 | casualScore=0.000 | " +
          "fastScore=0.800 | strongScore=0.000 | margin=0.800 | " +
          "minScore=0.350 | minMargin=0.180 | " +
          "factors=intent:simple(F=0.750,S=0.000),short-current-request(F=0.200,S=0.000) | signals="
      )
    )
  );
  assert.ok(
    infoLogs.includes(
      "[STEP] Context Resolver : status=skipped | role=neutral | " +
        "reason=deterministic-confident | score=0.000 | previousRole=none | " +
        "contextAge=none | signals=deterministic-role"
    )
  );
  assert.ok(
    infoLogs.includes(
      "[STEP] AI Intent Classifier : skipped | reason=deterministic-role | role=fastWorker"
    )
  );
  assert.ok(
    infoLogs.some((message) =>
      message.startsWith(
        "[STEP] Adaptive-Router : role=fastWorker | activePool=fastWorker | poolSize=1 | "
      )
    )
  );
  assert.equal(
    infoLogs.some(
      (message) => message.startsWith("[STEP] Adaptive-Router : ") && message.includes("selected=")
    ),
    false,
    "Adaptive-Router reports only the selected role/pool; Task-Route owns model selection"
  );
  const adaptiveRouterLog = infoLogs.find((message) =>
    message.startsWith("[STEP] Adaptive-Router : ")
  );
  assert.ok(adaptiveRouterLog);
  assert.doesNotMatch(adaptiveRouterLog, /(?:^|\s)score=/);
});

test("adaptive role scoring selects the semantic role and builds a cross-role fallback tail", async () => {
  const simple = await resolveAutoStrategyOrder(
    adaptiveDeps("adaptive-simple-runtime", "what is gravity")
  );
  assert.ok("orderedTargets" in simple);
  if (!("orderedTargets" in simple)) return;
  assert.deepEqual(
    simple.orderedTargets.map((entry) => entry.stepId),
    ["fast-step", "strong-step", "ordinary-step"]
  );

  const complex = await resolveAutoStrategyOrder(
    adaptiveDeps("adaptive-complex-runtime", "prove this theorem step by step")
  );
  assert.ok("orderedTargets" in complex);
  if (!("orderedTargets" in complex)) return;
  assert.deepEqual(
    complex.orderedTargets.map((entry) => entry.stepId),
    ["strong-step", "fast-step", "ordinary-step"]
  );
});

test("multiple Fast Workers use the Fast Worker Advanced Weight profile", async () => {
  const model = (stepId: string, provider: string) => adaptiveTarget(stepId, provider);
  const candidate = (
    stepId: string,
    provider: string,
    costPer1MTokens: number,
    p95LatencyMs: number
  ) => ({
    kind: "model",
    stepId,
    executionKey: `${provider}>shared-model`,
    modelStr: `${provider}/shared-model`,
    provider,
    model: "shared-model",
    quotaRemaining: 100,
    quotaTotal: 100,
    circuitBreakerState: "CLOSED",
    costPer1MTokens,
    p95LatencyMs,
    latencyStdDev: 10,
    errorRate: 0,
  });
  const zeroWeights = Object.fromEntries(Object.keys(DEFAULT_WEIGHTS).map((key) => [key, 0]));
  const result = await resolveAutoStrategyOrder({
    orderedTargets: [
      model("speed-step", "speed"),
      model("cheap-step", "cheap"),
      model("strong-step", "strong"),
    ],
    body: { messages: [{ role: "user", content: "hi" }] },
    combo: {
      id: "role-specific-fast-weights",
      name: "role-specific-fast-weights",
      autoConfig: {
        candidatePool: ["speed", "cheap", "strong"],
        explorationRate: 0,
        modePack: "ship-fast",
        fastWorkerModelRefs: ["speed-step", "cheap-step"],
        strongReasoningModelRefs: ["strong-step"],
        fastWorkerWeights: { ...zeroWeights, costInv: 1 },
      },
    },
    settings: null,
    config: {},
    relayOptions: null,
    resilienceSettings: { quotaPreflight: { enabled: false } },
    log: noopLog,
    buildAutoCandidates: (async () => [
      candidate("speed-step", "speed", 20, 10),
      candidate("cheap-step", "cheap", 0.01, 5000),
      candidate("strong-step", "strong", 1, 100),
    ]) as never,
  } as never);

  assert.ok("orderedTargets" in result);
  if (!("orderedTargets" in result)) return;
  assert.equal(result.orderedTargets[0]?.stepId, "cheap-step");
  assert.deepEqual(
    result.orderedTargets.map((entry) => entry.stepId),
    ["cheap-step", "speed-step", "strong-step"]
  );
});

test("an empty role assignment applies the Fast Advanced profile to the general worker pool", async () => {
  const zeroWeights = Object.fromEntries(Object.keys(DEFAULT_WEIGHTS).map((key) => [key, 0]));
  const resolve = () =>
    resolveAutoStrategyOrder({
      orderedTargets: [
        adaptiveTarget("speed-step", "general-speed"),
        adaptiveTarget("cheap-step", "general-cheap"),
      ],
      body: { messages: [{ role: "user", content: "hi" }] },
      combo: {
        id: "general-fast-weights",
        name: "general-fast-weights",
        autoConfig: {
          candidatePool: ["general-speed", "general-cheap"],
          explorationRate: 0,
          fastWorkerWeights: { ...zeroWeights, latencyInv: 1 },
        },
      },
      settings: null,
      config: {},
      relayOptions: null,
      resilienceSettings: { quotaPreflight: { enabled: false } },
      log: noopLog,
      buildAutoCandidates: (async () => [
        {
          ...adaptiveCandidates()[0],
          stepId: "speed-step",
          executionKey: "general-speed>shared-model",
          modelStr: "general-speed/shared-model",
          provider: "general-speed",
          costPer1MTokens: 20,
          p95LatencyMs: 10,
        },
        {
          ...adaptiveCandidates()[0],
          stepId: "cheap-step",
          executionKey: "general-cheap>shared-model",
          modelStr: "general-cheap/shared-model",
          provider: "general-cheap",
          costPer1MTokens: 0.01,
          p95LatencyMs: 5000,
        },
      ]) as never,
    } as never);

  const result = await resolve();

  assert.ok("orderedTargets" in result);
  if (!("orderedTargets" in result)) return;
  assert.deepEqual(
    result.orderedTargets.map((entry) => entry.stepId),
    ["speed-step", "cheap-step"]
  );
});

test("exploration cannot cross from a routable Fast Worker pool into Strong Reasoning", async (t) => {
  t.mock.method(Math, "random", () => 0.5);

  const result = await resolveAutoStrategyOrder(
    adaptiveDeps("adaptive-simple-exploration", "what can you do?", 1)
  );

  assert.ok("orderedTargets" in result);
  if (!("orderedTargets" in result)) return;
  assert.deepEqual(
    result.orderedTargets.map((entry) => entry.stepId),
    ["fast-step", "strong-step", "ordinary-step"]
  );
});

test("unrecognized Indonesian intent uses the AI classifier before selecting a role pool", async () => {
  const infoLogs: string[] = [];
  const deps = adaptiveDeps(
    "adaptive-indonesian-neutral-with-ai",
    "Menurut kamu bagaimana hasil ini?"
  );
  deps.combo.autoConfig.adaptiveJudgeModelRef = "ordinary-step";
  deps.log = {
    ...noopLog,
    info(_tag: unknown, message: unknown) {
      infoLogs.push(String(message));
    },
  };
  let classifierCalls = 0;
  deps.handleSingleModel = (async () => {
    classifierCalls += 1;
    return Response.json({ choices: [{ message: { content: "STRONG_REASONING" } }] });
  }) as never;

  const result = await resolveAutoStrategyOrder(deps);

  assert.equal(classifierCalls, 1);
  assert.ok("orderedTargets" in result);
  if (!("orderedTargets" in result)) return;
  assert.equal(result.orderedTargets[0]?.stepId, "strong-step");
  assert.equal(result.adaptiveTask.decisionSource, "ai_tiebreaker");
  assert.equal(result.adaptiveTask.decisionReason, "ai-classifier");
  assert.ok(
    infoLogs.some(
      (message) =>
        message.startsWith("[STEP] Adaptive Deterministic : role=neutral") &&
        message.includes("reason=unrecognized-intent")
    )
  );
  assert.ok(
    infoLogs.some(
      (message) =>
        message.startsWith("[STEP] AI Intent Classifier : selected") &&
        message.includes("reason=unrecognized-intent")
    )
  );
  assert.ok(
    infoLogs.some(
      (message) =>
        message.startsWith("[STEP] Adaptive-Router : role=strongReasoning") &&
        message.includes("reason=ai-classifier")
    )
  );
});

test("unrecognized language remains seamless when no AI classifier is configured", async () => {
  const result = await resolveAutoStrategyOrder(
    adaptiveDeps("adaptive-unsupported-no-ai", "ช่วยตรวจสอบเรื่องนี้อย่างละเอียด")
  );

  assert.ok("orderedTargets" in result);
  if (!("orderedTargets" in result)) return;
  assert.equal(result.adaptiveTask.preferredRole, null);
  assert.equal(result.adaptiveTask.decisionSource, "fallback");
  assert.equal(result.adaptiveTask.decisionReason, "ai-classifier-not-configured");
  assert.equal(result.orderedTargets.length, 3);
});

test("bounded recent context resolves an ambiguous follow-up before the AI classifier", async () => {
  const infoLogs: string[] = [];
  const deps = adaptiveDeps("adaptive-context-before-ai", "masa sih, masih ga percaya gua");
  deps.body = {
    messages: [
      { role: "user", content: "trace root cause race condition dan refactor arsitekturnya" },
      { role: "assistant", content: "I traced the concurrent state transitions." },
      { role: "user", content: "masa sih, masih ga percaya gua" },
    ],
  };
  deps.combo.autoConfig.adaptiveJudgeModelRef = "ordinary-step";
  deps.log = {
    ...noopLog,
    info(_tag: unknown, message: unknown) {
      infoLogs.push(String(message));
    },
  };
  let classifierCalls = 0;
  deps.handleSingleModel = (async () => {
    classifierCalls += 1;
    return Response.json({ choices: [{ message: { content: "FAST_WORKER" } }] });
  }) as never;

  const result = await resolveAutoStrategyOrder(deps);

  assert.equal(classifierCalls, 0);
  assert.ok("orderedTargets" in result);
  if (!("orderedTargets" in result)) return;
  assert.equal(result.adaptiveTask.preferredRole, "strongReasoning");
  assert.equal(result.adaptiveTask.decisionSource, "deterministic");
  assert.equal(result.adaptiveTask.decisionReason, "reasoning-context-followup");
  assert.equal(result.orderedTargets[0]?.stepId, "strong-step");
  assert.ok(
    infoLogs.some(
      (message) =>
        message.startsWith("[STEP] Context Resolver : status=resolved") &&
        message.includes("reason=reasoning-context-followup")
    )
  );
  assert.ok(
    infoLogs.includes(
      "[STEP] AI Intent Classifier : skipped | reason=context-resolved | role=strongReasoning"
    )
  );
  assert.equal(
    infoLogs.some((message) => message.startsWith("[STEP]") && message.includes("masa sih")),
    false,
    "routing checkpoints expose reasons and signals, never raw user text"
  );
});

test("a Mermaid format follow-up inherits whole-project Strong routing before AI", async () => {
  const infoLogs: string[] = [];
  const prompt = "Could you please explain it in a Mermaid diagram?";
  const deps = adaptiveDeps("adaptive-contextual-format-before-ai", prompt);
  deps.body = {
    messages: [
      {
        role: "user",
        content: "Read the whole solution and explain the end-to-end architecture flow.",
      },
      {
        role: "assistant",
        content: "I traced the complete request lifecycle across the repository.",
      },
      { role: "user", content: prompt },
    ],
  };
  deps.combo.autoConfig.adaptiveJudgeModelRef = "ordinary-step";
  deps.log = {
    ...noopLog,
    info(_tag: unknown, message: unknown) {
      infoLogs.push(String(message));
    },
  };
  let classifierCalls = 0;
  deps.handleSingleModel = (async () => {
    classifierCalls += 1;
    return Response.json({ choices: [{ message: { content: "FAST_WORKER" } }] });
  }) as never;

  const result = await resolveAutoStrategyOrder(deps);

  assert.equal(classifierCalls, 0);
  assert.ok("orderedTargets" in result);
  if (!("orderedTargets" in result)) return;
  assert.equal(result.adaptiveTask.preferredRole, "strongReasoning");
  assert.equal(result.adaptiveTask.decisionReason, "reasoning-context-followup");
  assert.equal(result.orderedTargets[0]?.stepId, "strong-step");
  assert.ok(
    infoLogs.some(
      (message) =>
        message.startsWith("[STEP] Contextual Request Detector : dependent=true") &&
        message.includes("operation=transformPrevious") &&
        message.includes("format=mermaid")
    )
  );
  assert.ok(
    infoLogs.includes(
      "[STEP] AI Intent Classifier : skipped | reason=context-resolved | role=strongReasoning"
    )
  );
  assert.equal(
    infoLogs.some((message) => message.startsWith("[STEP]") && message.includes(prompt)),
    false,
    "routing checkpoints expose classifications, never raw user text"
  );
});

test("AI classifier failure falls back to regular Auto routing", async () => {
  const deps = adaptiveDeps("adaptive-unsupported-ai-failure", "ช่วยตรวจสอบเรื่องนี้อย่างละเอียด");
  deps.combo.autoConfig.adaptiveJudgeModelRef = "ordinary-step";
  deps.handleSingleModel = (async () =>
    Response.json({ choices: [{ message: { content: "UNSURE" } }] })) as never;

  const result = await resolveAutoStrategyOrder(deps);

  assert.ok("orderedTargets" in result);
  if (!("orderedTargets" in result)) return;
  assert.equal(result.adaptiveTask.preferredRole, null);
  assert.equal(result.adaptiveTask.decisionSource, "fallback");
  assert.equal(result.adaptiveTask.decisionReason, "ai-classifier-failed");
  assert.equal(result.orderedTargets.length, 2, "judge-only Step stays outside the worker pool");
});

test("AI classifier runs only when heuristic Fast and Strong scores remain neutral", async () => {
  const deps = adaptiveDeps(
    "adaptive-ai-classifier-neutral-only",
    "Handle the thing appropriately."
  );
  deps.combo.autoConfig.adaptiveJudgeModelRef = "ordinary-step";
  let classifierCalls = 0;
  deps.handleSingleModel = (async () => {
    classifierCalls += 1;
    return Response.json({ choices: [{ message: { content: "STRONG_REASONING" } }] });
  }) as never;

  const result = await resolveAutoStrategyOrder(deps);

  assert.equal(classifierCalls, 1);
  assert.ok("orderedTargets" in result);
  if (!("orderedTargets" in result)) return;
  assert.equal(result.orderedTargets[0]?.stepId, "strong-step");
});

test("configured AI Intent Classifier resolves ambiguity using its selected Combo Step", async () => {
  const deps = adaptiveDeps("adaptive-ai-judge", "Handle the thing appropriately.");
  deps.combo.autoConfig.adaptiveJudgeModelRef = "ordinary-step";
  let judgeCalls = 0;
  deps.handleSingleModel = (async (body, modelStr, target) => {
    judgeCalls += 1;
    assert.equal(modelStr, "ordinary/shared-model");
    assert.equal(target?.stepId, "ordinary-step");
    assert.equal(body._omnirouteInternalRequest, "adaptive-judge");
    return Response.json({ choices: [{ message: { content: "STRONG_REASONING" } }] });
  }) as never;

  const result = await resolveAutoStrategyOrder(deps);

  assert.equal(judgeCalls, 1);
  assert.ok("orderedTargets" in result);
  if (!("orderedTargets" in result)) return;
  assert.equal(result.orderedTargets[0]?.stepId, "strong-step");
  assert.deepEqual(
    result.orderedTargets.map((entry) => entry.stepId),
    ["strong-step", "fast-step"],
    "a judge-only Step must never leak into the final response or fallback chain"
  );
});

test("AI Intent Classifier is skipped when deterministic rules already choose Fast or Strong", async () => {
  let judgeCalls = 0;
  for (const [name, prompt, expected] of [
    ["fast", "hi", "fast-step"],
    ["strong", "prove this theorem step by step", "strong-step"],
  ] as const) {
    const deps = adaptiveDeps(`judge-skip-${name}`, prompt);
    deps.combo.autoConfig.adaptiveJudgeModelRef = "ordinary-step";
    deps.handleSingleModel = (async () => {
      judgeCalls += 1;
      return Response.json({ choices: [{ message: { content: "FAST_WORKER" } }] });
    }) as never;

    const result = await resolveAutoStrategyOrder(deps);
    assert.ok("orderedTargets" in result);
    if ("orderedTargets" in result) assert.equal(result.orderedTargets[0]?.stepId, expected);
  }

  assert.equal(judgeCalls, 0);
});
