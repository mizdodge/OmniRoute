import type { ClassificationResult, IntentType } from "../intentClassifier.ts";
import type { FrontRoutingContext } from "./routingContext.ts";

export type AdaptiveRolePreference = "fastWorker" | "strongReasoning" | null;

export type AdaptiveRoleScores = {
  fastWorker: number;
  strongReasoning: number;
};

export type AdaptiveTaskClassification = {
  complexity: "simple" | "complex" | "neutral";
  preferredRole: AdaptiveRolePreference;
  /** Independent deterministic evidence scores used to choose the adaptive role. */
  scores: AdaptiveRoleScores;
  /** Absolute distance between the Fast and Strong scores. */
  margin: number;
  /** Per-signal contributions to each adaptive role score. */
  factorScores: Record<string, AdaptiveRoleScores>;
  /** Internal provenance for tests and diagnostics; logs use the less ambiguous `reason`. */
  decisionSource: "deterministic" | "ai_tiebreaker" | "fallback";
  decisionReason: string;
  /** True when deterministic evidence is too weak to safely choose a role. */
  requiresAiClassifier: boolean;
  signals: string[];
};

const COMPLEX_INTENTS = new Set<IntentType>(["math", "reasoning"]);

const LIGHT_CODE_RE =
  /\b(format|formatter|lint|rename|typo|comment|read|search|find|status|one[- ]?line|small change|quick fix|run (?:the )?tests?|check (?:the )?tests?)\b/i;
const HEAVY_CODE_RE =
  /\b(debug|root cause|architecture|architectural|refactor|migrate|migration|implement(?:ation)?|design|investigate|trace|multi[- ]?file|multiple files|whole codebase|repo(?:sitory)?[- ]?wide|security|vulnerability|race condition|deadlock|performance regression)\b/i;

export const ADAPTIVE_ROLE_MIN_SCORE = 0.35;
export const ADAPTIVE_ROLE_MIN_MARGIN = 0.18;

const NO_ROLE_SCORE: AdaptiveRoleScores = { fastWorker: 0, strongReasoning: 0 };

const DETERMINISTIC_FACTOR_WEIGHT = {
  simpleIntent: { fastWorker: 0.75, strongReasoning: 0 },
  mediumIntent: { fastWorker: 0.35, strongReasoning: 0 },
  creativeIntent: { fastWorker: 0.15, strongReasoning: 0.25 },
  codeIntent: { fastWorker: 0.25, strongReasoning: 0.25 },
  complexIntent: { fastWorker: 0, strongReasoning: 0.8 },
  shortCurrentRequest: { fastWorker: 0.2, strongReasoning: 0 },
  substantialCurrentRequest: { fastWorker: 0, strongReasoning: 0.35 },
  longCurrentRequest: { fastWorker: 0, strongReasoning: 0.65 },
  explicitToolChoice: { fastWorker: 0, strongReasoning: 0.6 },
  highReasoningEffort: { fastWorker: 0, strongReasoning: 0.85 },
  repeatedFailures: { fastWorker: 0, strongReasoning: 0.75 },
  heavyCode: { fastWorker: 0, strongReasoning: 0.75 },
  lightCode: { fastWorker: 0.75, strongReasoning: 0 },
} as const;

function roundScore(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

function combineRoleEvidence(
  factorScores: Record<string, AdaptiveRoleScores>,
  role: keyof AdaptiveRoleScores
): number {
  const remainingUncertainty = Object.values(factorScores).reduce(
    (remaining, contribution) => remaining * (1 - contribution[role]),
    1
  );
  return roundScore(1 - remainingUncertainty);
}

function classification(
  factorScores: Record<string, AdaptiveRoleScores>,
  intent: IntentType,
  intentClassification?: ClassificationResult
): AdaptiveTaskClassification {
  const scores = {
    fastWorker: combineRoleEvidence(factorScores, "fastWorker"),
    strongReasoning: combineRoleEvidence(factorScores, "strongReasoning"),
  };
  const margin = roundScore(Math.abs(scores.fastWorker - scores.strongReasoning));
  const winnerScore = Math.max(scores.fastWorker, scores.strongReasoning);
  const deterministicRole: AdaptiveRolePreference =
    winnerScore < ADAPTIVE_ROLE_MIN_SCORE || margin < ADAPTIVE_ROLE_MIN_MARGIN
      ? null
      : scores.fastWorker > scores.strongReasoning
        ? "fastWorker"
        : "strongReasoning";
  const requiresAiClassifier = intentClassification?.shouldUseAiClassifier === true;
  const preferredRole = requiresAiClassifier ? null : deterministicRole;
  const decisionReason = requiresAiClassifier
    ? (intentClassification?.reason ?? "low-confidence-intent")
    : preferredRole
      ? intentClassification?.task.recognized
        ? intentClassification.task.reason
        : `recognized-${intent}-intent`
      : "conflicting-or-low-evidence";
  return {
    complexity:
      preferredRole === "fastWorker"
        ? "simple"
        : preferredRole === "strongReasoning"
          ? "complex"
          : "neutral",
    preferredRole,
    scores,
    margin,
    factorScores,
    decisionSource: preferredRole ? "deterministic" : "fallback",
    decisionReason,
    requiresAiClassifier,
    signals: Object.keys(factorScores),
  };
}

function isAutomationContinuation(body: Record<string, unknown> | null | undefined): boolean {
  if (!Array.isArray(body?.messages)) return false;
  for (let index = body.messages.length - 1; index >= 0; index -= 1) {
    const message = body.messages[index];
    if (!message || typeof message !== "object" || Array.isArray(message)) continue;
    const role = String((message as Record<string, unknown>).role ?? "").toLowerCase();
    if (!role) continue;
    return role === "assistant" || role === "tool" || role === "function";
  }
  return false;
}

function hasExplicitToolChoice(body: Record<string, unknown> | null | undefined): boolean {
  const choice = body?.tool_choice ?? body?.toolChoice;
  if (choice === "required" || choice === "any") return true;
  if (!choice || typeof choice !== "object" || Array.isArray(choice)) return false;

  const record = choice as Record<string, unknown>;
  if (record.type === "auto" || record.type === "none") return false;
  return (
    record.type === "required" || record.type === "any" || "function" in record || "name" in record
  );
}

/**
 * Convert the existing multilingual intent result plus cheap request-shape
 * signals into an adaptive role preference. This is synchronous and performs no
 * model call or I/O. Ambiguous requests remain neutral instead of guessing.
 */
export function classifyAdaptiveTask(
  intent: IntentType,
  body: Record<string, unknown> | null | undefined,
  estimatedInputTokens = 0,
  prompt = "",
  routingContext?: FrontRoutingContext,
  intentClassification?: ClassificationResult
): AdaptiveTaskClassification {
  const factorScores: Record<string, AdaptiveRoleScores> = {};
  const automationContinuation =
    routingContext?.execution.isContinuation ?? isAutomationContinuation(body);
  const reasoning = body?.reasoning;
  const bodyEffort = String(
    body?.reasoning_effort ??
      (reasoning && typeof reasoning === "object" && !Array.isArray(reasoning)
        ? (reasoning as Record<string, unknown>).effort
        : "") ??
      ""
  ).toLowerCase();
  const effort = routingContext?.execution.reasoningEffort ?? bodyEffort;
  const highEffort = /^(high|xhigh|max|maximum|hard|deep)$/.test(effort);

  const profileMarksComplex = intentClassification?.profile.complexity === "complex";
  if (intent === "simple" && !profileMarksComplex) {
    factorScores["intent:simple"] = DETERMINISTIC_FACTOR_WEIGHT.simpleIntent;
  } else if (intent === "medium" && !profileMarksComplex) {
    factorScores["intent:medium"] = DETERMINISTIC_FACTOR_WEIGHT.mediumIntent;
  } else if (intent === "creative") {
    factorScores["intent:creative"] = DETERMINISTIC_FACTOR_WEIGHT.creativeIntent;
  } else if (intent === "code") {
    factorScores["intent:code"] = DETERMINISTIC_FACTOR_WEIGHT.codeIntent;
  }
  const profileMarksSimple = intentClassification?.profile.complexity === "simple";
  if (COMPLEX_INTENTS.has(intent) && !profileMarksSimple) {
    factorScores[`intent:${intent}`] = DETERMINISTIC_FACTOR_WEIGHT.complexIntent;
  }
  const taskEvidence = intentClassification?.task;
  const profileEvidence = intentClassification?.profile;
  if (profileEvidence?.recognized && profileEvidence.complexity === "complex") {
    factorScores[`profile:${profileEvidence.domain}`] = profileEvidence.roleEvidence;
  } else if (taskEvidence?.recognized) {
    factorScores[`task:${taskEvidence.family}`] = taskEvidence.roleEvidence;
  } else if (profileEvidence?.recognized) {
    factorScores[`profile:${profileEvidence.domain}`] = profileEvidence.roleEvidence;
  }
  if (!automationContinuation && hasExplicitToolChoice(body)) {
    factorScores["explicit-tool-choice"] = DETERMINISTIC_FACTOR_WEIGHT.explicitToolChoice;
  }
  if (prompt.trim() && estimatedInputTokens > 0 && estimatedInputTokens <= 256) {
    factorScores["short-current-request"] = DETERMINISTIC_FACTOR_WEIGHT.shortCurrentRequest;
  } else if (estimatedInputTokens >= 2_000) {
    factorScores["long-current-request"] = DETERMINISTIC_FACTOR_WEIGHT.longCurrentRequest;
  } else if (estimatedInputTokens >= 512) {
    factorScores["substantial-current-request"] =
      DETERMINISTIC_FACTOR_WEIGHT.substantialCurrentRequest;
  }
  if (highEffort) {
    factorScores["high-reasoning-effort"] = DETERMINISTIC_FACTOR_WEIGHT.highReasoningEffort;
  }
  if (
    automationContinuation &&
    (routingContext?.execution.recentFailures ?? 0) >= 2 &&
    /\b(fix|debug|investigate|trace|resolve|continue|lanjut|perbaiki)\b/i.test(prompt)
  ) {
    factorScores["continuation:repeated-failures"] = DETERMINISTIC_FACTOR_WEIGHT.repeatedFailures;
  }

  if (intent === "code") {
    if (HEAVY_CODE_RE.test(prompt)) {
      factorScores["code:heavy"] = DETERMINISTIC_FACTOR_WEIGHT.heavyCode;
    } else if (intentClassification?.task.complexity !== "complex" && LIGHT_CODE_RE.test(prompt)) {
      factorScores["code:light"] = DETERMINISTIC_FACTOR_WEIGHT.lightCode;
    }
  }
  return classification(
    Object.keys(factorScores).length > 0 ? factorScores : { none: NO_ROLE_SCORE },
    intent,
    intentClassification
  );
}

/** Mode packs reserve a conservative fraction of the total score for role fit. */
export function getAdaptiveRoleWeight(
  modePack: string | undefined,
  preferredRole: Exclude<AdaptiveRolePreference, null>
): number {
  if (modePack === "ship-fast") return preferredRole === "fastWorker" ? 0.18 : 0.12;
  if (modePack === "quality-first") return preferredRole === "strongReasoning" ? 0.2 : 0.12;
  if (modePack === "cost-saver") return preferredRole === "fastWorker" ? 0.16 : 0.12;
  return 0.12;
}
