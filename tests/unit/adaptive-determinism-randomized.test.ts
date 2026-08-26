import assert from "node:assert/strict";
import test from "node:test";

import { classifyAdaptiveTask } from "../../open-sse/services/autoCombo/taskClassification.ts";
import {
  classifyWithConfigDetailed,
  DEFAULT_INTENT_CONFIG,
} from "../../open-sse/services/intentClassifier.ts";

type ExpectedRole = "fastWorker" | "strongReasoning" | null;

const scenarios: Array<{ prompt: string; expectedRole: ExpectedRole }> = [
  { prompt: "hi", expectedRole: "fastWorker" },
  { prompt: "woi ngopi lah bro", expectedRole: "fastWorker" },
  { prompt: "tolong ringkas teks ini", expectedRole: "fastWorker" },
  { prompt: "what is gravity", expectedRole: "fastWorker" },
  { prompt: "oi cara, beleza?", expectedRole: "fastWorker" },
  { prompt: "oye tío, qué tal?", expectedRole: "fastWorker" },
  { prompt: "你好，最近怎么样？", expectedRole: "fastWorker" },
  { prompt: "run the formatter on this file", expectedRole: "fastWorker" },
  { prompt: "prove this theorem step by step", expectedRole: "strongReasoning" },
  { prompt: "buktikan solusi ini secara logis", expectedRole: "strongReasoning" },
  { prompt: "bro debug race condition ini", expectedRole: "strongReasoning" },
  { prompt: "solve this equation carefully", expectedRole: "fastWorker" },
  { prompt: "分析这个架构", expectedRole: "strongReasoning" },
  { prompt: "إثبات هذه النظرية", expectedRole: "strongReasoning" },
  { prompt: "Menurut kamu bagaimana hasil ini?", expectedRole: null },
  { prompt: "ช่วยตรวจสอบเรื่องนี้อย่างละเอียด", expectedRole: null },
  { prompt: "masa sih", expectedRole: null },
  { prompt: "write a poem about rain", expectedRole: "fastWorker" },
  { prompt: "was meinst du dazu", expectedRole: null },
  { prompt: "classify these items", expectedRole: null },
];

function seededShuffle<T>(input: readonly T[], seed: number): T[] {
  const output = [...input];
  let state = seed >>> 0;
  const random = () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };

  for (let index = output.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [output[index], output[swapIndex]] = [output[swapIndex] as T, output[index] as T];
  }
  return output;
}

function classify(prompt: string) {
  const intent = classifyWithConfigDetailed(prompt, DEFAULT_INTENT_CONFIG);
  const adaptive = classifyAdaptiveTask(
    intent.type,
    { messages: [{ role: "user", content: prompt }] },
    Math.max(1, Math.ceil(prompt.length / 4)),
    prompt,
    undefined,
    intent
  );
  return { intent, adaptive };
}

test("20 seeded randomized trials preserve the agreed deterministic Fast/Strong/neutral roles", () => {
  const randomized = seededShuffle(scenarios, 0x3851c0de);
  const observedRoles = new Set<ExpectedRole>();

  assert.equal(randomized.length, 20);
  assert.equal(new Set(randomized.map(({ prompt }) => prompt)).size, 20);
  for (const [index, scenario] of randomized.entries()) {
    const first = classify(scenario.prompt);
    const repeated = classify(scenario.prompt);

    assert.deepEqual(repeated, first, `trial ${index + 1} drifted for ${scenario.prompt}`);
    assert.equal(
      first.adaptive.preferredRole,
      scenario.expectedRole,
      `trial ${index + 1} misrouted ${scenario.prompt}: ${JSON.stringify(first)}`
    );
    observedRoles.add(first.adaptive.preferredRole);
  }

  assert.deepEqual(observedRoles, new Set<ExpectedRole>(["fastWorker", "strongReasoning", null]));
});
