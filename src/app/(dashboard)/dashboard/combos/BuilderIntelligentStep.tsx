"use client";

import { useMemo } from "react";
import Card from "@/shared/components/Card";
import {
  DEFAULT_INTELLIGENT_WEIGHTS,
  FACTOR_LABELS,
  MODE_PACK_OPTIONS,
  ROUTER_STRATEGY_OPTIONS,
  type IntelligentRoutingWeights,
  type IntelligentRoleModelOption,
  type IntelligentRolePoolKey,
  normalizeIntelligentRoutingConfig,
  toggleIntelligentRoleModelRef,
} from "@/lib/combos/intelligentRouting";
import { AI_PROVIDERS } from "@/shared/constants/providers";
import { compareTr } from "@/shared/utils/turkishText";

function getI18nOrFallback(
  t: any,
  key: string,
  fallback: string,
  values?: Record<string, string | number>
) {
  if (typeof t?.has === "function" && t.has(key)) return t(key, values);
  return fallback;
}

function toProviderOptions(activeProviders: any[] = [], candidatePool: string[] = []) {
  const uniqueProviders = new Map<string, { id: string; label: string; connectionCount: number }>();

  activeProviders.forEach((provider) => {
    const providerId =
      typeof provider?.providerId === "string" && provider.providerId.trim().length > 0
        ? provider.providerId
        : typeof provider?.provider === "string" && provider.provider.trim().length > 0
          ? provider.provider
          : typeof provider?.id === "string" && provider.id.trim().length > 0
            ? provider.id
            : null;

    if (!providerId) return;

    const currentEntry = uniqueProviders.get(providerId);
    const fallbackLabel =
      typeof provider?.displayName === "string" && provider.displayName.trim().length > 0
        ? provider.displayName
        : typeof provider?.providerName === "string" && provider.providerName.trim().length > 0
          ? provider.providerName
          : (AI_PROVIDERS as Record<string, any>)[providerId]?.name || providerId;
    const connectionCount =
      typeof provider?.activeConnectionCount === "number"
        ? provider.activeConnectionCount
        : typeof provider?.connectionCount === "number"
          ? provider.connectionCount
          : 1;

    uniqueProviders.set(providerId, {
      id: providerId,
      label: currentEntry?.label || fallbackLabel,
      connectionCount: (currentEntry?.connectionCount || 0) + connectionCount,
    });
  });

  candidatePool.forEach((poolId) => {
    if (!uniqueProviders.has(poolId)) {
      uniqueProviders.set(poolId, {
        id: poolId,
        label: `${poolId} (Offline/Deleted)`,
        connectionCount: 0,
      });
    }
  });

  return [...uniqueProviders.values()].sort((a, b) => compareTr(a.label, b.label));
}

function RolePoolSelector({
  t,
  field,
  title,
  hint,
  options,
  selectedRefs,
  onToggle,
}: {
  t: any;
  field: IntelligentRolePoolKey;
  title: string;
  hint: string;
  options: IntelligentRoleModelOption[];
  selectedRefs: string[];
  onToggle: (field: IntelligentRolePoolKey, stepId: string) => void;
}) {
  const availableIds = new Set(options.map((option) => option.stepId));
  const selectedCount = selectedRefs.filter((ref) => availableIds.has(ref)).length;
  const staleCount = selectedRefs.length - selectedCount;

  return (
    <Card.Section>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-text-main">{title}</p>
          <p className="text-[11px] text-text-muted mt-1">{hint}</p>
        </div>
        <span className="shrink-0 rounded-full bg-primary/10 px-2 py-1 text-[10px] font-semibold text-primary">
          {getI18nOrFallback(t, "rolePoolSelectedCount", "{count} selected", {
            count: selectedCount,
          }).replace("{count}", String(selectedCount))}
        </span>
      </div>

      {options.length === 0 ? (
        <p className="mt-3 rounded-md border border-dashed border-black/10 dark:border-white/10 px-3 py-2 text-[11px] text-text-muted">
          {getI18nOrFallback(
            t,
            "rolePoolNoModels",
            "Add model Steps before assigning Smart Routing roles."
          )}
        </p>
      ) : (
        <div className="mt-3 flex flex-col gap-2" role="group" aria-label={title}>
          {options.map((option) => {
            const isSelected = selectedRefs.includes(option.stepId);
            const connectionText = option.connectionId
              ? option.connectionLabel || option.connectionId
              : getI18nOrFallback(t, "rolePoolAutoConnection", "Automatic connection");

            return (
              <button
                key={`${field}-${option.stepId}`}
                type="button"
                aria-pressed={isSelected}
                onClick={() => onToggle(field, option.stepId)}
                className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors ${
                  isSelected
                    ? "border-primary bg-primary/10"
                    : "border-black/10 dark:border-white/10 hover:border-primary/40 hover:bg-primary/5"
                }`}
              >
                <span
                  className={`material-symbols-outlined text-[18px] ${
                    isSelected ? "text-primary" : "text-text-muted"
                  }`}
                >
                  {isSelected ? "check_circle" : "radio_button_unchecked"}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium text-text-main">
                    {option.model}
                  </span>
                  <span className="block truncate text-[10px] text-text-muted">
                    {connectionText}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      {staleCount > 0 && (
        <p className="mt-2 text-[10px] text-amber-700 dark:text-amber-300">
          {getI18nOrFallback(
            t,
            "rolePoolStaleRefs",
            "{count} unavailable selection(s) will be removed when this Combo is saved.",
            { count: staleCount }
          ).replace("{count}", String(staleCount))}
        </p>
      )}
    </Card.Section>
  );
}

function WeightSliders({
  t,
  weights,
  onChange,
}: {
  t: any;
  weights: IntelligentRoutingWeights;
  onChange: (weightKey: keyof IntelligentRoutingWeights, value: number) => void;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
      {Object.entries(weights).map(([weightKey, weightValue]) => (
        <div key={weightKey} className="rounded-lg border border-black/6 dark:border-white/6 p-3">
          <div className="flex items-center justify-between gap-2">
            <label className="text-[11px] font-medium text-text-main">
              {getI18nOrFallback(
                t,
                `weight${weightKey[0].toUpperCase()}${weightKey.slice(1)}`,
                FACTOR_LABELS[weightKey as keyof typeof DEFAULT_INTELLIGENT_WEIGHTS]
              )}
            </label>
            <span className="text-[11px] text-text-muted">
              {Math.round(Number(weightValue) * 100)}%
            </span>
          </div>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={weightValue}
            onChange={(event) =>
              onChange(
                weightKey as keyof IntelligentRoutingWeights,
                Number(event.target.value || 0)
              )
            }
            className="mt-3 w-full accent-primary"
          />
        </div>
      ))}
    </div>
  );
}

export default function BuilderIntelligentStep({
  t,
  config,
  onChange,
  activeProviders,
  modelOptions,
}: {
  t: any;
  config: Record<string, unknown>;
  onChange: (nextConfig: Record<string, unknown>) => void;
  activeProviders: any[];
  modelOptions: IntelligentRoleModelOption[];
}) {
  const normalizedConfig = normalizeIntelligentRoutingConfig(config);
  const isSlaAwareStrategy = ["sla-aware", "sla"].includes(normalizedConfig.routerStrategy);
  const providerOptions = useMemo(
    () => toProviderOptions(activeProviders, normalizedConfig.candidatePool),
    [activeProviders, normalizedConfig.candidatePool]
  );

  const updateConfig = (patch: Record<string, unknown>) => {
    onChange({
      ...normalizedConfig,
      ...patch,
      weights: {
        ...normalizedConfig.weights,
        ...((patch.weights as Record<string, number>) || {}),
      },
    });
  };

  const updateRoleWeight = (
    field: "fastWorkerWeights" | "strongReasoningWeights",
    weightKey: keyof IntelligentRoutingWeights,
    value: number
  ) => {
    updateConfig({
      [field]: {
        ...(normalizedConfig[field] || normalizedConfig.weights),
        [weightKey]: value,
      },
    });
  };

  const setRoleWeightCustomization = (
    field: "fastWorkerWeights" | "strongReasoningWeights",
    enabled: boolean
  ) => {
    if (enabled) {
      updateConfig({ [field]: { ...normalizedConfig.weights } });
      return;
    }
    const nextConfig = { ...normalizedConfig } as Record<string, unknown>;
    delete nextConfig[field];
    onChange(nextConfig);
  };

  const toggleCandidateProvider = (providerId: string) => {
    const nextCandidatePool = normalizedConfig.candidatePool.includes(providerId)
      ? normalizedConfig.candidatePool.filter((entry) => entry !== providerId)
      : [...normalizedConfig.candidatePool, providerId];

    updateConfig({ candidatePool: nextCandidatePool });
  };

  const toggleRoleModel = (field: IntelligentRolePoolKey, stepId: string) => {
    const nextRefs = toggleIntelligentRoleModelRef(
      normalizedConfig[field],
      stepId,
      modelOptions.map((option) => option.stepId)
    );
    updateConfig({ [field]: nextRefs });
  };

  const setAdaptiveJudgeModel = (stepId: string) => {
    const nextConfig = { ...normalizedConfig } as Record<string, unknown>;
    if (stepId) nextConfig.adaptiveJudgeModelRef = stepId;
    else delete nextConfig.adaptiveJudgeModelRef;
    onChange(nextConfig);
  };

  return (
    <div className="flex flex-col gap-3">
      <Card.Section>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-text-main">
              {getI18nOrFallback(t, "builderIntelligentTitle", "Intelligent Routing Configuration")}
            </h3>
            <p className="text-xs text-text-muted mt-1">
              {getI18nOrFallback(
                t,
                "builderIntelligentDesc",
                "Configure the multi-factor scoring engine for this auto-routing combo."
              )}
            </p>
          </div>
          <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-primary">
            <span className="material-symbols-outlined text-[12px]">auto_awesome</span>
            Intelligent
          </span>
        </div>
      </Card.Section>

      <Card.Section>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-text-main">
              {getI18nOrFallback(t, "candidatePoolLabel", "Candidate Pool")}
            </p>
            <p className="text-[11px] text-text-muted mt-1">
              {getI18nOrFallback(
                t,
                "candidatePoolHint",
                "Select which providers this engine should evaluate. Leave empty to use all active providers."
              )}
            </p>
          </div>
          <span className="text-[10px] text-text-muted">
            {normalizedConfig.candidatePool.length > 0
              ? `${normalizedConfig.candidatePool.length} selected`
              : "All active providers"}
          </span>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {providerOptions.length === 0 && (
            <span className="text-[11px] text-text-muted">
              {getI18nOrFallback(t, "candidatePoolEmpty", "No active providers available yet.")}
            </span>
          )}

          {providerOptions.map((provider) => {
            const isSelected = normalizedConfig.candidatePool.includes(provider.id);
            return (
              <button
                key={provider.id}
                type="button"
                onClick={() => toggleCandidateProvider(provider.id)}
                className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
                  isSelected
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-black/10 dark:border-white/10 text-text-main hover:border-primary/40 hover:bg-primary/5"
                }`}
              >
                {provider.label}
                <span className="ml-1 text-[10px] text-text-muted">
                  {provider.connectionCount} acct
                  {provider.connectionCount === 1 ? "" : "s"}
                </span>
              </button>
            );
          })}
        </div>
      </Card.Section>

      <div>
        <div className="mb-2">
          <p className="text-xs font-semibold text-text-main">
            {getI18nOrFallback(t, "rolePoolsTitle", "Adaptive Model Roles")}
          </p>
          <p className="text-[11px] text-text-muted mt-1">
            {getI18nOrFallback(
              t,
              "rolePoolsHint",
              "Assign one or more existing model Steps to each role. A model may belong to both pools."
            )}
          </p>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <RolePoolSelector
            t={t}
            field="fastWorkerModelRefs"
            title={getI18nOrFallback(t, "fastWorkerPoolLabel", "Fast Worker Pool")}
            hint={getI18nOrFallback(
              t,
              "fastWorkerPoolHint",
              "Models intended for fast, low-complexity, or high-volume work."
            )}
            options={modelOptions}
            selectedRefs={normalizedConfig.fastWorkerModelRefs || []}
            onToggle={toggleRoleModel}
          />
          <RolePoolSelector
            t={t}
            field="strongReasoningModelRefs"
            title={getI18nOrFallback(t, "strongReasoningPoolLabel", "Strong Reasoning Pool")}
            hint={getI18nOrFallback(
              t,
              "strongReasoningPoolHint",
              "Models intended for difficult reasoning, planning, debugging, or architecture work."
            )}
            options={modelOptions}
            selectedRefs={normalizedConfig.strongReasoningModelRefs || []}
            onToggle={toggleRoleModel}
          />
        </div>
        <Card.Section className="mt-3">
          <label className="text-xs font-semibold text-text-main block mb-2">
            {getI18nOrFallback(t, "adaptiveJudgeLabel", "AI Intent Classifier")}
          </label>
          <select
            aria-label={getI18nOrFallback(t, "adaptiveJudgeLabel", "AI Intent Classifier")}
            value={normalizedConfig.adaptiveJudgeModelRef || ""}
            onChange={(event) => setAdaptiveJudgeModel(event.target.value)}
            className="w-full text-xs py-2 px-2 rounded border border-black/10 dark:border-white/10 bg-transparent focus:border-primary focus:outline-none"
          >
            <option value="">
              {getI18nOrFallback(t, "adaptiveJudgeDisabled", "Rules only (disabled)")}
            </option>
            {modelOptions.map((option) => (
              <option key={`judge-${option.stepId}`} value={option.stepId}>
                {option.model}
                {option.connectionLabel ? ` — ${option.connectionLabel}` : ""}
              </option>
            ))}
          </select>
          <p className="mt-2 text-[11px] text-text-muted">
            {getI18nOrFallback(
              t,
              "adaptiveJudgeHint",
              "Language, task family, action, scope, domain, artifacts, complexity, constraints, risk, and recent context are resolved locally first. Choose one model Step from this Combo only for genuinely unknown, unsupported, or conflicting requests. Recognized code, UI, document, data, research, creative, and casual requests add no classifier call; failures fall back to regular Auto routing."
            )}
          </p>
        </Card.Section>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Card.Section>
          <label className="text-xs font-semibold text-text-main block mb-2">
            {getI18nOrFallback(t, "modePackLabel", "Mode Pack")}
          </label>
          <select
            value={normalizedConfig.modePack}
            onChange={(event) => updateConfig({ modePack: event.target.value })}
            className="w-full text-xs py-2 px-2 rounded border border-black/10 dark:border-white/10 bg-transparent focus:border-primary focus:outline-none"
          >
            {MODE_PACK_OPTIONS.map((modePack) => (
              <option key={modePack.id} value={modePack.id}>
                {getI18nOrFallback(
                  t,
                  `modePack${modePack.id[0].toUpperCase()}${modePack.id.slice(1)}`,
                  modePack.label
                )}
              </option>
            ))}
          </select>
        </Card.Section>

        <Card.Section>
          <label className="text-xs font-semibold text-text-main block mb-2">
            {getI18nOrFallback(t, "routerStrategyLabel", "Router Strategy")}
          </label>
          <select
            value={normalizedConfig.routerStrategy}
            onChange={(event) => updateConfig({ routerStrategy: event.target.value })}
            className="w-full text-xs py-2 px-2 rounded border border-black/10 dark:border-white/10 bg-transparent focus:border-primary focus:outline-none"
          >
            {ROUTER_STRATEGY_OPTIONS.map((strategy) => (
              <option key={strategy.id} value={strategy.id}>
                {strategy.id === "rules"
                  ? getI18nOrFallback(t, "strategyRules", strategy.label)
                  : strategy.label}
              </option>
            ))}
          </select>
        </Card.Section>
      </div>

      {isSlaAwareStrategy && (
        <Card.Section>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold text-text-main">
                {getI18nOrFallback(t, "slaRoutingTitle", "SLA targets")}
              </p>
              <p className="text-[11px] text-text-muted mt-1">
                {getI18nOrFallback(
                  t,
                  "slaRoutingHint",
                  "Prefer providers that satisfy p95 latency, error-rate and optional cost targets."
                )}
              </p>
            </div>
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-300">
              <span className="material-symbols-outlined text-[12px]">verified</span>
              SLA
            </span>
          </div>

          <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
            <label className="text-xs font-semibold text-text-main block">
              {getI18nOrFallback(t, "slaTargetP95Label", "Target p95 latency (ms)")}
              <input
                type="number"
                min="1"
                step="100"
                value={normalizedConfig.slaTargetP95Ms ?? ""}
                placeholder="2000"
                onChange={(event) =>
                  updateConfig({
                    slaTargetP95Ms: event.target.value ? Number(event.target.value) : undefined,
                  })
                }
                className="mt-2 w-full text-xs py-2 px-2 rounded border border-black/10 dark:border-white/10 bg-transparent focus:border-primary focus:outline-none"
              />
            </label>

            <label className="text-xs font-semibold text-text-main block">
              {getI18nOrFallback(t, "slaMaxErrorRateLabel", "Max error rate")}
              <input
                type="number"
                min="0"
                max="1"
                step="0.01"
                value={normalizedConfig.slaMaxErrorRate ?? ""}
                placeholder="0.05"
                onChange={(event) =>
                  updateConfig({
                    slaMaxErrorRate: event.target.value ? Number(event.target.value) : undefined,
                  })
                }
                className="mt-2 w-full text-xs py-2 px-2 rounded border border-black/10 dark:border-white/10 bg-transparent focus:border-primary focus:outline-none"
              />
            </label>

            <label className="text-xs font-semibold text-text-main block">
              {getI18nOrFallback(t, "slaMaxCostLabel", "Max cost ($ / 1M tokens)")}
              <input
                type="number"
                min="0"
                step="0.001"
                value={normalizedConfig.slaMaxCostPer1MTokens ?? ""}
                placeholder={getI18nOrFallback(t, "slaMaxCostPlaceholder", "No limit")}
                onChange={(event) =>
                  updateConfig({
                    slaMaxCostPer1MTokens: event.target.value
                      ? Number(event.target.value)
                      : undefined,
                  })
                }
                className="mt-2 w-full text-xs py-2 px-2 rounded border border-black/10 dark:border-white/10 bg-transparent focus:border-primary focus:outline-none"
              />
            </label>
          </div>

          <label className="mt-3 flex items-center gap-2 text-xs text-text-main">
            <input
              type="checkbox"
              checked={normalizedConfig.slaHardConstraints}
              onChange={(event) => updateConfig({ slaHardConstraints: event.target.checked })}
              className="accent-primary"
            />
            {getI18nOrFallback(
              t,
              "slaHardConstraintsLabel",
              "Prefer strict SLA-compliant candidates before soft scoring."
            )}
          </label>
        </Card.Section>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Card.Section>
          <label className="text-xs font-semibold text-text-main block">
            {getI18nOrFallback(t, "explorationRateLabel", "Exploration Rate")}
          </label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={normalizedConfig.explorationRate}
            onChange={(event) => updateConfig({ explorationRate: Number(event.target.value || 0) })}
            className="mt-3 w-full accent-primary"
          />
          <p className="text-[11px] text-text-muted mt-2">
            {getI18nOrFallback(
              t,
              "explorationRateHint",
              "{percent}% of requests can explore non-optimal providers.",
              { percent: Math.round(normalizedConfig.explorationRate * 100) }
            ).replace("{percent}", `${Math.round(normalizedConfig.explorationRate * 100)}`)}
          </p>
        </Card.Section>

        <Card.Section>
          <label className="text-xs font-semibold text-text-main block mb-2">
            {getI18nOrFallback(t, "budgetCapLabel", "Budget Cap (USD / request)")}
          </label>
          <input
            type="number"
            min="0"
            step="0.0001"
            value={normalizedConfig.budgetCap ?? ""}
            placeholder={getI18nOrFallback(t, "budgetCapPlaceholder", "No limit")}
            onChange={(event) =>
              updateConfig({
                budgetCap: event.target.value ? Number(event.target.value) : undefined,
              })
            }
            className="w-full text-xs py-2 px-2 rounded border border-black/10 dark:border-white/10 bg-transparent focus:border-primary focus:outline-none"
          />
        </Card.Section>
      </div>

      <details className="rounded-lg border border-black/8 dark:border-white/8 bg-black/2 dark:bg-white/2 p-3">
        <summary className="cursor-pointer text-xs font-semibold text-text-main">
          {getI18nOrFallback(t, "advancedWeightsTitle", "Advanced: Scoring Weights")}
        </summary>
        <p className="mt-2 text-[11px] text-text-muted">
          {getI18nOrFallback(
            t,
            "advancedWeightsHint",
            "Default weights handle neutral requests. Role profiles rank models only inside the active worker pool."
          )}
        </p>

        <div className="mt-3 rounded-lg border border-black/8 dark:border-white/8 p-3">
          <p className="text-xs font-semibold text-text-main">
            {getI18nOrFallback(t, "defaultWeightsLabel", "Default / Neutral Weights")}
          </p>
          <WeightSliders
            t={t}
            weights={normalizedConfig.weights}
            onChange={(weightKey, value) =>
              updateConfig({ weights: { ...normalizedConfig.weights, [weightKey]: value } })
            }
          />
        </div>

        {(
          [
            {
              field: "fastWorkerWeights" as const,
              title: getI18nOrFallback(t, "fastWorkerWeightsLabel", "Fast Worker Weights"),
              selectedCount: normalizedConfig.fastWorkerModelRefs?.length || 0,
            },
            {
              field: "strongReasoningWeights" as const,
              title: getI18nOrFallback(
                t,
                "strongReasoningWeightsLabel",
                "Strong Reasoning Weights"
              ),
              selectedCount: normalizedConfig.strongReasoningModelRefs?.length || 0,
            },
          ] as const
        ).map(({ field, title, selectedCount }) => {
          const customWeights = normalizedConfig[field];
          const isCustomized = Boolean(customWeights);
          const selectionHint =
            selectedCount <= 1
              ? getI18nOrFallback(
                  t,
                  "singleRoleModelWeightHint",
                  "With one eligible model, it is selected directly. These weights activate when the pool has multiple models."
                )
              : getI18nOrFallback(
                  t,
                  "multipleRoleModelsWeightHint",
                  "Ranking {count} models inside this worker pool.",
                  { count: selectedCount }
                ).replace("{count}", String(selectedCount));

          return (
            <div
              key={field}
              className="mt-3 rounded-lg border border-black/8 dark:border-white/8 p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold text-text-main">{title}</p>
                  <p className="mt-1 text-[11px] text-text-muted">{selectionHint}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setRoleWeightCustomization(field, !isCustomized)}
                  className="shrink-0 rounded-md border border-primary/30 px-2 py-1 text-[10px] font-semibold text-primary hover:bg-primary/10"
                >
                  {isCustomized
                    ? getI18nOrFallback(t, "useDefaultWeights", "Use Default")
                    : getI18nOrFallback(t, "customizeWeights", "Customize")}
                </button>
              </div>
              {isCustomized ? (
                <WeightSliders
                  t={t}
                  weights={customWeights || normalizedConfig.weights}
                  onChange={(weightKey, value) => updateRoleWeight(field, weightKey, value)}
                />
              ) : (
                <p className="mt-3 rounded-md bg-black/3 dark:bg-white/3 px-3 py-2 text-[11px] text-text-muted">
                  {getI18nOrFallback(
                    t,
                    "inheritsDefaultWeights",
                    "Currently inherits Default / Neutral Weights."
                  )}
                </p>
              )}
            </div>
          );
        })}
      </details>
    </div>
  );
}
