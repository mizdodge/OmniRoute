import assert from "node:assert/strict";
import test from "node:test";

import { buildFrontRoutingContext } from "@omniroute/open-sse/services/autoCombo/routingContext.ts";
import { classifyAdaptiveTask } from "@omniroute/open-sse/services/autoCombo/taskClassification.ts";
import {
  alignTaskWithAdaptiveRole,
  classifyTask,
} from "@omniroute/open-sse/services/taskAwareRouting.ts";

test("large IDE history is a capability requirement, not automatic Strong Reasoning", () => {
  const messages = Array.from({ length: 218 }, (_, index) => ({
    role: index % 2 === 0 ? "user" : "assistant",
    content: `Historical message ${index} ${"context ".repeat(120)}`,
  }));
  messages.push({ role: "user", content: "rename this variable" });
  const body = {
    messages,
    tools: Array.from({ length: 59 }, (_, index) => ({ name: `tool_${index}` })),
  };
  const context = buildFrontRoutingContext(body, "rename this variable");
  const decision = classifyAdaptiveTask("code", body, 4, "rename this variable", context);

  assert.ok(context.capability.estimatedTotalInputTokens > 50_000);
  assert.equal(context.capability.advertisedToolCount, 59);
  assert.ok(context.recentWorkSummary.length <= 2_000);
  assert.equal(decision.preferredRole, "fastWorker");
  assert.deepEqual(decision.signals, ["intent:code", "short-current-request", "code:light"]);
});

test("bounded recent failures can promote an ambiguous continuation without raw-history bias", () => {
  const body = {
    messages: [
      { role: "user", content: "update this endpoint" },
      { role: "assistant", content: "I will apply the update." },
      { role: "tool", content: "Error: compile failed" },
      { role: "assistant", content: "Retrying with a narrower change." },
      { role: "tool", content: "Test failure: assertion mismatch" },
      { role: "user", content: "continue fixing this" },
    ],
  };
  const context = buildFrontRoutingContext(body, "continue fixing this");
  const decision = classifyAdaptiveTask("medium", body, 5, "continue fixing this", context);

  assert.equal(context.execution.isContinuation, true);
  assert.equal(context.execution.recentFailures, 2);
  assert.equal(decision.preferredRole, "strongReasoning");
  assert.ok(decision.signals.includes("continuation:repeated-failures"));
});

test("routing context digest changes when relevant execution state changes", () => {
  const clean = buildFrontRoutingContext(
    { messages: [{ role: "user", content: "continue" }] },
    "continue"
  );
  const failed = buildFrontRoutingContext(
    {
      messages: [
        { role: "tool", content: "Error: build failed" },
        { role: "user", content: "continue" },
      ],
    },
    "continue"
  );

  assert.notEqual(clean.contextDigest, failed.contextDigest);
});

test("the current IDE envelope is excluded from bounded recent-work context", () => {
  const context = buildFrontRoutingContext(
    {
      messages: [
        { role: "assistant", content: "Finished the previous edit." },
        {
          role: "user",
          content:
            "<environment_info>large IDE metadata</environment_info><userRequest>continue</userRequest>",
        },
      ],
    },
    "continue"
  );

  assert.equal(context.execution.isContinuation, true);
  assert.match(context.recentWorkSummary, /Finished the previous edit/);
  assert.doesNotMatch(context.recentWorkSummary, /large IDE metadata/);
});

test("legacy fallback preserves capability size but follows the front role decision", () => {
  const raw = classifyTask({
    messages: Array.from({ length: 20 }, () => ({
      role: "user",
      content: "historical context ".repeat(1_000),
    })),
    tools: Array.from({ length: 59 }, () => ({ type: "function" })),
  });
  const aligned = alignTaskWithAdaptiveRole(raw, "fastWorker");

  assert.equal(raw.level, "critical");
  assert.equal(aligned.level, "light");
  assert.equal(aligned.promptChars, raw.promptChars);
  assert.deepEqual(aligned.reasons, ["adaptive-role:fastWorker"]);
});
