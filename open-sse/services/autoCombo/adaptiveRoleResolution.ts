export type AdaptiveRouterRole = "fastWorker" | "strongReasoning";

export interface RouterScoredRoleTarget {
  target: { stepId: string };
  score: number;
}

/**
 * Scores within this distance are treated as the same router decision. This is
 * intentionally much smaller than any user-facing scoring precision while still
 * absorbing floating-point normalization noise.
 */
export const ROUTER_ROLE_SCORE_EPSILON = 1e-4;

/**
 * Resolve a deterministic Fast Worker / Strong Reasoning preference from the
 * normal Auto router's neutral scoring pass.
 *
 * Only the top score band matters. A uniquely-role-assigned winner resolves the
 * request without an AI classifier call. The result stays neutral when the top
 * band contains General/unassigned candidates, a Step assigned to both roles, or
 * equally-scored candidates from opposing roles.
 */
export function resolveNeutralRoleFromRouterScores(
  scoredTargets: readonly RouterScoredRoleTarget[],
  fastWorkerStepIds: ReadonlySet<string>,
  strongReasoningStepIds: ReadonlySet<string>
): AdaptiveRouterRole | null {
  if (scoredTargets.length === 0) return null;

  const topScore = scoredTargets[0]?.score;
  if (!Number.isFinite(topScore)) return null;

  let resolvedRole: AdaptiveRouterRole | null = null;
  for (const entry of scoredTargets) {
    if (!Number.isFinite(entry.score)) return null;
    if ((topScore as number) - entry.score > ROUTER_ROLE_SCORE_EPSILON) break;

    const isFastWorker = fastWorkerStepIds.has(entry.target.stepId);
    const isStrongReasoning = strongReasoningStepIds.has(entry.target.stepId);

    // General/unassigned and dual-role winners are role-neutral by definition.
    if (isFastWorker === isStrongReasoning) return null;

    const role: AdaptiveRouterRole = isFastWorker ? "fastWorker" : "strongReasoning";
    if (resolvedRole && resolvedRole !== role) return null;
    resolvedRole = role;
  }

  return resolvedRole;
}
