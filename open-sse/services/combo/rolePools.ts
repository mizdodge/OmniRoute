import { isRecord } from "./comboData.ts";
import type { ResolvedComboTarget } from "./types.ts";

export type IntelligentRole = "fastWorker" | "strongReasoning";
export type AdaptiveFallbackClass = IntelligentRole | "general";
export type AdaptiveWorkerMembership = AdaptiveFallbackClass | "both";

/**
 * Internal per-request routing metadata. These fields live only on resolved Combo
 * targets; they are never copied into the upstream request body.
 */
export type AdaptiveClassifiedTarget = ResolvedComboTarget & {
  _omnirouteAdaptiveWorkerMembership?: AdaptiveWorkerMembership;
  _omnirouteAdaptiveFallbackClass?: AdaptiveFallbackClass;
  _omnirouteAdaptiveFallbackTier?: number;
};

export type ResolvedRolePoolCandidates = {
  fastWorker: AdaptiveClassifiedTarget[];
  strongReasoning: AdaptiveClassifiedTarget[];
  unassigned: AdaptiveClassifiedTarget[];
  all: AdaptiveClassifiedTarget[];
};

export type AdaptiveFallbackTier = {
  fallbackClass: AdaptiveFallbackClass;
  targets: AdaptiveClassifiedTarget[];
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

function dedupeTargets<T extends ResolvedComboTarget>(targets: readonly T[]): T[] {
  const seen = new Set<string>();
  return targets.filter((target) => {
    if (seen.has(target.executionKey)) return false;
    seen.add(target.executionKey);
    return true;
  });
}

function resolveMembership(
  stepId: string,
  fastRefs: ReadonlySet<string>,
  strongRefs: ReadonlySet<string>
): AdaptiveWorkerMembership {
  const fast = fastRefs.has(stepId);
  const strong = strongRefs.has(stepId);
  if (fast && strong) return "both";
  if (fast) return "fastWorker";
  if (strong) return "strongReasoning";
  return "general";
}

/**
 * Resolve configured step references against targets that already survived the
 * combo's normal eligibility filters. Role membership never revives an
 * unavailable target and never creates a second model registry.
 *
 * Each returned target is request-local and carries its worker membership so
 * downstream task/cache ordering can preserve fallback-class boundaries instead
 * of flattening Strong, Fast, and General workers into one list.
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
  const all = dedupeTargets(eligibleTargets)
    .filter((target) => !judgeRef || judgeIsWorker || target.stepId !== judgeRef)
    .map(
      (target): AdaptiveClassifiedTarget => ({
        ...target,
        _omnirouteAdaptiveWorkerMembership: resolveMembership(
          target.stepId,
          fastRefs,
          strongRefs
        ),
      })
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
 * Build explicit fallback classes for one adaptive request. The selected role is
 * exhausted first, then the opposite worker role, and General/unassigned models
 * are always the final safety pool. A target assigned to both roles is consumed
 * in the preferred tier and deduplicated before the alternate tier executes.
 */
export function buildRolePoolFallbackTiers(
  pools: ResolvedRolePoolCandidates,
  preferredRole: IntelligentRole
): AdaptiveFallbackTier[] {
  const preferred = preferredRole === "fastWorker" ? pools.fastWorker : pools.strongReasoning;
  const alternateRole: IntelligentRole =
    preferredRole === "fastWorker" ? "strongReasoning" : "fastWorker";
  const alternate = alternateRole === "fastWorker" ? pools.fastWorker : pools.strongReasoning;

  return [
    { fallbackClass: preferredRole, targets: dedupeTargets(preferred) },
    { fallbackClass: alternateRole, targets: dedupeTargets(alternate) },
    { fallbackClass: "general", targets: dedupeTargets(pools.unassigned) },
  ];
}

/**
 * Build one finite categorized fallback chain. Each target is stamped with its
 * request-local fallback tier so downstream task-aware ordering can rank models
 * *inside* a pool without ever moving one across a pool boundary.
 *
 * Order is authoritative: preferred role -> opposite role -> General.
 */
export function buildRolePoolFailoverOrder(
  pools: ResolvedRolePoolCandidates,
  preferredRole: IntelligentRole
): ResolvedComboTarget[] {
  const seen = new Set<string>();
  const tiered: AdaptiveClassifiedTarget[] = [];
  const tiers = buildRolePoolFallbackTiers(pools, preferredRole);

  tiers.forEach((tier, tierIndex) => {
    for (const target of tier.targets) {
      if (seen.has(target.executionKey)) continue;
      seen.add(target.executionKey);
      tiered.push({
        ...target,
        _omnirouteAdaptiveFallbackClass: tier.fallbackClass,
        _omnirouteAdaptiveFallbackTier: tierIndex,
      });
    }
  });

  // Preserve legacy/malformed callers that placed a target only in `all`, but
  // force those extras into the final General tier so they can never jump ahead
  // of configured Fast/Strong worker pools.
  for (const target of pools.all) {
    if (seen.has(target.executionKey)) continue;
    seen.add(target.executionKey);
    tiered.push({
      ...target,
      _omnirouteAdaptiveFallbackClass: "general",
      _omnirouteAdaptiveFallbackTier: 2,
    });
  }

  return tiered;
}
