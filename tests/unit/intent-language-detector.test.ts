import assert from "node:assert/strict";
import test from "node:test";

import { detectPromptLanguage } from "../../open-sse/services/intentLanguageDetector.ts";

const supportedEverydayPrompts = [
  ["en", "hey dude, how are you doing today?"],
  ["id", "masa sih, gua masih belum percaya bro"],
  ["pt-BR", "oi cara, tudo bem com você?"],
  ["es", "oye tío, cómo estás hoy?"],
  ["zh", "你好，今天怎么样？"],
  ["ja", "やあ、今日はどう？"],
  ["ru", "привет, как дела сегодня?"],
  ["de", "hallo, wie geht es dir heute?"],
  ["ko", "안녕, 오늘 어떻게 지내?"],
  ["ar", "مرحبا، كيف حالك اليوم؟"],
] as const;

test("language detector recognizes everyday language for every supported locale", () => {
  for (const [language, prompt] of supportedEverydayPrompts) {
    const result = detectPromptLanguage(prompt);
    assert.equal(result.supported, true, `${language}: ${JSON.stringify(result)}`);
    assert.ok(result.languages.includes(language), `${language}: ${JSON.stringify(result)}`);
    assert.ok(result.confidence > 0);
  }
});

test("language detector reports supported mixed-language requests", () => {
  const result = detectPromptLanguage("bro tolong debug this API، من فضلك");

  assert.equal(result.supported, true);
  assert.equal(result.mixed, true);
  assert.ok(result.languages.includes("id"));
  assert.ok(result.languages.includes("en"));
  assert.ok(result.languages.includes("ar"));
});

test("language detector marks a clear unsupported language without guessing Medium", () => {
  const result = detectPromptLanguage("ช่วยตรวจสอบเรื่องนี้อย่างละเอียด");

  assert.equal(result.supported, false);
  assert.equal(result.primary, "unknown");
  assert.ok(result.signals.includes("unsupported-script:thai"));
});

test("one unsupported language keeps a mixed prompt outside full deterministic coverage", () => {
  const result = detectPromptLanguage("hello, ช่วยตรวจสอบเรื่องนี้");

  assert.equal(result.supported, false);
  assert.equal(result.primary, "en");
  assert.ok(result.languages.includes("en"));
  assert.ok(result.signals.includes("unsupported-script:thai"));
});

test("programming syntax alone does not manufacture a mixed-language result", () => {
  const result = detectPromptLanguage("const value = await fetch(apiUrl);");

  assert.equal(result.mixed, false);
  assert.ok(result.languages.length <= 1);
});
