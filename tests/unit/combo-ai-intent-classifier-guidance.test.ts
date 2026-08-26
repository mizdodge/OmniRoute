import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "../..");

test("Combo UI explains local task detection and the AI-only fallback", () => {
  const en = readFileSync(resolve(root, "src/i18n/messages/en.json"), "utf8");
  const id = readFileSync(resolve(root, "src/i18n/messages/id.json"), "utf8");
  const component = readFileSync(
    resolve(root, "src/app/(dashboard)/dashboard/combos/BuilderIntelligentStep.tsx"),
    "utf8"
  );

  assert.match(en, /domain, artifacts, complexity, constraints, risk, and recent context/i);
  assert.match(en, /recognized code, UI, document, data, research, creative, and casual requests/i);
  assert.match(id, /domain, artefak, kompleksitas, batasan, risiko, dan konteks terbaru/i);
  assert.match(id, /permintaan kode, UI, dokumen, data, riset, kreatif/i);
  assert.match(
    component,
    /recognized code, UI, document, data, research, creative, and casual requests/i
  );
});
