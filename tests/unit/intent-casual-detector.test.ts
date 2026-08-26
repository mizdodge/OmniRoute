import assert from "node:assert/strict";
import test from "node:test";

import { detectCasualIntent } from "../../open-sse/services/casualIntentDetector.ts";
import {
  classifyWithConfigDetailed,
  DEFAULT_INTENT_CONFIG,
} from "../../open-sse/services/intentClassifier.ts";

test("Indonesian coffee banter is deterministic casual Fast without AI", () => {
  const casual = detectCasualIntent("woi ngopi lah bro");
  const intent = classifyWithConfigDetailed("woi ngopi lah bro", DEFAULT_INTENT_CONFIG);

  assert.equal(casual.isCasual, true);
  assert.equal(casual.contextDependent, false);
  assert.equal(intent.type, "simple");
  assert.equal(intent.reason, "casual-conversation");
  assert.equal(intent.shouldUseAiClassifier, false);
});

test("explicit engineering work outranks casual address words", () => {
  const prompt = "bro debug race condition ini";
  const casual = detectCasualIntent(prompt);
  const intent = classifyWithConfigDetailed(prompt, DEFAULT_INTENT_CONFIG);

  assert.equal(casual.isCasual, false);
  assert.equal(intent.type, "code");
  assert.equal(intent.reason, "recognized-code-intent");
  assert.equal(intent.shouldUseAiClassifier, false);
});

test("casual detector recognizes colloquial conversation across supported languages", () => {
  const prompts = [
    "what's up dude, wanna grab coffee?",
    "woi ngopi lah bro",
    "oi cara, beleza?",
    "oye tío, qué tal?",
    "你好，最近怎么样？",
    "やあ、元気？",
    "привет, как дела?",
    "hallo, wie geht's?",
    "안녕, 잘 지내?",
    "مرحبا، كيف حالك؟",
  ];

  for (const prompt of prompts) {
    const result = detectCasualIntent(prompt);
    assert.equal(result.isCasual, true, `${prompt}: ${JSON.stringify(result)}`);
  }
});

test("ambiguous follow-up is context-dependent rather than confidently casual", () => {
  const result = detectCasualIntent("masa sih, masih ga percaya gua");

  assert.equal(result.contextDependent, true);
  assert.equal(result.isCasual, false);
  assert.equal(result.reason, "context-dependent-conversation");
});
