import assert from "node:assert/strict";
import test from "node:test";

import { resolveConversationContext } from "../../open-sse/services/autoCombo/conversationContextResolver.ts";
import { buildFrontRoutingContext } from "../../open-sse/services/autoCombo/routingContext.ts";
import { classifyAdaptiveTask } from "../../open-sse/services/autoCombo/taskClassification.ts";
import {
  detectContextualRequest,
  type ContextualRequestResult,
} from "../../open-sse/services/contextualRequestDetector.ts";
import {
  classifyWithConfigDetailed,
  DEFAULT_INTENT_CONFIG,
} from "../../open-sse/services/intentClassifier.ts";

type ContextScenario = {
  prompt: string;
  operation: ContextualRequestResult["operation"];
  format: ContextualRequestResult["format"];
};

const contextualPrompts: ContextScenario[] = [
  {
    prompt: "Could you please explain it in a Mermaid diagram?",
    operation: "transformPrevious",
    format: "mermaid",
  },
  {
    prompt: "Show that flow as a Mermaid chart.",
    operation: "transformPrevious",
    format: "mermaid",
  },
  {
    prompt: "Turn the explanation into a sequence diagram.",
    operation: "transformPrevious",
    format: "diagram",
  },
  {
    prompt: "Can you visualize the same flow as a diagram?",
    operation: "transformPrevious",
    format: "diagram",
  },
  {
    prompt: "Put the previous comparison in a table.",
    operation: "transformPrevious",
    format: "table",
  },
  { prompt: "Please tabulate those findings.", operation: "transformPrevious", format: "table" },
  {
    prompt: "Summarize that result in five bullets.",
    operation: "transformPrevious",
    format: "summary",
  },
  {
    prompt: "Give me a shorter summary of the same analysis.",
    operation: "transformPrevious",
    format: "summary",
  },
  {
    prompt: "Document that flow in Markdown.",
    operation: "transformPrevious",
    format: "documentation",
  },
  {
    prompt: "Convert the explanation into README documentation.",
    operation: "transformPrevious",
    format: "documentation",
  },
  {
    prompt: "Now provide the implementation as code.",
    operation: "transformPrevious",
    format: "code",
  },
  {
    prompt: "Show me the code version of that approach.",
    operation: "transformPrevious",
    format: "code",
  },
  {
    prompt: "Bisa jelasin itu pakai diagram Mermaid?",
    operation: "transformPrevious",
    format: "mermaid",
  },
  {
    prompt: "Ubah penjelasan tadi jadi diagram alur.",
    operation: "transformPrevious",
    format: "diagram",
  },
  {
    prompt: "Tampilkan perbandingan tadi dalam tabel.",
    operation: "transformPrevious",
    format: "table",
  },
  {
    prompt: "Ringkas hasil sebelumnya jadi lima poin.",
    operation: "transformPrevious",
    format: "summary",
  },
  {
    prompt: "Jadikan alur tadi dokumentasi Markdown.",
    operation: "transformPrevious",
    format: "documentation",
  },
  { prompt: "Sekarang kasih versi kodenya.", operation: "transformPrevious", format: "code" },
  { prompt: "Continue with the next part.", operation: "continuePrevious", format: "unknown" },
  { prompt: "Lanjutkan dari langkah terakhir.", operation: "continuePrevious", format: "unknown" },
];

test("contextual detector recognizes twenty distinct semantic follow-ups twice", () => {
  assert.equal(contextualPrompts.length, 20);
  assert.equal(new Set(contextualPrompts.map(({ prompt }) => prompt)).size, 20);

  for (const scenario of contextualPrompts) {
    const first = detectContextualRequest(scenario.prompt);
    const second = detectContextualRequest(scenario.prompt);
    assert.deepEqual(second, first, `${scenario.prompt} drifted between runs`);
    assert.equal(first.contextDependent, true, scenario.prompt);
    assert.equal(first.operation, scenario.operation, scenario.prompt);
    assert.equal(first.format, scenario.format, scenario.prompt);
    assert.ok(first.confidence >= 0.7, scenario.prompt);
  }
});

test("an explicit new task is never treated as a contextual transformation", () => {
  const independent = [
    "Create a new Mermaid diagram for the payment service.",
    "Update the parser and then document the new API.",
    "Review auth.ts for a security vulnerability.",
    "Buat diagram baru untuk arsitektur cache.",
    "Jalankan seluruh unit test sekarang.",
  ];

  for (const prompt of independent) {
    assert.equal(detectContextualRequest(prompt).contextDependent, false, prompt);
  }
});

function resolve(previousRequest: string, previousAnswer: string, currentRequest: string) {
  const body = {
    messages: [
      { role: "user", content: previousRequest },
      { role: "assistant", content: previousAnswer },
      { role: "user", content: currentRequest },
    ],
  };
  const intent = classifyWithConfigDetailed(currentRequest, DEFAULT_INTENT_CONFIG);
  const routingContext = buildFrontRoutingContext(body, currentRequest);
  const adaptive = classifyAdaptiveTask(
    intent.type,
    body,
    Math.ceil(currentRequest.length / 4),
    currentRequest,
    routingContext,
    intent
  );
  return { intent, result: resolveConversationContext(intent, adaptive, routingContext) };
}

test("Mermaid follow-up inherits a previous Strong task without AI classification", () => {
  const { intent, result } = resolve(
    "Read the whole solution and explain the end-to-end architecture flow.",
    "I traced the complete request lifecycle across the repository.",
    "Could you please explain it in a Mermaid diagram?"
  );

  assert.equal(intent.contextual.contextDependent, true);
  assert.equal(result.status, "resolved");
  assert.equal(result.role, "strongReasoning");
  assert.equal(result.reason, "reasoning-context-followup");
});

test("table follow-up inherits a previous Fast task without AI classification", () => {
  const { result } = resolve(
    "Compare the exact IDs in these two XML files.",
    "I found three matching IDs.",
    "Put the previous comparison in a table."
  );

  assert.equal(result.status, "resolved");
  assert.equal(result.role, "fastWorker");
  assert.equal(result.reason, "casual-context-followup");
});

test("bounded assistant summary can preserve Strong after tool events evict the prior user turn", () => {
  const prompt = "Could you please explain it in a Mermaid diagram?";
  const body = {
    messages: [
      {
        role: "user",
        content: "Read the whole solution and explain the end-to-end architecture flow.",
      },
      {
        role: "assistant",
        content: "I traced the complete request lifecycle across the repository.",
      },
      ...Array.from({ length: 5 }, (_, index) => ({
        role: "tool",
        content: `Tool inspection ${index + 1} completed successfully.`,
      })),
      { role: "user", content: prompt },
    ],
  };
  const intent = classifyWithConfigDetailed(prompt, DEFAULT_INTENT_CONFIG);
  const context = buildFrontRoutingContext(body, prompt);
  const adaptive = classifyAdaptiveTask(intent.type, body, 20, prompt, context, intent);
  const result = resolveConversationContext(intent, adaptive, context);

  assert.doesNotMatch(context.recentWorkSummary, /^user:/m);
  assert.equal(result.status, "resolved");
  assert.equal(result.role, "strongReasoning");
  assert.ok(result.signals.includes("context-source:assistant"));
});

test("contextual request without relevant history remains unresolved for AI fallback", () => {
  const prompt = "Could you please explain it in a Mermaid diagram?";
  const intent = classifyWithConfigDetailed(prompt, DEFAULT_INTENT_CONFIG);
  const body = { messages: [{ role: "user", content: prompt }] };
  const context = buildFrontRoutingContext(body, prompt);
  const adaptive = classifyAdaptiveTask(intent.type, body, 20, prompt, context, intent);
  const result = resolveConversationContext(intent, adaptive, context);

  assert.equal(result.status, "unresolved");
  assert.equal(result.role, null);
  assert.equal(result.reason, "missing-context");
});
