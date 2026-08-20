type JsonRecord = Record<string, unknown>;

export const INTELLIGENT_STRATEGIES = ["auto", "lkgp"] as const;
export const INTELLIGENT_ROUTING_FILTERS = ["all", "intelligent", "deterministic"] as const;

export type IntelligentRoutingFilter = (typeof INTELLIGENT_ROUTING_FILTERS)[number];

export type IntelligentRoutingWeights = {
  quota: number;
  health: number;
  costInv: number;
  latencyInv: number;
  taskFit: number;
  stability: number;
  tierPriority: number;
  tierAffinity: number;
  specificityMatch: number;
  contextAffinity: number;
  cacheAffinity: number;
  sessionAvailability: number;
  resetWindowAffinity: number;
};

export type IntelligentRoutingConfig = {
  candidatePool: string[];
  fastWorkerModelRefs?: string[];
  strongReasoningModelRefs?: string[];
  adaptiveJudgeModelRef?: string;
  explorationRate: number;
  modePack: string;
  budgetCap?: number;
  weights: IntelligentRoutingWeights;
  fastWorkerWeights?: IntelligentRoutingWeights;
  strongReasoningWeights?: IntelligentRoutingWeights;
  routerStrategy: string;
  slaTargetP95Ms?: number;
  slaMaxErrorRate?: number;
  slaMaxCostPer1MTokens?: number;
  slaHardConstraints: boolean;
};

export const INTELLIGENT_ROLE_POOL_KEYS = [
  "fastWorkerModelRefs",
  "strongReasoningModelRefs",
] as const;

export type IntelligentRolePoolKey = (typeof INTELLIGENT_ROLE_POOL_KEYS)[number];

type ComboModelStepReference = {
  id?: unknown;
  kind?: unknown;
  model?: unknown;
  providerId?: unknown;
  connectionId?: unknown;
  label?: unknown;
};

export type IntelligentRoleModelOption = {
  stepId: string;
  model: string;
  providerId: string | null;
  connectionId: string | null;
  connectionLabel: string | null;
};

export type IntelligentProviderScore = {
  provider: string;
  model: string;
  score: number;
  factors: IntelligentRoutingWeights;
};

export const DEFAULT_INTELLIGENT_WEIGHTS: IntelligentRoutingWeights = {
  quota: 0.16,
  health: 0.2,
  costInv: 0.16,
  latencyInv: 0.12,
  taskFit: 0.08,
  stability: 0.05,
  tierPriority: 0.05,
  tierAffinity: 0.05,
  specificityMatch: 0.05,
  contextAffinity: 0.08,
  cacheAffinity: 0,
  sessionAvailability: 0.05,
  resetWindowAffinity: 0,
};

export const MODE_PACK_OPTIONS = [
  { id: "ship-fast", label: "Ship Fast", emoji: "rocket_launch" },
  { id: "cost-saver", label: "Cost Saver", emoji: "savings" },
  { id: "quality-first", label: "Quality First", emoji: "target" },
  { id: "offline-friendly", label: "Offline Friendly", emoji: "cloud_off" },
] as const;

export const ROUTER_STRATEGY_OPTIONS = [
  { id: "rules", label: "Rules (6-Factor Scoring)" },
  { id: "cost", label: "Cost Optimized" },
  { id: "latency", label: "Latency Optimized" },
  { id: "sla-aware", label: "SLA-aware" },
  { id: "lkgp", label: "Last Known Good Provider" },
] as const;

export const FACTOR_LABELS: Record<keyof IntelligentRoutingWeights, string> = {
  quota: "Quota",
  health: "Health",
  costInv: "Cost",
  latencyInv: "Latency",
  taskFit: "Task Fit",
  stability: "Stability",
  tierPriority: "Tier",
  tierAffinity: "Tier Affinity",
  specificityMatch: "Specificity",
  contextAffinity: "Context Affinity",
  cacheAffinity: "Cache Hit Affinity",
  sessionAvailability: "Session Availability",
  resetWindowAffinity: "Reset Window",
};

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function toFiniteNumber(value: unknown): number | null {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
}

function toPositiveNumber(value: unknown): number | undefined {
  const numericValue = toFiniteNumber(value);
  return numericValue !== null && numericValue > 0 ? numericValue : undefined;
}

function normalizeIntelligentWeights(value: unknown): IntelligentRoutingWeights {
  const rawWeights = isRecord(value) ? value : {};
  return {
    quota: toFiniteNumber(rawWeights.quota) ?? DEFAULT_INTELLIGENT_WEIGHTS.quota,
    health: toFiniteNumber(rawWeights.health) ?? DEFAULT_INTELLIGENT_WEIGHTS.health,
    costInv: toFiniteNumber(rawWeights.costInv) ?? DEFAULT_INTELLIGENT_WEIGHTS.costInv,
    latencyInv: toFiniteNumber(rawWeights.latencyInv) ?? DEFAULT_INTELLIGENT_WEIGHTS.latencyInv,
    taskFit: toFiniteNumber(rawWeights.taskFit) ?? DEFAULT_INTELLIGENT_WEIGHTS.taskFit,
    stability: toFiniteNumber(rawWeights.stability) ?? DEFAULT_INTELLIGENT_WEIGHTS.stability,
    tierPriority:
      toFiniteNumber(rawWeights.tierPriority) ?? DEFAULT_INTELLIGENT_WEIGHTS.tierPriority,
    tierAffinity:
      toFiniteNumber(rawWeights.tierAffinity) ?? DEFAULT_INTELLIGENT_WEIGHTS.tierAffinity,
    specificityMatch:
      toFiniteNumber(rawWeights.specificityMatch) ?? DEFAULT_INTELLIGENT_WEIGHTS.specificityMatch,
    contextAffinity:
      toFiniteNumber(rawWeights.contextAffinity) ?? DEFAULT_INTELLIGENT_WEIGHTS.contextAffinity,
    cacheAffinity:
      toFiniteNumber(rawWeights.cacheAffinity) ?? DEFAULT_INTELLIGENT_WEIGHTS.cacheAffinity,
    sessionAvailability:
      toFiniteNumber(rawWeights.sessionAvailability) ??
      DEFAULT_INTELLIGENT_WEIGHTS.sessionAvailability,
    resetWindowAffinity:
      toFiniteNumber(rawWeights.resetWindowAffinity) ??
      DEFAULT_INTELLIGENT_WEIGHTS.resetWindowAffinity,
  };
}

function normalizeModelStepRefs(value: unknown, modelSteps?: readonly unknown[]): string[] {
  if (!Array.isArray(value)) return [];

  const validStepIds = modelSteps
    ? new Set(
        modelSteps.flatMap((step) => {
          if (!isRecord(step) || step.kind !== "model") return [];
          const id = typeof step.id === "string" ? step.id.trim() : "";
          return id ? [id] : [];
        })
      )
    : null;
  const seen = new Set<string>();

  return value.flatMap((entry) => {
    if (typeof entry !== "string") return [];
    const ref = entry.trim();
    if (!ref || seen.has(ref) || (validStepIds && !validStepIds.has(ref))) return [];
    seen.add(ref);
    return [ref];
  });
}

function normalizeModelStepRef(
  value: unknown,
  modelSteps?: readonly unknown[]
): string | undefined {
  if (typeof value !== "string") return undefined;
  const ref = value.trim();
  if (!ref) return undefined;
  if (!modelSteps) return ref;
  return normalizeModelStepRefs([ref], modelSteps)[0];
}

/**
 * Normalize only the role-pool fields while preserving every unrelated runtime
 * config key. Passing model steps additionally removes stale/non-model refs.
 */
export function normalizeIntelligentRolePoolConfig<T extends JsonRecord>(
  config: T,
  modelSteps?: readonly ComboModelStepReference[]
): T {
  const next = { ...config } as JsonRecord;

  for (const key of INTELLIGENT_ROLE_POOL_KEYS) {
    if (!(key in config)) continue;
    next[key] = normalizeModelStepRefs(config[key], modelSteps);
  }

  if ("adaptiveJudgeModelRef" in config) {
    const judgeRef = normalizeModelStepRef(config.adaptiveJudgeModelRef, modelSteps);
    if (judgeRef) next.adaptiveJudgeModelRef = judgeRef;
    else delete next.adaptiveJudgeModelRef;
  }

  return next as T;
}

export function hasIntelligentRolePoolConfig(config: unknown): boolean {
  return (
    isRecord(config) &&
    (INTELLIGENT_ROLE_POOL_KEYS.some((key) => key in config) || "adaptiveJudgeModelRef" in config)
  );
}

/** Build role-selector options exclusively from explicit model Steps in this Combo. */
export function buildIntelligentRoleModelOptions(
  modelSteps: readonly ComboModelStepReference[]
): IntelligentRoleModelOption[] {
  const seen = new Set<string>();

  return modelSteps.flatMap((step) => {
    if (!isRecord(step) || step.kind !== "model") return [];
    const stepId = typeof step.id === "string" ? step.id.trim() : "";
    const model = typeof step.model === "string" ? step.model.trim() : "";
    if (!stepId || !model || seen.has(stepId)) return [];
    seen.add(stepId);

    return [
      {
        stepId,
        model,
        providerId:
          typeof step.providerId === "string" && step.providerId.trim()
            ? step.providerId.trim()
            : null,
        connectionId:
          typeof step.connectionId === "string" && step.connectionId.trim()
            ? step.connectionId.trim()
            : null,
        connectionLabel:
          typeof step.label === "string" && step.label.trim() ? step.label.trim() : null,
      },
    ];
  });
}

export function toggleIntelligentRoleModelRef(
  currentRefs: unknown,
  stepId: string,
  availableStepIds: readonly string[]
): string[] {
  const available = new Set(availableStepIds);
  const normalizedCurrent = normalizeModelStepRefs(currentRefs).filter((ref) => available.has(ref));
  if (!available.has(stepId)) return normalizedCurrent;
  return normalizedCurrent.includes(stepId)
    ? normalizedCurrent.filter((ref) => ref !== stepId)
    : [...normalizedCurrent, stepId];
}

export function isIntelligentStrategy(strategy: unknown): boolean {
  return typeof strategy === "string" && INTELLIGENT_STRATEGIES.includes(strategy as never);
}

export function getStrategyCategory(strategy: unknown): "intelligent" | "deterministic" {
  return isIntelligentStrategy(strategy) ? "intelligent" : "deterministic";
}

export function normalizeIntelligentRoutingFilter(value: unknown): IntelligentRoutingFilter {
  if (typeof value === "string" && INTELLIGENT_ROUTING_FILTERS.includes(value as never)) {
    return value as IntelligentRoutingFilter;
  }
  return "all";
}

export function filterCombosByStrategyCategory<T extends { strategy?: unknown }>(
  combos: T[],
  filter: IntelligentRoutingFilter
): T[] {
  if (filter === "all") return combos;
  return combos.filter((combo) => getStrategyCategory(combo?.strategy) === filter);
}

export function normalizeIntelligentRoutingConfig(config: unknown): IntelligentRoutingConfig {
  const configRecord = isRecord(config) ? config : {};
  const normalizedRolePools = normalizeIntelligentRolePoolConfig(configRecord);
  const rawSla = isRecord(configRecord.sla) ? configRecord.sla : {};
  const slaTargetP95Ms = configRecord.slaTargetP95Ms ?? rawSla.targetP95Ms;
  const slaMaxErrorRate = toFiniteNumber(configRecord.slaMaxErrorRate ?? rawSla.maxErrorRate);
  const slaMaxCostPer1MTokens = configRecord.slaMaxCostPer1MTokens ?? rawSla.maxCostPer1MTokens;
  const slaHardConstraints = configRecord.slaHardConstraints ?? rawSla.hardConstraints;

  return {
    candidatePool: Array.isArray(configRecord.candidatePool)
      ? configRecord.candidatePool.filter((value): value is string => typeof value === "string")
      : [],
    ...(INTELLIGENT_ROLE_POOL_KEYS[0] in configRecord
      ? { fastWorkerModelRefs: normalizedRolePools.fastWorkerModelRefs as string[] }
      : {}),
    ...(INTELLIGENT_ROLE_POOL_KEYS[1] in configRecord
      ? {
          strongReasoningModelRefs: normalizedRolePools.strongReasoningModelRefs as string[],
        }
      : {}),
    ...(typeof normalizedRolePools.adaptiveJudgeModelRef === "string"
      ? { adaptiveJudgeModelRef: normalizedRolePools.adaptiveJudgeModelRef }
      : {}),
    explorationRate: Math.min(1, Math.max(0, toFiniteNumber(configRecord.explorationRate) ?? 0.05)),
    modePack:
      typeof configRecord.modePack === "string" && configRecord.modePack.trim().length > 0
        ? configRecord.modePack
        : "ship-fast",
    budgetCap: toPositiveNumber(configRecord.budgetCap),
    weights: normalizeIntelligentWeights(configRecord.weights),
    ...(isRecord(configRecord.fastWorkerWeights)
      ? { fastWorkerWeights: normalizeIntelligentWeights(configRecord.fastWorkerWeights) }
      : {}),
    ...(isRecord(configRecord.strongReasoningWeights)
      ? { strongReasoningWeights: normalizeIntelligentWeights(configRecord.strongReasoningWeights) }
      : {}),
    routerStrategy:
      typeof configRecord.routerStrategy === "string" &&
      configRecord.routerStrategy.trim().length > 0
        ? configRecord.routerStrategy
        : "rules",
    slaTargetP95Ms: toPositiveNumber(slaTargetP95Ms),
    slaMaxErrorRate:
      slaMaxErrorRate !== null ? Math.min(1, Math.max(0, slaMaxErrorRate)) : undefined,
    slaMaxCostPer1MTokens: toPositiveNumber(slaMaxCostPer1MTokens),
    slaHardConstraints: slaHardConstraints === true,
  };
}

export function buildIntelligentProviderScores(combo: {
  config?: unknown;
  weights?: unknown;
}): IntelligentProviderScore[] {
  const configRecord = normalizeIntelligentRoutingConfig(combo?.config);
  const comboWeights = isRecord(combo?.weights) ? combo.weights : combo?.config;
  const weights = normalizeIntelligentRoutingConfig({
    ...(isRecord(comboWeights) ? comboWeights : {}),
    weights: isRecord(combo?.weights) ? combo.weights : configRecord.weights,
  }).weights;
  const pool = configRecord.candidatePool;
  const baseScore = pool.length > 0 ? 1 / pool.length : 0;

  return pool.map((provider) => ({
    provider,
    model: "auto",
    score: baseScore,
    factors: weights,
  }));
}
