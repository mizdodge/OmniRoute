import {
  classifyWithConfigDetailed,
  DEFAULT_INTENT_CONFIG,
  type ClassificationResult,
} from "../intentClassifier.ts";
import type { FrontRoutingContext } from "./routingContext.ts";
import {
  classifyAdaptiveTask,
  type AdaptiveRolePreference,
  type AdaptiveTaskClassification,
} from "./taskClassification.ts";

export interface ConversationContextResolution {
  status: "resolved" | "skipped" | "unresolved";
  role: AdaptiveRolePreference;
  score: number;
  previousRole: AdaptiveRolePreference;
  contextAge: number | null;
  signals: string[];
  reason:
    | "deterministic-confident"
    | "not-context-dependent"
    | "missing-context"
    | "no-relevant-context"
    | "casual-context-followup"
    | "reasoning-context-followup";
}

type ContextCandidate = { prompt: string; source: "user" | "assistant" };

function recentContextCandidates(summary: string): ContextCandidate[] {
  const entries = summary
    .split("\n")
    .map((line): ContextCandidate | null => {
      const match = line.match(/^(user|assistant):\s*(.+)$/i);
      if (!match?.[2]) return null;
      return {
        prompt: match[2].trim(),
        source: match[1]?.toLowerCase() === "user" ? "user" : "assistant",
      };
    })
    .filter((entry): entry is ContextCandidate => entry !== null);
  const userEntries = entries
    .filter(({ source }) => source === "user")
    .slice(-2)
    .reverse();
  if (userEntries.length > 0) return userEntries;
  return entries
    .filter(({ source }) => source === "assistant")
    .slice(-2)
    .reverse();
}

export function resolveConversationContext(
  intent: ClassificationResult,
  adaptive: AdaptiveTaskClassification,
  context: FrontRoutingContext
): ConversationContextResolution {
  if (adaptive.preferredRole) {
    return {
      status: "skipped",
      role: null,
      score: 0,
      previousRole: null,
      contextAge: null,
      signals: ["deterministic-role"],
      reason: "deterministic-confident",
    };
  }
  if (!intent.contextual.contextDependent && !intent.casual.contextDependent) {
    return {
      status: "skipped",
      role: null,
      score: 0,
      previousRole: null,
      contextAge: null,
      signals: ["current-request-independent"],
      reason: "not-context-dependent",
    };
  }

  const recentCandidates = recentContextCandidates(context.recentWorkSummary);
  if (recentCandidates.length === 0) {
    return {
      status: "unresolved",
      role: null,
      score: 0,
      previousRole: null,
      contextAge: null,
      signals: ["recent-user-context:none"],
      reason: "missing-context",
    };
  }

  for (let index = 0; index < recentCandidates.length; index += 1) {
    const candidate = recentCandidates[index];
    const previousPrompt = candidate?.prompt ?? "";
    const previousIntent = classifyWithConfigDetailed(previousPrompt, DEFAULT_INTENT_CONFIG);
    const previousAdaptive = classifyAdaptiveTask(
      previousIntent.type,
      undefined,
      Math.ceil(previousPrompt.length / 4),
      previousPrompt,
      undefined,
      previousIntent
    );
    const previousRole = previousIntent.casual.isCasual
      ? "fastWorker"
      : previousAdaptive.preferredRole;
    if (!previousRole) continue;

    const decay = index === 0 ? 1 : 0.72;
    const failureBoost = context.execution.recentFailures >= 2 ? 0.15 : 0;
    const score = Math.min(
      1,
      0.75 * decay + (previousRole === "strongReasoning" ? failureBoost : 0)
    );
    return {
      status: "resolved",
      role: previousRole,
      score,
      previousRole,
      contextAge: index + 1,
      signals: [
        `previous-role:${previousRole}`,
        `context-source:${candidate?.source ?? "unknown"}`,
        `context-age:${index + 1}`,
        ...(failureBoost > 0 ? ["recent-failures"] : []),
      ],
      reason:
        previousRole === "strongReasoning"
          ? "reasoning-context-followup"
          : "casual-context-followup",
    };
  }

  return {
    status: "unresolved",
    role: null,
    score: 0,
    previousRole: null,
    contextAge: null,
    signals: ["recent-user-context:ambiguous"],
    reason: "no-relevant-context",
  };
}
