import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyPromptIntent,
  classifyWithConfig,
  DEFAULT_INTENT_CONFIG,
  extractUserRequestFromClientEnvelope,
} from "../../open-sse/services/intentClassifier.ts";
import { classifyAdaptiveTask } from "../../open-sse/services/autoCombo/taskClassification.ts";
import { extractPromptForIntent } from "../../open-sse/services/combo/autoStrategy.ts";

const vscodeEnvelope = `<environment_info> The user's current OS is: Windows </environment_info>
<workspace_info> There is no workspace currently open. </workspace_info>
<userMemory> No user preferences or notes saved yet. Use the memory tool. </userMemory>

User
<context> The current date is 2026-08-19. </context>
<editorContext> The user's current file is untitled:Untitled-32. </editorContext>
<reminderInstructions> When using an edit tool, update the code in the current file. </reminderInstructions>
<userRequest> hi how are you? </userRequest>
Assistant
Hi! I'm doing well.

User
<context> The current date is 2026-08-19. </context>
<editorContext> The user's current file is untitled:Untitled-32. </editorContext>
<reminderInstructions> Prefer the replace_string_in_file tool for code edits. </reminderInstructions>
<userRequest> what can you do? </userRequest>`;

test("extracts the last explicit user request from a VS Code-style client envelope", () => {
  assert.equal(extractUserRequestFromClientEnvelope(vscodeEnvelope), "what can you do?");
});

test("preserves an ordinary chat message without an IDE envelope", () => {
  const message = "Please compare these two deployment options.";
  assert.equal(extractUserRequestFromClientEnvelope(message), message);
});

test("the Combo request extractor applies envelope normalization to the latest user message", () => {
  assert.equal(
    extractPromptForIntent({
      messages: [
        { role: "user", content: "an older request" },
        { role: "assistant", content: "an older answer" },
        { role: "user", content: vscodeEnvelope },
      ],
    }),
    "what can you do?"
  );
});

test("IDE metadata and system instructions cannot turn a conversational request into code", () => {
  const codingSystemPrompt = "You are a coding agent. Use file editing tools and inspect code.";
  const intent = classifyWithConfig(vscodeEnvelope, DEFAULT_INTENT_CONFIG, codingSystemPrompt);

  assert.equal(classifyPromptIntent(vscodeEnvelope, codingSystemPrompt), "simple");
  assert.equal(intent, "simple");
  assert.equal(
    classifyAdaptiveTask(intent, { tools: [{ type: "function" }] }, 20).preferredRole,
    "fastWorker"
  );
});

test("Latin intent keywords match whole words instead of substrings in ordinary chat", () => {
  assert.equal(classifyPromptIntent("what is the capital of France?"), "simple");
  assert.equal(classifyPromptIntent("tell me about capitalism"), "simple");
  assert.equal(classifyPromptIntent("please classify these items"), "medium");
  assert.equal(classifyPromptIntent("call this API endpoint"), "code");
});

test("available tool schemas preserve Fast routing but an explicit tool choice is Strong", () => {
  const availableOnly = classifyAdaptiveTask(
    "medium",
    { tools: [{ type: "function", function: { name: "search" } }] },
    20
  );
  const explicitlyRequired = classifyAdaptiveTask(
    "medium",
    {
      tools: [{ type: "function", function: { name: "search" } }],
      tool_choice: "required",
    },
    20
  );

  assert.equal(availableOnly.preferredRole, "fastWorker");
  assert.equal(explicitlyRequired.preferredRole, "strongReasoning");
  assert.ok(explicitlyRequired.signals.includes("explicit-tool-choice"));
});
