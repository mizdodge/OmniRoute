import assert from "node:assert/strict";
import test from "node:test";

import {
  clearAdaptiveJudgeDecisionCache,
  parseAdaptiveJudgeVerdict,
  runAdaptiveJudge,
} from "@omniroute/open-sse/services/autoCombo/adaptiveJudge.ts";
import { buildFrontRoutingContext } from "@omniroute/open-sse/services/autoCombo/routingContext.ts";
import type { ResolvedComboTarget } from "@omniroute/open-sse/services/combo/types.ts";

const judgeTarget = {
  kind: "model",
  stepId: "judge-step",
  executionKey: "judge>judge-model>judge-connection",
  modelStr: "judge/judge-model",
  provider: "judge",
  providerId: "judge",
  connectionId: "judge-connection",
  weight: 0,
  label: null,
} satisfies ResolvedComboTarget;

test("judge verdict parser only accepts the two routing labels", () => {
  assert.equal(parseAdaptiveJudgeVerdict("FAST_WORKER"), "fastWorker");
  assert.equal(parseAdaptiveJudgeVerdict("```\nSTRONG_REASONING\n```"), "strongReasoning");
  assert.equal(parseAdaptiveJudgeVerdict('{"verdict":"strong_reasoning"}'), "strongReasoning");
  assert.equal(parseAdaptiveJudgeVerdict("Maybe use the faster model"), null);
});

test("AI Judger dispatches only the extracted request to the selected Combo Step", async () => {
  let receivedBody: Record<string, unknown> | null = null;
  let receivedTarget: unknown = null;
  const result = await runAdaptiveJudge({
    prompt: "prove this theorem",
    target: judgeTarget,
    handleSingleModel: async (body, modelStr, target) => {
      receivedBody = body;
      receivedTarget = target;
      assert.equal(modelStr, "judge/judge-model");
      return Response.json({ choices: [{ message: { content: "STRONG_REASONING" } }] });
    },
    log: { info() {}, warn() {}, debug() {} },
  });

  assert.equal(result, "strongReasoning");
  assert.equal(receivedTarget, judgeTarget);
  assert.deepEqual(receivedBody?.tools, undefined);
  assert.equal(receivedBody?.stream, false);
  assert.equal(receivedBody?._omnirouteInternalRequest, "adaptive-judge");
  assert.match(JSON.stringify(receivedBody?.messages), /prove this theorem/);
});

test("AI Judger fails open to the deterministic classifier", async () => {
  const invalid = await runAdaptiveJudge({
    prompt: "ambiguous",
    target: judgeTarget,
    handleSingleModel: async () => Response.json({ choices: [{ message: { content: "UNSURE" } }] }),
    log: { info() {}, warn() {}, debug() {} },
  });
  const upstreamError = await runAdaptiveJudge({
    prompt: "ambiguous",
    target: judgeTarget,
    handleSingleModel: async () => new Response("bad gateway", { status: 502 }),
    log: { info() {}, warn() {}, debug() {} },
  });

  assert.equal(invalid, null);
  assert.equal(upstreamError, null);
});

test("AI Intent Classifier reuses one verdict only for the same routing context", async () => {
  clearAdaptiveJudgeDecisionCache();
  let calls = 0;
  const classify = (recentResult: string) =>
    runAdaptiveJudge({
      prompt: "update this endpoint",
      target: judgeTarget,
      cacheScope: "smart-combos",
      routingContext: buildFrontRoutingContext(
        {
          messages: [
            { role: "tool", content: recentResult },
            { role: "user", content: "update this endpoint" },
          ],
        },
        "update this endpoint"
      ),
      handleSingleModel: async () => {
        calls += 1;
        return Response.json({ choices: [{ message: { content: "FAST_WORKER" } }] });
      },
      log: { info() {}, warn() {}, debug() {} },
    });

  assert.equal(await classify("success"), "fastWorker");
  assert.equal(await classify("success"), "fastWorker");
  assert.equal(await classify("Error: tests failed"), "fastWorker");
  assert.equal(calls, 2);
  clearAdaptiveJudgeDecisionCache();
});
