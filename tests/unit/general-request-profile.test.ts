import assert from "node:assert/strict";
import test from "node:test";

import { classifyAdaptiveTask } from "../../open-sse/services/autoCombo/taskClassification.ts";
import {
  classifyWithConfigDetailed,
  DEFAULT_INTENT_CONFIG,
} from "../../open-sse/services/intentClassifier.ts";
import {
  detectRequestProfile,
  type RequestDomain,
} from "../../open-sse/services/requestProfileDetector.ts";

type ExpectedRole = "fastWorker" | "strongReasoning" | null;
type Scenario = { prompt: string; domain: RequestDomain; role: ExpectedRole };

function scenarios(
  domain: RequestDomain,
  role: ExpectedRole,
  prompts: readonly string[]
): Scenario[] {
  return prompts.map((prompt) => ({ prompt, domain, role }));
}

const corpus: Scenario[] = [
  ...scenarios("uiUx", "fastWorker", [
    "Update this project UI theme to lime and make the palette aesthetic.",
    "Change the primary button color to coral in this component.",
    "Make this login card responsive on mobile screens.",
    "Add a subtle hover state to the navigation links.",
    "Rapikan spacing dan typography halaman settings ini.",
    "Switch this dashboard from dark mode to a warm light theme.",
    "Center the modal and soften its box shadow.",
    "Use Tailwind classes to style this empty state.",
    "Update the CSS variables for the brand colors.",
    "Bikin tampilan form ini lebih aesthetic tanpa ubah logic.",
  ]),
  ...scenarios("uiUx", "strongReasoning", [
    "Redesign the entire design system across every application while preserving accessibility.",
    "Migrate all legacy CSS themes to shared tokens without visual regressions.",
    "Audit the repository-wide UI architecture and resolve conflicting component patterns.",
    "Design a cross-platform theming engine with runtime switching and backward compatibility.",
    "Investigate why the responsive layout breaks intermittently across nested microfrontends.",
  ]),
  ...scenarios("softwareEngineering", "fastWorker", [
    "Add a nullable description field to this DTO.",
    "Rename this API response property to displayName.",
    "Explain what this middleware function returns.",
  ]),
  ...scenarios("softwareEngineering", "strongReasoning", [
    "Trace the distributed transaction failure across the API, queue, and database.",
    "Refactor the plugin lifecycle across the codebase without breaking existing integrations.",
  ]),
  ...scenarios("documentWork", "fastWorker", [
    "Summarize this PDF report into five bullet points.",
    "Rewrite this email in a polite professional tone.",
    "Extract the invoice number and due date from this document.",
    "Convert these meeting notes into a concise action list.",
    "Proofread this proposal and fix grammar only.",
    "Translate this short contract paragraph into Indonesian.",
    "Create a table of contents for this guide.",
  ]),
  ...scenarios("documentWork", "strongReasoning", [
    "Reconcile contradictions across twelve policy documents and produce one coherent standard.",
    "Compare two long contracts clause by clause and explain every material difference.",
  ]),
  ...scenarios("dataAnalytics", "fastWorker", [
    "Sort this CSV by date and remove duplicate rows.",
    "Calculate the average sales value in this spreadsheet.",
    "Convert this small JSON dataset into CSV columns.",
    "Create a simple bar chart from these monthly totals.",
  ]),
  ...scenarios("dataAnalytics", "strongReasoning", [
    "Diagnose the statistical bias across these datasets and propose a defensible correction.",
    "Design an ETL migration for billions of records with rollback and integrity guarantees.",
  ]),
  ...scenarios("writingLanguage", "fastWorker", [
    "Write a friendly follow-up email after yesterday's meeting.",
    "Shorten this product description to one paragraph.",
    "Translate this announcement into Spanish.",
    "Rewrite this paragraph for a non-technical audience.",
    "Generate three clear subject lines for this newsletter.",
  ]),
  ...scenarios("writingLanguage", "strongReasoning", [
    "Synthesize these conflicting interviews into a nuanced investigative narrative with citations.",
  ]),
  ...scenarios("creative", "fastWorker", [
    "Brainstorm ten names for a coffee shop.",
    "Write a playful birthday poem for my friend.",
    "Suggest a color palette for a tropical poster.",
  ]),
  ...scenarios("creative", "strongReasoning", [
    "Develop a consistent fictional world with political factions, history, and interlocking character arcs.",
  ]),
  ...scenarios("education", "fastWorker", [
    "Explain photosynthesis to a twelve-year-old.",
    "Create five basic vocabulary questions for an English learner.",
    "Teach me how fractions work using a pizza example.",
    "Give me a beginner study plan for learning Spanish.",
    "Quiz me on the capitals of Southeast Asia.",
  ]),
  ...scenarios("education", "strongReasoning", [
    "Design a semester curriculum that integrates physics, calculus, labs, and differentiated assessment.",
    "Compare three competing theories of learning and defend when each should guide instruction.",
  ]),
  ...scenarios("research", "fastWorker", [
    "Find the publication year and authors of this cited paper.",
    "List three primary sources about the Apollo program.",
  ]),
  ...scenarios("research", "strongReasoning", [
    "Synthesize the evidence from these studies and assess the strength of their competing conclusions.",
    "Design a reproducible literature review protocol with inclusion criteria and bias controls.",
    "Compare these benchmark methodologies and recommend the most defensible evaluation design.",
    "Evaluate conflicting historical sources and construct a sourced interpretation.",
  ]),
  ...scenarios("mathematicsLogic", "fastWorker", [
    "Calculate fifteen percent of 240.",
    "Convert this binary number to decimal.",
  ]),
  ...scenarios("mathematicsLogic", "strongReasoning", [
    "Prove this theorem step by step and justify every inference.",
    "Solve this constrained optimization problem and analyze all boundary cases.",
    "Determine whether this logical system is consistent under the stated axioms.",
  ]),
  ...scenarios("scienceEngineering", "fastWorker", [
    "Explain why the sky appears blue in simple terms.",
    "What is the difference between weather and climate?",
  ]),
  ...scenarios("scienceEngineering", "strongReasoning", [
    "Derive the heat-transfer model for this multilayer system and validate the assumptions.",
    "Analyze this experiment's confounders and design a statistically sound replication.",
    "Diagnose the control-system instability and compare three mitigation strategies.",
  ]),
  ...scenarios("businessStrategy", "fastWorker", [
    "Draft a simple agenda for the weekly team meeting.",
    "Create a basic SWOT list from these notes.",
    "Summarize this quarter's objectives for the team.",
  ]),
  ...scenarios("businessStrategy", "strongReasoning", [
    "Build a market-entry strategy with scenarios, unit economics, risks, and decision gates.",
    "Evaluate whether to build or buy this platform using technical and financial tradeoffs.",
  ]),
  ...scenarios("finance", "fastWorker", [
    "Explain the difference between a stock and a bond.",
    "Calculate the monthly payment for this fixed-rate loan.",
  ]),
  ...scenarios("finance", "strongReasoning", [
    "Assess this portfolio under recession scenarios and explain the concentration risks.",
    "Recommend an investment allocation for my retirement based on these personal constraints.",
  ]),
  ...scenarios("legal", "fastWorker", [
    "Define force majeure in plain language without giving legal advice.",
  ]),
  ...scenarios("legal", "strongReasoning", [
    "Analyze my potential liability under these conflicting contract clauses and jurisdictions.",
    "Develop a compliance strategy spanning privacy, retention, employment, and vendor obligations.",
  ]),
  ...scenarios("medicalHealth", "fastWorker", [
    "Explain what blood pressure numbers generally mean.",
  ]),
  ...scenarios("medicalHealth", "strongReasoning", [
    "Interpret these symptoms and medications to recommend what treatment I should take.",
    "Compare the risks of these procedures for a patient with multiple chronic conditions.",
  ]),
  ...scenarios("multimodal", "fastWorker", [
    "Transcribe the visible text from this screenshot.",
    "Describe the main objects in this image.",
    "Summarize the spoken points in this short audio clip.",
  ]),
  ...scenarios("multimodal", "strongReasoning", [
    "Compare all diagrams in this report and infer the system failure sequence.",
    "Analyze this hour-long video, correlate events with the logs, and identify the root cause.",
  ]),
  ...scenarios("softwareEngineering", "fastWorker", [
    "Run the formatter and the focused test for this file.",
    "Generate a commit message from the staged changes.",
    "Open the config and update this one environment value.",
  ]),
  ...scenarios("softwareEngineering", "strongReasoning", [
    "Investigate repeated CI failures across operating systems and toolchains.",
    "Plan and execute a zero-downtime deployment migration with rollback verification.",
  ]),
  ...scenarios("generalKnowledge", "fastWorker", [
    "Ringkas sejarah internet secara sederhana.",
    "Define supply and demand in plain language.",
  ]),
  ...scenarios("unknown", null, [
    "Make all of this somehow better.",
    "Handle the thing appropriately.",
    "Do what makes sense over there.",
    "Frobnicate the quux according to the blorb.",
    "Menurut lo yang beginian gimana ya?",
  ]),
];

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
  return { profile: detectRequestProfile(prompt), intent, adaptive };
}

test("100 general-purpose request wordings classify deterministically twice", () => {
  assert.equal(corpus.length, 100);
  assert.equal(new Set(corpus.map(({ prompt }) => prompt)).size, 100);

  const failures: string[] = [];
  for (const scenario of corpus) {
    const first = route(scenario.prompt);
    const second = route(scenario.prompt);
    assert.deepEqual(second, first, `${scenario.prompt} drifted between deterministic runs`);

    if (first.profile.domain !== scenario.domain) {
      failures.push(
        `${scenario.prompt} => domain expected=${scenario.domain} actual=${first.profile.domain}`
      );
    }
    if (first.adaptive.preferredRole !== scenario.role) {
      failures.push(
        `${scenario.prompt} => role expected=${scenario.role ?? "neutral"} ` +
          `actual=${first.adaptive.preferredRole ?? "neutral"}`
      );
    }
    if (scenario.role === null && !first.intent.shouldUseAiClassifier) {
      failures.push(`${scenario.prompt} => unresolved request did not request AI classification`);
    }
    if (scenario.role !== null && first.adaptive.requiresAiClassifier) {
      failures.push(
        `${scenario.prompt} => deterministic request still requested AI classification`
      );
    }
  }

  assert.deepEqual(failures, []);
});

test("request profiles expose independent artifacts for explainable routing", () => {
  const ui = detectRequestProfile(
    "Update this project UI theme to lime and make the palette aesthetic."
  );
  const mixed = detectRequestProfile(
    "Compare the API source code with the deployment config and summarize the PDF report."
  );

  assert.deepEqual(ui.artifacts, ["sourceCode", "userInterface"]);
  assert.deepEqual(mixed.artifacts, ["sourceCode", "document", "configuration", "deployment"]);
});
