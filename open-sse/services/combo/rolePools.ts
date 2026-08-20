import { isRecord } from "./comboData.ts";
import type { ResolvedComboTarget } from "./types.ts";

export type IntelligentRole = "fastWorker" | "strongReasoning";

export type ResolvedRolePoolCandidates = {
  fastWorker: ResolvedComboTarget[];
  strongReasoning: ResolvedComboTarget[];
  unassigned: ResolvedComboTarget[];
  all: ResolvedComboTarget[];
};

function normalizeRefs(value: unknown): Set<string> {
  if (!Array.isArray(value)) return new Set();
  return new Set(
    value.flatMap((entry) => {
      if (typeof entry !== "string") return [];
      const ref = entry.trim();
      return ref ? [ref] : [];
    })
  );
}

function dedupeTargets(targets: readonly ResolvedComboTarget[]): ResolvedComboTarget[] {
  const seen = new Set<string>();
  return targets.filter((target) => {
    if (seen.has(target.executionKey)) return false;
    seen.add(target.executionKey);
    return true;
  });
}

/**
 * Resolve configured step references against targets that already survived the
 * combo's normal eligibility filters. Role membership never revives an
 * unavailable target and never creates a second model registry.
 */
export function resolveRolePoolCandidates(
  config: unknown,
  eligibleTargets: readonly ResolvedComboTarget[]
): ResolvedRolePoolCandidates {
  const configRecord = isRecord(config) ? config : {};
  const fastRefs = normalizeRefs(configRecord.fastWorkerModelRefs);
  const strongRefs = normalizeRefs(configRecord.strongReasoningModelRefs);
  const judgeRef =
    typeof configRecord.adaptiveJudgeModelRef === "string"
      ? configRecord.adaptiveJudgeModelRef.trim()
      : "";
  const judgeIsWorker = fastRefs.has(judgeRef) || strongRefs.has(judgeRef);
  // Selecting a Step as the AI Judger must not silently make it a response
  // candidate. It may only join the worker universe when the operator also
  // assigns that same Step to Fast Worker or Strong Reasoning explicitly.
  const all = dedupeTargets(eligibleTargets).filter(
    (target) => !judgeRef || judgeIsWorker || target.stepId !== judgeRef
  );

  return {
    fastWorker: all.filter((target) => fastRefs.has(target.stepId)),
    strongReasoning: all.filter((target) => strongRefs.has(target.stepId)),
    unassigned: all.filter(
      (target) => !fastRefs.has(target.stepId) && !strongRefs.has(target.stepId)
    ),
    all,
  };
}

/** Resolve the one configured AI Judger by stable Step ID from this Combo only. */
export function resolveAdaptiveJudgeTarget(
  config: unknown,
  comboTargets: readonly ResolvedComboTarget[]
): ResolvedComboTarget | null {
  const configRecord = isRecord(config) ? config : {};
  const ref =
    typeof configRecord.adaptiveJudgeModelRef === "string"
      ? configRecord.adaptiveJudgeModelRef.trim()
      : "";
  if (!ref) return null;
  return comboTargets.find((target) => target.stepId === ref) ?? null;
}

/**
 * Build one finite fallback chain: preferred role, other role, then ordinary
 * worker candidates. Judge-only Steps were removed while resolving the pools.
 * There is no recursion, so cross-role fallback cannot loop.
 */
export function buildRolePoolFailoverOrder(
  pools: ResolvedRolePoolCandidates,
  preferredRole: IntelligentRole
): ResolvedComboTarget[] {
  const preferred = preferredRole === "fastWorker" ? pools.fastWorker : pools.strongReasoning;
  const alternate = preferredRole === "fastWorker" ? pools.strongReasoning : pools.fastWorker;
  return dedupeTargets([...preferred, ...alternate, ...pools.unassigned, ...pools.all]);
}
