import assert from "node:assert/strict";
import test from "node:test";

import { classifyAdaptiveTask } from "../../open-sse/services/autoCombo/taskClassification.ts";
import {
  classifyWithConfigDetailed,
  DEFAULT_INTENT_CONFIG,
} from "../../open-sse/services/intentClassifier.ts";
import { detectTaskIntent } from "../../open-sse/services/taskIntentDetector.ts";

function route(prompt: string) {
  const intent = classifyWithConfigDetailed(prompt, DEFAULT_INTENT_CONFIG);
  const adaptive = classifyAdaptiveTask(
    intent.type,
    {},
    Math.ceil(prompt.length / 4),
    prompt,
    undefined,
    intent
  );
  return { intent, adaptive };
}

test("bounded XML duplicate inspection is deterministic Fast and read-only", () => {
  const prompt =
    "could you open templates folder, then compare between azureOpenAI with ChatGPT xml files? " +
    'is there any same "ID" in those xml? summary to me, do not execute anyrthing, this just asking';
  const task = detectTaskIntent(prompt);
  const result = route(prompt);

  assert.equal(task.family, "fileInspection");
  assert.equal(task.actionMode, "readOnly");
  assert.equal(task.scope, "bounded");
  assert.equal(task.complexity, "simple");
  assert.equal(task.recognized, true);
  assert.equal(result.intent.shouldUseAiClassifier, false);
  assert.equal(result.intent.reason, "recognized-file-inspection");
  assert.equal(result.adaptive.preferredRole, "fastWorker");
  assert.equal(result.adaptive.requiresAiClassifier, false);
});

test("task family and complexity stay separate for similar comparison requests", () => {
  const exact = route("Compare the ID values in these two XML files and summarize duplicates.");
  const semantic = route(
    "Compare the request architecture across the repository and evaluate its operational tradeoffs."
  );

  assert.equal(exact.intent.task.family, "fileInspection");
  assert.equal(exact.adaptive.preferredRole, "fastWorker");
  assert.equal(semantic.intent.task.family, "architecture");
  assert.equal(semantic.adaptive.preferredRole, "strongReasoning");
});

test("whole-project flow explanation is repository-wide architecture work", () => {
  const prompt =
    "hi could you read this solution? and explain me the flow using diagram, and also mention " +
    "what function that will move to next step. remember, not only AUTOFILL, but whole project";
  const result = route(prompt);

  assert.equal(result.intent.task.family, "architecture");
  assert.equal(result.intent.task.actionMode, "readOnly");
  assert.equal(result.intent.task.scope, "repositoryWide");
  assert.equal(result.intent.task.complexity, "complex");
  assert.equal(result.intent.shouldUseAiClassifier, false);
  assert.equal(result.adaptive.preferredRole, "strongReasoning");
});

test("routine project UI theme change is deterministic Fast code work", () => {
  const prompt =
    "update this project theme of UI to lime color (as main), you can combine with other, " +
    "but make it aesthetic.";
  const result = route(prompt);

  assert.equal(result.intent.task.family, "codeChange");
  assert.equal(result.intent.task.actionMode, "modify");
  assert.equal(result.intent.task.complexity, "simple");
  assert.equal(result.intent.shouldUseAiClassifier, false);
  assert.equal(result.adaptive.preferredRole, "fastWorker");
});

test("routine and difficult vibe-coding pairs route to different worker roles", () => {
  const pairs = [
    [
      "Fix the typo in this component.",
      "Trace the root cause of this intermittent race condition.",
    ],
    [
      "Rename this local variable.",
      "Refactor this module across the repository without breaking compatibility.",
    ],
    [
      "Run the focused unit test.",
      "Investigate why the integration suite is flaky across CI workers.",
    ],
    [
      "Explain this helper function.",
      "Explain the system-wide request lifecycle and identify architectural bottlenecks.",
    ],
    [
      "Update the README version.",
      "Update the architecture documentation after the distributed auth migration.",
    ],
  ] as const;

  for (const [fastPrompt, strongPrompt] of pairs) {
    assert.equal(route(fastPrompt).adaptive.preferredRole, "fastWorker", fastPrompt);
    assert.equal(route(strongPrompt).adaptive.preferredRole, "strongReasoning", strongPrompt);
  }
});

test("action mode does not masquerade as task complexity", () => {
  assert.equal(
    detectTaskIntent("Read this config and explain the timeout.").actionMode,
    "readOnly"
  );
  assert.equal(
    detectTaskIntent("Plan a small rename but do not change files.").actionMode,
    "planOnly"
  );
  assert.equal(detectTaskIntent("Update this README heading.").actionMode, "modify");
  assert.equal(detectTaskIntent("Run the formatter on this file.").actionMode, "execute");
  assert.equal(detectTaskIntent("Verify the generated JSON schema.").actionMode, "validate");
});

test("routine documentation and structured-data work remain deterministic Fast", () => {
  const prompts = [
    "Summarize these two Markdown documents.",
    "Update the README version badge.",
    "Format this JSON file.",
    "Convert this small YAML object to JSON.",
    "Find duplicate keys in these two config files.",
  ];

  for (const prompt of prompts) {
    assert.equal(route(prompt).adaptive.preferredRole, "fastWorker", prompt);
    assert.equal(route(prompt).intent.shouldUseAiClassifier, false, prompt);
  }
});

test("genuinely unknown or unsupported work still reaches the AI fallback", () => {
  const unknown = route("According to the frobnicator, quux the blorb appropriately.");
  const unsupported = route("ช่วยตรวจสอบเรื่องนี้อย่างละเอียด");

  assert.equal(unknown.adaptive.preferredRole, null);
  assert.equal(unknown.intent.shouldUseAiClassifier, true);
  assert.equal(unsupported.adaptive.preferredRole, null);
  assert.equal(unsupported.intent.shouldUseAiClassifier, true);
});

test("casual address words cannot downgrade difficult coding work", () => {
  const result = route(
    "bro please investigate the distributed deadlock across multiple services and prove the safest fix"
  );
  assert.equal(result.intent.task.family, "debugging");
  assert.equal(result.adaptive.preferredRole, "strongReasoning");
});

type RoutingScenario = {
  prompt: string;
  role: "fastWorker" | "strongReasoning" | null;
};

const vibeCodingFast: RoutingScenario[] = [
  { prompt: "Open these two XML templates and list matching IDs.", role: "fastWorker" },
  { prompt: "List the files inside the templates folder.", role: "fastWorker" },
  { prompt: "Search for TODO comments in this module.", role: "fastWorker" },
  { prompt: "Explain this helper function briefly.", role: "fastWorker" },
  { prompt: "Rename this local variable to requestId.", role: "fastWorker" },
  { prompt: "Fix the spelling typo in this component.", role: "fastWorker" },
  { prompt: "Format this single TypeScript file.", role: "fastWorker" },
  { prompt: "Run the formatter on the current file.", role: "fastWorker" },
  { prompt: "Run only the focused unit test.", role: "fastWorker" },
  { prompt: "Check whether this one test passes.", role: "fastWorker" },
  { prompt: "Add a short comment above this function.", role: "fastWorker" },
  { prompt: "Update the response text in this endpoint.", role: "fastWorker" },
  { prompt: "Show which imports this component uses.", role: "fastWorker" },
  { prompt: "Read package.json and tell me its version.", role: "fastWorker" },
  { prompt: "Find where REQUEST_TIMEOUT is defined in the repository.", role: "fastWorker" },
  { prompt: "List the routes under this API folder.", role: "fastWorker" },
  { prompt: "Summarize this recent build log without changing anything.", role: "fastWorker" },
  { prompt: "Verify this generated JSON schema.", role: "fastWorker" },
  { prompt: "Checkout the existing feature branch.", role: "fastWorker" },
  { prompt: "Commit the already staged changes with this message.", role: "fastWorker" },
  { prompt: "Merge this clean branch; there are no conflicts.", role: "fastWorker" },
  { prompt: "Run npm pack for the current build.", role: "fastWorker" },
  { prompt: "Restart the local development server.", role: "fastWorker" },
  { prompt: "Update the timeout value in this config file.", role: "fastWorker" },
  { prompt: "Change this one JSON feature flag to true.", role: "fastWorker" },
  { prompt: "Inspect the current git diff and summarize it.", role: "fastWorker" },
  { prompt: "Show the current git branch name.", role: "fastWorker" },
  { prompt: "Locate the assertion in this test file.", role: "fastWorker" },
  { prompt: "Update this import path in one file.", role: "fastWorker" },
  { prompt: "Buka folder routes lalu daftar semua file TypeScript di sana.", role: "fastWorker" },
];

const vibeCodingStrong: RoutingScenario[] = [
  {
    prompt: "Trace the root cause of an intermittent production timeout.",
    role: "strongReasoning",
  },
  { prompt: "Debug the race condition between these concurrent workers.", role: "strongReasoning" },
  {
    prompt: "Investigate a deadlock spanning the queue and database layers.",
    role: "strongReasoning",
  },
  {
    prompt: "Find why the integration suite is flaky across CI machines.",
    role: "strongReasoning",
  },
  {
    prompt: "Design the authentication architecture for multiple services.",
    role: "strongReasoning",
  },
  {
    prompt: "Refactor the request pipeline across the entire repository.",
    role: "strongReasoning",
  },
  { prompt: "Migrate the API without breaking backward compatibility.", role: "strongReasoning" },
  {
    prompt: "Review this authorization implementation for security vulnerabilities.",
    role: "strongReasoning",
  },
  { prompt: "Diagnose the performance bottleneck across the system.", role: "strongReasoning" },
  {
    prompt: "Investigate a memory leak that appears after several hours.",
    role: "strongReasoning",
  },
  { prompt: "Trace this distributed failure across all services.", role: "strongReasoning" },
  { prompt: "Implement a coordinated API change across multiple files.", role: "strongReasoning" },
  { prompt: "Design a cache architecture and explain the tradeoffs.", role: "strongReasoning" },
  {
    prompt: "Prove that this migration preserves backward compatibility.",
    role: "strongReasoning",
  },
  { prompt: "Audit the repository-wide credential handling flow.", role: "strongReasoning" },
  { prompt: "Redesign the database transaction boundary across modules.", role: "strongReasoning" },
  {
    prompt: "Explain the end-to-end request lifecycle and find bottlenecks.",
    role: "strongReasoning",
  },
  {
    prompt: "Investigate why retries amplify failures in the distributed proxy.",
    role: "strongReasoning",
  },
  {
    prompt: "Refactor the provider fallback logic without changing behavior.",
    role: "strongReasoning",
  },
  {
    prompt: "Review the threat model for this OAuth callback architecture.",
    role: "strongReasoning",
  },
  {
    prompt: "Analyze conflicting state updates across multiple React hooks.",
    role: "strongReasoning",
  },
  {
    prompt: "Migrate the monolith modules while preserving plugin compatibility.",
    role: "strongReasoning",
  },
  {
    prompt: "Debug why the encryption auth tag fails only on another machine.",
    role: "strongReasoning",
  },
  {
    prompt: "Investigate a regression involving several providers and protocols.",
    role: "strongReasoning",
  },
  {
    prompt: "Design an idempotent database migration for existing installations.",
    role: "strongReasoning",
  },
  {
    prompt: "Assess security and performance tradeoffs of the new proxy layer.",
    role: "strongReasoning",
  },
  { prompt: "Selidiki akar masalah deadlock yang muncul lintas layanan.", role: "strongReasoning" },
  { prompt: "Refaktor arsitektur autentikasi di seluruh repositori.", role: "strongReasoning" },
  {
    prompt: "Analiza la vulnerabilidad de seguridad en toda la arquitectura.",
    role: "strongReasoning",
  },
  {
    prompt: "Überprüfe die Architektur auf ein verteiltes Race Condition Problem.",
    role: "strongReasoning",
  },
];

const documentationAndData: RoutingScenario[] = [
  { prompt: "Summarize these two Markdown documents.", role: "fastWorker" },
  { prompt: "Update the README version badge to 3.8.51.", role: "fastWorker" },
  { prompt: "Correct one spelling mistake in the changelog.", role: "fastWorker" },
  { prompt: "Convert this small YAML file to JSON.", role: "fastWorker" },
  { prompt: "Pretty-format this JSON configuration.", role: "fastWorker" },
  { prompt: "Compare exact keys in these two config files.", role: "fastWorker" },
  { prompt: "List headings missing from this documentation page.", role: "fastWorker" },
  { prompt: "Translate this short README paragraph to Indonesian.", role: "fastWorker" },
  { prompt: "Update one installation command in the guide.", role: "fastWorker" },
  { prompt: "Verify links in this single Markdown document.", role: "fastWorker" },
  { prompt: "Extract the first table from this CSV file.", role: "fastWorker" },
  { prompt: "Normalize indentation in this YAML document.", role: "fastWorker" },
  { prompt: "Find duplicate environment keys in these two examples.", role: "fastWorker" },
  { prompt: "Ringkas dua dokumen konfigurasi ini tanpa mengubah file.", role: "fastWorker" },
  {
    prompt: "Rewrite the architecture docs after the repository-wide migration.",
    role: "strongReasoning",
  },
  {
    prompt: "Reconcile conflicting API documentation across the whole codebase.",
    role: "strongReasoning",
  },
  { prompt: "Audit the compliance guide for security gaps.", role: "strongReasoning" },
  {
    prompt: "Compare two API specifications semantically and explain breaking changes.",
    role: "strongReasoning",
  },
  {
    prompt: "Create a migration guide covering every backward-compatibility risk.",
    role: "strongReasoning",
  },
  {
    prompt: "Review the credential policy documentation against the system architecture.",
    role: "strongReasoning",
  },
];

const casualAndQuestions: RoutingScenario[] = [
  { prompt: "Hi, how are you today?", role: "fastWorker" },
  { prompt: "Woi ngopi lah bro wkwk.", role: "fastWorker" },
  { prompt: "What is Git?", role: "fastWorker" },
  { prompt: "How does a JSON file work?", role: "fastWorker" },
  { prompt: "Who created JavaScript?", role: "fastWorker" },
  { prompt: "Apa itu API?", role: "fastWorker" },
  { prompt: "Jelaskan singkat apa fungsi README.", role: "fastWorker" },
  { prompt: "¿Qué es una base de datos?", role: "fastWorker" },
  { prompt: "Was ist eine Programmierschnittstelle?", role: "fastWorker" },
  { prompt: "Что такое репозиторий?", role: "fastWorker" },
  { prompt: "什么是 XML？", role: "fastWorker" },
  { prompt: "コードとは何ですか？", role: "fastWorker" },
  { prompt: "Really, are you sure?", role: null },
  { prompt: "Masa sih, masih ga percaya gua.", role: null },
  { prompt: "¿En serio, estás seguro?", role: null },
];

const ambiguousAndUnsupported: RoutingScenario[] = [
  { prompt: "Handle this appropriately.", role: null },
  { prompt: "Make it better somehow.", role: null },
  { prompt: "According to the frobnicator, quux the blorb.", role: null },
  { prompt: "Do the thing we discussed.", role: null },
  { prompt: "What about the previous one?", role: null },
  { prompt: "Menurut kamu bagaimana hasil ini?", role: null },
  { prompt: "Hazlo como corresponde.", role: null },
  { prompt: "Mach das bitte richtig.", role: null },
  { prompt: "Сделай это как надо.", role: null },
  { prompt: "이걸 제대로 해줘.", role: null },
  { prompt: "ช่วยตรวจสอบเรื่องนี้อย่างละเอียด", role: null },
  { prompt: "कृपया इसे ठीक से संभालें", role: null },
  { prompt: "Παρακαλώ χειρίσου το σωστά", role: null },
  { prompt: "אנא טפל בזה כראוי", role: null },
  { prompt: "What should happen here?", role: null },
];

const mixedAndAdversarial: RoutingScenario[] = [
  { prompt: "bro debug this distributed race condition across services", role: "strongReasoning" },
  { prompt: "please santai aja, update this README heading", role: "fastWorker" },
  {
    prompt: "Do not execute anything; analyze the security architecture only.",
    role: "strongReasoning",
  },
  {
    prompt: "List these files, then redesign the repository architecture.",
    role: "strongReasoning",
  },
  {
    prompt: "Explain this one function and diagnose the system-wide bottleneck.",
    role: "strongReasoning",
  },
  {
    prompt:
      "<environment_info>Windows with 59 tools</environment_info><userRequest>rename this variable in one file</userRequest>",
    role: "fastWorker",
  },
  { prompt: "Buka templates folder and compare exact XML IDs, summary aja.", role: "fastWorker" },
  {
    prompt: "この repository を refactor して backward compatibility を守って",
    role: "strongReasoning",
  },
  {
    prompt: "Do not change files; plan the repository-wide database migration.",
    role: "strongReasoning",
  },
  { prompt: "wkwk run the formatter on this one file bro", role: "fastWorker" },
];

test("120 distinct user requests preserve the expected routing decision twice", () => {
  const scenarios = [
    ...vibeCodingFast,
    ...vibeCodingStrong,
    ...documentationAndData,
    ...casualAndQuestions,
    ...ambiguousAndUnsupported,
    ...mixedAndAdversarial,
  ];

  assert.equal(scenarios.length, 120);
  assert.equal(new Set(scenarios.map(({ prompt }) => prompt)).size, 120);

  const failures: string[] = [];
  for (const scenario of scenarios) {
    const first = route(scenario.prompt);
    const second = route(scenario.prompt);
    assert.deepEqual(second, first, `${scenario.prompt} drifted between deterministic runs`);

    for (const result of [first, second]) {
      if (result.adaptive.preferredRole !== scenario.role) {
        failures.push(
          `${scenario.prompt} => expected=${scenario.role ?? "neutral"} ` +
            `actual=${result.adaptive.preferredRole ?? "neutral"} ` +
            `family=${result.intent.task.family} reason=${result.adaptive.decisionReason}`
        );
        continue;
      }
      if (scenario.role === null) {
        if (!result.intent.shouldUseAiClassifier) {
          failures.push(`${scenario.prompt} => neutral result did not request AI classification`);
        }
      } else if (result.adaptive.requiresAiClassifier) {
        failures.push(`${scenario.prompt} => deterministic role still requested AI classification`);
      }
    }
  }
  assert.deepEqual(failures, []);
});

test("bounded file inspection stays deterministic across all ten supported languages", () => {
  const prompts = [
    "Open these two XML files, compare their IDs, and summarize duplicates.",
    "Buka dua file XML ini, bandingkan ID, lalu ringkas duplikatnya.",
    "Abrir estes dois arquivos XML, comparar os IDs e resumir os duplicados.",
    "Abrir estos dos archivos XML, comparar los ID y resumir los duplicados.",
    "打开这两个 XML 文件，比较 ID 并总结重复项。",
    "この2つの XML ファイルを開いて、IDを比較し、重複を要約してください。",
    "Открыть эти два XML файла, сравнить ID и резюмировать дубликаты.",
    "Diese zwei XML-Dateien öffnen, IDs vergleichen und Duplikate zusammenfassen.",
    "이 두 XML 파일을 열어 ID를 비교하고 중복을 요약해 주세요.",
    "فتح ملفي XML ومقارنة المعرّفات وتلخيص القيم المكررة.",
  ];

  for (const prompt of prompts) {
    const result = route(prompt);
    assert.equal(result.intent.language.supported, true, prompt);
    assert.equal(result.intent.task.family, "fileInspection", prompt);
    assert.equal(result.adaptive.preferredRole, "fastWorker", prompt);
    assert.equal(result.intent.shouldUseAiClassifier, false, prompt);
  }
});
