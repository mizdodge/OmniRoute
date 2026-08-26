import assert from "node:assert/strict";
import test from "node:test";

import { resolveConversationContext } from "../../open-sse/services/autoCombo/conversationContextResolver.ts";
import { buildFrontRoutingContext } from "../../open-sse/services/autoCombo/routingContext.ts";
import { classifyAdaptiveTask } from "../../open-sse/services/autoCombo/taskClassification.ts";
import {
  classifyWithConfigDetailed,
  DEFAULT_INTENT_CONFIG,
} from "../../open-sse/services/intentClassifier.ts";

function resolve(messages: Array<Record<string, unknown>>, currentRequest: string) {
  const body = { messages };
  const intent = classifyWithConfigDetailed(currentRequest, DEFAULT_INTENT_CONFIG);
  const routingContext = buildFrontRoutingContext(body, currentRequest);
  const adaptive = classifyAdaptiveTask(
    intent.type,
    body,
    40,
    currentRequest,
    routingContext,
    intent
  );
  return resolveConversationContext(intent, adaptive, routingContext);
}

test("context-dependent disbelief inherits recent difficult debugging as Strong", () => {
  const result = resolve(
    [
      { role: "user", content: "trace root cause race condition dan refactor arsitekturnya" },
      { role: "assistant", content: "I traced the concurrent state transitions." },
      { role: "user", content: "masa sih, masih ga percaya gua" },
    ],
    "masa sih, masih ga percaya gua"
  );

  assert.equal(result.status, "resolved");
  assert.equal(result.role, "strongReasoning");
  assert.equal(result.reason, "reasoning-context-followup");
});

test("the same follow-up inherits recent casual chat as Fast", () => {
  const result = resolve(
    [
      { role: "user", content: "woi ngopi lah bro" },
      { role: "assistant", content: "Gas, kopi dulu." },
      { role: "user", content: "masa sih, masih ga percaya gua" },
    ],
    "masa sih, masih ga percaya gua"
  );

  assert.equal(result.status, "resolved");
  assert.equal(result.role, "fastWorker");
  assert.equal(result.reason, "casual-context-followup");
});

test("context-dependent request without recent context remains unresolved for AI fallback", () => {
  const result = resolve([{ role: "user", content: "masa sih" }], "masa sih");

  assert.equal(result.status, "unresolved");
  assert.equal(result.role, null);
  assert.equal(result.reason, "missing-context");
});

test("a new explicit task never inherits an older conversational role", () => {
  const result = resolve(
    [
      { role: "user", content: "prove this theorem step by step" },
      { role: "assistant", content: "Here is the proof." },
      { role: "user", content: "run the formatter on this file" },
    ],
    "run the formatter on this file"
  );

  assert.equal(result.status, "skipped");
  assert.equal(result.role, null);
  assert.equal(result.reason, "deterministic-confident");
});
