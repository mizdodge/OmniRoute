import type { IntentType } from "../intentClassifier.ts";

export type AdaptiveRolePreference = "fastWorker" | "strongReasoning" | null;

export type AdaptiveTaskClassification = {
  complexity: "simple" | "complex" | "neutral";
  preferredRole: AdaptiveRolePreference;
  signals: string[];
};

const COMPLEX_INTENTS = new Set<IntentType>(["math", "reasoning"]);

const LIGHT_CODE_RE =
  /\b(format|formatter|lint|rename|typo|comment|read|search|find|status|one[- ]?line|small change|quick fix|run (?:the )?tests?|check (?:the )?tests?)\b/i;
const HEAVY_CODE_RE =
  /\b(debug|root cause|architecture|architectural|refactor|migrate|migration|implement(?:ation)?|design|investigate|trace|multi[- ]?file|multiple files|codebase|repository|repo[- ]?wide|security|vulnerability|race condition|deadlock|performance regression)\b/i;

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
  prompt = ""
): AdaptiveTaskClassification {
  const signals: string[] = [];
  const automationContinuation = isAutomationContinuation(body);

  if (COMPLEX_INTENTS.has(intent)) signals.push(`intent:${intent}`);
  if (!automationContinuation && hasExplicitToolChoice(body)) signals.push("explicit-tool-choice");
  if (estimatedInputTokens >= 2_000) signals.push("long-context");

  if (signals.length > 0) {
    return { complexity: "complex", preferredRole: "strongReasoning", signals };
  }
  if (intent === "code") {
    if (HEAVY_CODE_RE.test(prompt)) {
      return { complexity: "complex", preferredRole: "strongReasoning", signals: ["code:heavy"] };
    }
    if (LIGHT_CODE_RE.test(prompt)) {
      return { complexity: "simple", preferredRole: "fastWorker", signals: ["code:light"] };
    }
    return { complexity: "neutral", preferredRole: null, signals: ["intent:code"] };
  }
  if (intent === "simple") {
    return { complexity: "simple", preferredRole: "fastWorker", signals: ["intent:simple"] };
  }
  return { complexity: "neutral", preferredRole: null, signals: [`intent:${intent}`] };
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
