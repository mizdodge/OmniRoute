# Adaptive Smart Routing

## Feature Goal

Enable operators to assign two semantic **role pools** to models already present in a Combo's Steps:

- **Fast Worker Pool** — Preferred for low-complexity, high-volume tasks (simple Q&A, formatting, basic coding). Optimized for speed and cost.
- **Strong Reasoning Pool** — Preferred for difficult reasoning-heavy tasks (complex coding, debugging, planning, analysis). Optimized for quality and reasoning capability.

The roles are **not** model identities. The operator explicitly chooses **one or more models** from the Combo's Steps for each pool. Capability is never inferred from model name, provider, family, or parameter count.

This feature extends the existing **Combo Builder → Intelligent / Smart Routing** step — it does NOT create a new routing system, new strategy, or new top-level architecture.

---

## Where It Lives in Combo Builder

```
Combo Builder Wizard:
├── Basics
├── Steps              ← Models are added here (provider/model/connection)
├── Strategy           ← "auto" or "lkgp" enables Intelligent step
├── Intelligent / Smart Routing  ← EXTENDED with role pool selectors
│   ├── Candidate Pool
│   ├── Mode Pack
│   ├── Router Strategy
│   ├── SLA Targets
│   ├── Exploration Rate
│   ├── Budget Cap
│   ├── Advanced: Scoring Weights
│   ├── Fast Worker Pool          ← NEW: Multi-select from Combo Steps
│   └── Strong Reasoning Pool     ← NEW: Multi-select from Combo Steps
└── Review
```

---

## Existing Combo Step Architecture

### `ComboModelStep` Structure (from `src/lib/combos/steps.ts`)

```typescript
interface ComboModelStep {
  id: string; // Stable: "model-comboName-1-provider/model:connectionId"
  kind: "model";
  model: string; // Qualified: "provider/model"
  providerId?: string | null; // Canonical provider ID
  connectionId?: string | null; // Pinned connection, or null for auto
  allowedConnectionIds?: string[] | null; // Account allowlist (#3266)
  weight: number; // 0-100
  label?: string; // Optional display label
  prompt?: string | null; // Per-step pipeline input
  tags?: string[];
  fallbackOnlyOnQuotaExhaustion?: boolean;
}
```

### Key Properties for Role Assignment

| Property               | Purpose                                                                            | Stability                                          |
| ---------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------- |
| `id`                   | Primary stable reference — includes kind, combo name, index, model+connection seed | Survives reorder; changes if step deleted/re-added |
| `model`                | Qualified model string ("provider/model")                                          | Stable for same model                              |
| `providerId`           | Canonical provider ID                                                              | Stable                                             |
| `connectionId`         | Pinned connection or null (auto)                                                   | Distinguishes same model on different connections  |
| `allowedConnectionIds` | Account allowlist for round-robin                                                  | Optional                                           |

### Deduplication Signature

`getExactModelStepSignature()` produces: `model:providerId:modelId:connectionId` (or `__auto__`)

Used by `hasExactModelStepDuplicate()` to prevent exact duplicates. Different connections for same provider/model are allowed as separate steps.

### Combo-Ref Steps

Steps with `kind: "combo-ref"` reference another combo by name. Expanded at runtime via `resolveNestedComboTargets()`. **Role assignment should only target `kind: "model"` steps** (validated in UI).

---

## Existing Intelligent Routing Architecture

### `IntelligentRoutingConfig` (from `src/lib/combos/intelligentRouting.ts`)

```typescript
interface IntelligentRoutingConfig {
  candidatePool: string[]; // Provider IDs to evaluate (empty = all active)
  explorationRate: number; // 0-1, default 0.05
  modePack: string; // "ship-fast" | "cost-saver" | "quality-first" | "offline-friendly"
  budgetCap?: number; // USD per request
  weights: IntelligentRoutingWeights; // 13 factors
  routerStrategy: string; // "rules" | "cost" | "latency" | "sla-aware" | "lkgp"
  slaTargetP95Ms?: number;
  slaMaxErrorRate?: number;
  slaMaxCostPer1MTokens?: number;
  slaHardConstraints: boolean;
}
```

### Scoring Weights (DEFAULT_INTELLIGENT_WEIGHTS)

| Factor              | Weight   | Description                       |
| ------------------- | -------- | --------------------------------- |
| quota               | 0.16     | Quota remaining                   |
| health              | 0.20     | Provider health                   |
| costInv             | 0.16     | Inverse cost (cheaper = higher)   |
| latencyInv          | 0.12     | Inverse latency (faster = higher) |
| **taskFit**         | **0.08** | Task fitness score                |
| stability           | 0.05     | Latency stability                 |
| tierPriority        | 0.05     | Account tier priority             |
| tierAffinity        | 0.05     | Tier match to hint                |
| specificityMatch    | 0.05     | Specificity match                 |
| contextAffinity     | 0.08     | Prompt cache affinity             |
| cacheAffinity       | 0        | Cache hit affinity                |
| sessionAvailability | 0.05     | Session stickiness                |
| resetWindowAffinity | 0        | Quota reset window preference     |

### Mode Packs (MODE_PACK_OPTIONS)

| Pack             | Bias                    |
| ---------------- | ----------------------- |
| ship-fast        | Speed/latency           |
| cost-saver       | Cost optimization       |
| quality-first    | Task fit, stability     |
| offline-friendly | Local/no-auth providers |

### Router Strategies (ROUTER_STRATEGY_OPTIONS)

- `rules` — 6-factor weighted scoring
- `cost` — Cost optimized
- `latency` — Latency optimized
- `sla-aware` — SLA targets
- `lkgp` — Last Known Good Provider

### Runtime Flow

```
Request
  → resolveAutoRoutingState() / getComboForModel()
  → createVirtualAutoCombo() / handleComboChat()
  → resolveComboTargets() → ResolvedComboTarget[] (with stepId, executionKey)
  → scoreAutoTargets() → calculateFactors() → calculateScore()
  → Selected target → handleSingleModelChat() → executor.execute()
```

---

## Fast Worker Pool

### Purpose

Preferred routing pool for **simple, high-volume tasks** where speed and cost matter more than deep reasoning.

### Task Types That Prefer Fast Worker Pool

- Simple Q&A / chat
- Formatting / transformation
- Basic coding (boilerplate, simple functions)
- Summarization
- Classification

### Runtime Behavior

- **Not a hard filter** — other Combo Step models still participate
- **Score boost** — Adds `fastWorkerPoolWeight × fastWorkerPoolSuitability` to candidate score
- `fastWorkerPoolSuitability = 1.0` if candidate's `stepId` is in `config.fastWorkerModelRefs`, else `0`
- Only active when task classified as "simple" (or mode pack biases toward speed)
- Still subject to: circuit breaker, connection cooldown, model lockout, quality validation
- **Intra-pool failover**: If selected candidate fails, existing scorer picks next best from same pool
- **Cross-pool failover**: If entire Fast Worker pool exhausted, fall back to Strong Reasoning pool

### Configuration

```typescript
// In IntelligentRoutingConfig
fastWorkerModelRefs?: string[];  // Array of Step ID references
```

---

## Strong Reasoning Pool

### Purpose

Preferred routing pool for **complex reasoning-heavy tasks** where quality and reasoning capability matter more than speed/cost.

### Task Types That Prefer Strong Reasoning Pool

- Complex coding / architecture
- Debugging / root cause analysis
- Planning / multi-step reasoning
- Deep analysis / research
- Mathematical / logical reasoning

### Runtime Behavior

- **Not a hard filter** — other Combo Step models still participate
- **Score boost** — Adds `strongReasoningPoolWeight × strongReasoningPoolSuitability` to candidate score
- `strongReasoningPoolSuitability = 1.0` if candidate's `stepId` is in `config.strongReasoningModelRefs`, else `0`
- Only active when task classified as "complex" (or mode pack biases toward quality)
- Still subject to: circuit breaker, connection cooldown, model lockout, quality validation
- **Intra-pool failover**: If selected candidate fails, existing scorer picks next best from same pool
- **Cross-pool failover**: If entire Strong Reasoning pool exhausted, fall back to Fast Worker pool

### Configuration

```typescript
// In IntelligentRoutingConfig
strongReasoningModelRefs?: string[];  // Array of Step ID references
```

---

## Model Selection Source

### Requirement

Options MUST come from **this Combo's Steps** — NOT global models, NOT all active providers, NOT hardcoded lists.

### Source in Code

The `models` state in `page.tsx` (type `ComboBuilderDraftModelStep[]`) — already contains the current Combo's steps.

Each entry:

```typescript
{
  model: "provider/model",  // Qualified model string
  providerId?: string,      // Canonical provider ID
  weight: number
}
```

### Transformation to Multi-Select Options

```typescript
// In BuilderIntelligentStep.tsx, receive models from page.tsx
const roleOptions = models.map((step, index) => {
  const normalized = normalizeComboStep(step, { comboName: name, index, allCombos });
  return {
    value: normalized?.id || `step-${index}`, // Stable step ID
    label: `${step.model} ${step.connectionId ? `(pinned: ${step.connectionId})` : "(auto)"}`,
    providerId: step.providerId,
    modelId: step.model.split("/")[1],
  };
});
```

### Reusing Existing Helpers

- `normalizeComboStep()` from `steps.ts` — produces `ComboStep` with stable `id`
- `getComboModelString()` — extracts qualified model string
- `getExactModelStepSignature()` — for validation

---

## Persistence Design

### Where Stored

In the combo's `config` field (JSON in `combos.data` column), inside `IntelligentRoutingConfig`:

```typescript
interface IntelligentRoutingConfig {
  // ... existing fields
  fastWorkerModelRefs?: string[]; // Array of Step ID references
  strongReasoningModelRefs?: string[]; // Array of Step ID references
}
```

### Normalization (in `normalizeIntelligentRoutingConfig()`)

```typescript
fastWorkerModelRefs: Array.isArray(configRecord.fastWorkerModelRefs)
  ? configRecord.fastWorkerModelRefs
      .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
      .map(v => v.trim())
  : undefined,
strongReasoningModelRefs: Array.isArray(configRecord.strongReasoningModelRefs)
  ? configRecord.strongReasoningModelRefs
      .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
      .map(v => v.trim())
  : undefined,
```

### Validation

- On save (API route): Verify referenced step IDs exist in `combo.models`
- On load (UI): If referenced step missing, show warning but don't block
- At runtime: If step missing, ignore that reference (graceful degradation)

### Handling Edge Cases

| Scenario                          | Behavior                                               |
| --------------------------------- | ------------------------------------------------------ |
| Step deleted after role assigned  | Runtime ignores missing step; UI shows warning on edit |
| Same step in both pools           | Allowed; both suitability factors apply independently  |
| Role → combo-ref step             | Disallowed in UI (only model steps shown)              |
| Same model, different connections | Distinguished by step `id` (includes connectionId)     |
| Empty pool (`[]`)                 | Treated as no preference; falls back to normal scoring |

---

## Runtime Routing Design

### Scoring Integration Point

**File**: `open-sse/services/autoCombo/scoring.ts` → `calculateScore()`

**Extended `ScoringFactors`**:

```typescript
interface ScoringFactors {
  // ... existing 13 factors
  fastWorkerPoolSuitability?: number; // 1.0 if candidate in Fast Worker pool
  strongReasoningPoolSuitability?: number; // 1.0 if candidate in Strong Reasoning pool
}
```

**Extended `ScoringWeights`**:

```typescript
interface ScoringWeights {
  // ... existing 13 weights
  fastWorkerPoolWeight?: number; // Default 0, set by mode pack or config
  strongReasoningPoolWeight?: number; // Default 0, set by mode pack or config
}
```

**Updated `calculateScore()`**:

```typescript
return clamp01(
  // ... existing terms
  +(weights.fastWorkerPoolWeight ?? 0) * (factors.fastWorkerPoolSuitability ?? 0) +
    (weights.strongReasoningPoolWeight ?? 0) * (factors.strongReasoningPoolSuitability ?? 0)
);
```

### Computing Suitability (in `scoreAutoTargets()` / `calculateFactors()`)

```typescript
// In autoStrategy.ts, when scoring candidates
const comboConfig = combo.config as IntelligentRoutingConfig | undefined;
const fastWorkerRefs = new Set(comboConfig?.fastWorkerModelRefs ?? []);
const strongReasoningRefs = new Set(comboConfig?.strongReasoningModelRefs ?? []);

const factors: ScoringFactors = {
  // ... existing factors
  fastWorkerPoolSuitability: fastWorkerRefs.has(candidate.stepId) ? 1.0 : 0,
  strongReasoningPoolSuitability: strongReasoningRefs.has(candidate.stepId) ? 1.0 : 0,
};
```

### Task Classification → Role Pool Weight Activation

**Lightweight heuristic** (no LLM, <5ms):

```typescript
function classifyTaskComplexity(
  body: any
): "simple" | "complex" | "coding" | "debugging" | "planning" | "analysis" {
  const messages = body.messages || body.input || [];
  const toolCount = body.tools?.length || 0;
  const estimatedTokens = estimateTokens(messages);

  // Simple heuristics
  if (toolCount > 3) return "complex";
  if (estimatedTokens > 8000) return "analysis";
  if (hasCodeBlocks(messages)) return "coding";
  if (hasStackTraces(messages)) return "debugging";
  if (hasPlanningKeywords(messages)) return "planning";
  if (estimatedTokens < 1000 && toolCount === 0) return "simple";
  return "complex";
}
```

**Weight Activation**:

```typescript
// In calculateFactors() or scoreAutoTargets()
const taskType = classifyTaskComplexity(body);
let fastWorkerWeight = weights.fastWorkerPoolWeight ?? 0;
let strongReasoningWeight = weights.strongReasoningPoolWeight ?? 0;

// Mode pack defaults (can be overridden in config)
if (modePack === "ship-fast") fastWorkerWeight = Math.max(fastWorkerWeight, 0.15);
if (modePack === "quality-first") strongReasoningWeight = Math.max(strongReasoningWeight, 0.15);

// Task-type activation
if (taskType === "simple") {
  strongReasoningWeight = 0; // Don't boost strong reasoning for simple tasks
} else if (["coding", "debugging", "planning", "analysis"].includes(taskType)) {
  fastWorkerWeight = 0; // Don't boost fast worker for complex tasks
}
```

### Failover Logic

**Intra-role failover**: Handled automatically by existing scorer — if top candidate fails, next highest scored candidate from same pool is selected.

**Cross-role failover**: If all candidates in preferred pool are exhausted/unavailable, fall back to other role pool, then to normal Combo fallback behavior.

```typescript
// Conceptual failover flow
function selectCandidateWithFailover(candidates, preferredPoolRefs, fallbackPoolRefs) {
  // 1. Filter to preferred pool, score, pick best
  const preferred = candidates.filter((c) => preferredPoolRefs.has(c.stepId));
  if (preferred.length > 0) return scoreAndPick(preferred);

  // 2. Fallback pool
  const fallback = candidates.filter((c) => fallbackPoolRefs.has(c.stepId));
  if (fallback.length > 0) return scoreAndPick(fallback);

  // 3. Normal Combo fallback
  return scoreAndPick(candidates);
}
```

---

## Adaptive Analysis Direction

### Signals to Evaluate (Phase 4)

| Signal                  | Source                                        | Complexity Indicator                 |
| ----------------------- | --------------------------------------------- | ------------------------------------ |
| Message count           | `body.messages.length`                        | More messages → more context         |
| Estimated tokens        | `estimateTokens(messages)`                    | Higher → more complex                |
| Tool count              | `body.tools.length`                           | More tools → more complex            |
| Tool types              | `body.tools.map(t => t.type)`                 | Code execution, web search → complex |
| Code blocks in messages | Regex on content                              | Presence → coding task               |
| Stack traces            | Regex on content                              | Presence → debugging                 |
| Planning keywords       | "plan", "design", "architect", "step by step" | Presence → planning                  |
| Reasoning effort        | `body.reasoning_effort`                       | High → complex                       |

### Where Analysis Runs

**Option A**: In `handleChatCore()` (early, before combo routing)

- Pros: Available for all routing decisions
- Cons: Runs even for non-combo requests

**Option B**: In `handleComboChat()` / `scoreAutoTargets()` (combo-specific)

- Pros: Only runs when needed
- Cons: Later in pipeline

**Recommendation**: Option B — in `scoreAutoTargets()` where we already have `body` and `combo.config`.

### Latency Budget

- Target: **<5ms** synchronous
- No external calls, no LLM
- Pure heuristic on request body

### Failure Degradation

- If classification fails/throws → default to `'complex'` (safer: prefer quality)
- Or default to `'neutral'` (no role boost applied)

---

## Scoring Integration Direction

### Conceptual Model

```
Existing Intelligent Score (13 factors)
+ Adaptive Role Pool Suitability (2 new factors)
= Final Score
```

### Runtime Implementation Approach

The numbered items below describe internal runtime work, not six controls in the Combo Builder.
The visible operator controls are the Fast Worker and Strong Reasoning pool selectors plus three
weight profiles under **Advanced: Scoring Weights**: Default, Fast Worker, and Strong Reasoning.
Adaptive role allocation is activated automatically from the request classification and selected
Mode Pack; the two role profiles are optional and inherit Default until customized.

1. **Add factors to `ScoringFactors`** — `fastWorkerPoolSuitability`, `strongReasoningPoolSuitability`
2. **Add weights to `ScoringWeights`** — `fastWorkerPoolWeight`, `strongReasoningPoolWeight` (default 0)
3. **Update `calculateScore()`** — Include new terms
4. **Compute suitability in `scoreAutoTargets()`** — Check candidate `stepId` against pool ref arrays
5. **Activate weights based on task classification** — Simple → fastWorker, Complex → strongReasoning
6. **Mode pack defaults** — ship-fast → fastWorkerPoolWeight, quality-first → strongReasoningPoolWeight

### Preserving Existing Behavior

- Default weights = 0 → **zero change** to current scoring when feature unused
- Mode packs can set defaults → opt-in for operators
- The runtime reserves a bounded role share from the active mode-pack distribution
- All existing factors/weights unchanged

---

## Failure Handling

### Current Resilience Layers (from `docs/architecture/RESILIENCE_GUIDE.md`)

1. **Provider Circuit Breaker** — Whole provider (OPEN/HALF_OPEN/CLOSED)
2. **Connection Cooldown** — Per account/key (`rateLimitedUntil`)
3. **Model Lockout** — Per provider+connection+model

### Adaptive Feature Compatibility

| Failure Scenario                         | Adaptive Behavior                               |
| ---------------------------------------- | ----------------------------------------------- |
| Role-assigned model circuit breaker OPEN | Skip candidate; next highest score wins         |
| Role-assigned connection cooling down    | Skip candidate; next highest score wins         |
| Role-assigned model locked out           | Skip candidate; next highest score wins         |
| All role candidates unavailable          | Fall back to normal scoring (no role boost)     |
| Scoring throws error                     | Catch → log → fall back to non-adaptive scoring |

### Key Principle

**Role assignment never bypasses resilience**. It only influences score ranking. The existing fallback chain (priority → next candidate → next strategy) remains fully operational.

---

## Planned Five Phases

### Phase 1 — Architecture Validation & Blueprint ✓

- Verified repository state (release/v3.8.50)
- Traced Combo Builder flow, step architecture, intelligent routing config
- Traced runtime scoring path, task fitness, persistence
- Produced this blueprint and `status.md`

### Phase 2 — Data/Configuration + Backend Runtime Role Support

- Extend `IntelligentRoutingConfig` with `fastWorkerModelRefs`, `strongReasoningModelRefs` (arrays)
- Update `normalizeIntelligentRoutingConfig()` validation
- Extend `ScoringFactors`/`ScoringWeights` in `scoring.ts`
- Update `calculateScore()` to include role pool terms
- Update `scoreAutoTargets()`/`calculateFactors()` to compute suitability
- Add lightweight task classification heuristic
- Update API validation schemas

**Files**: `intelligentRouting.ts`, `scoring.ts`, `autoStrategy.ts`, `combos/route.ts`, `schemas/combo.ts`

### Phase 3 — Combo Builder UI + Role Pool Selectors

- Extend `BuilderIntelligentStep.tsx` with two multi-select components
- Pass `models` from `page.tsx` as options
- Use step `id` as value, formatted label for display
- Wire `onChange` to update config arrays
- Add i18n keys
- Validate on Review step

**Files**: `BuilderIntelligentStep.tsx`, `page.tsx`, `i18n.json`, `i18n-schema.json`

### Phase 4 — Adaptive Analysis + Role-Pool-Aware Scoring

- Implement task classification in `autoStrategy.ts` or new module
- Map task types to role pool weight activation
- Integrate mode pack defaults for role pool weights
- Optional: Advanced Weights UI for role pool weights
- Implement cross-role failover logic

**Files**: `autoStrategy.ts`, `scoring.ts`, `intelligentRouting.ts` (mode packs), `BuilderIntelligentStep.tsx` (optional)

### Phase 5 — Integration Tests, Regression, Performance, Documentation

- Unit tests: task classification, role pool suitability scoring
- Integration tests: combo builder save/load with role pools
- E2E test: create combo with role pools → verify routing preference
- Performance: scoring overhead <1ms
- Documentation updates: `AUTO-COMBO.md`, `API_REFERENCE.md`
- Cleanup: lint, typecheck, remove debug code

---

## Current Runtime State

Adaptive difficulty analysis and role-aware scoring are implemented through Phase 4. The runtime
now classifies each Auto-Combo request synchronously, activates a conservative role suitability
weight when the matching configured pool has a routable candidate, and retains ordinary scoring
when the request is neutral or no preferred-role candidate remains.

---

## Phase 2 Implemented State

Phase 2 now provides the production data, persistence, and runtime-resolution foundation.

### Persisted Configuration

The existing Intelligent Routing `config` object may optionally contain:

```json
{
  "fastWorkerModelRefs": ["<combo-model-step-id>"],
  "strongReasoningModelRefs": ["<combo-model-step-id>"]
}
```

These values are references only. Provider definitions, model definitions, connections, and
credentials continue to come from the existing Combo Steps and provider infrastructure.

On create/update, refs are trimmed, deduplicated, and resolved against normalized model Steps in
the same Combo. Missing refs and refs to combo-ref/provider-wildcard Steps are removed. An edit that
deletes a referenced model Step revalidates the saved pools even if the request did not explicitly
send a replacement role configuration.

### Runtime Resolution

`open-sse/services/combo/rolePools.ts` resolves saved refs against the `ResolvedComboTarget[]` that
already survived normal Combo eligibility filtering. Consequently, a role cannot bypass provider
circuit breakers, connection cooldown, model lockout, quota cutoff, or other existing exclusions.

The resolved shape contains:

- `fastWorker`: eligible targets whose `stepId` is in the Fast Worker pool
- `strongReasoning`: eligible targets whose `stepId` is in the Strong Reasoning pool
- `unassigned`: eligible targets in neither pool
- `all`: the deduplicated eligible target list

A finite fallback-order helper can produce preferred role → alternate role → ordinary candidates.
It does not recurse, and deduplication by `executionKey` prevents repeated attempts caused by pool
overlap. `parseAutoConfig()` exposes this resolution for later Phase 4 consumption but Phase 2 does
not apply it to scoring or target order.

### Backward Compatibility

- Old Combos with absent role fields retain byte-compatible routing behavior.
- Explicit empty arrays are safe.
- One pool may be configured without the other.
- A Step may appear in both pools.
- Same provider/model Steps pinned to different connections remain distinct because the reference
  is the Step ID and runtime retains the connection-specific execution key.

### Not Implemented Yet

- Phase 5 integration/E2E coverage and performance benchmark.
- Public `AUTO-COMBO.md` and API-reference documentation updates planned for Phase 5.

The earlier planned-phase text that listed classifier/scoring changes under Phase 2 is obsolete;
the final architecture deliberately keeps those behaviors in Phase 4.

---

## Phase 3 Implemented State

The existing Combo Builder Intelligent / Smart Routing stage now exposes two multi-select role
controls:

```text
Adaptive Model Roles
├── Fast Worker Pool
│   └── 0..N model Steps from this Combo
└── Strong Reasoning Pool
    └── 0..N model Steps from this Combo
```

### Option Source and Display

The Builder calls `normalizeComboModels()` over its current draft and then
`buildIntelligentRoleModelOptions()`. The helper accepts only entries with:

- `kind === "model"`
- a non-empty Step `id`
- a non-empty qualified model value

The UI never loads role choices from the global model registry or active-provider catalog. A role
option displays the qualified model string and its pinned connection label/ID. Auto-connection
Steps are marked as automatic. This preserves the visual distinction between the same model pinned
to different accounts.

### Draft ID Materialization

Fresh draft Steps historically received IDs only during save normalization. Role references need a
stable value earlier, so the UI first derives the exact IDs that the normalizer would persist. When
a user changes a role pool, the normalized Steps are materialized into the Builder draft. Explicit
IDs are preserved during later normalization, reorder, and rename operations.

### Interaction Semantics

- Clicking an option toggles that Step independently within one pool.
- Multiple Steps can be selected in each pool.
- A Step may be selected in both pools.
- Unknown/stale refs are not presented as active options and are reported with a warning.
- Toggling a pool prunes its stale refs before writing the updated array.
- Empty pools remain valid.

The Review stage lists the resolved model membership for each pool before save. Existing Combos
restore their persisted selections through the same `config` state used by the rest of Intelligent
Routing.

### Phase Boundary

Phase 3 does not classify requests, prefer a role, change scoring weights, or reorder runtime
targets. The UI configures role metadata only. Phase 4 owns adaptive analysis and role-aware
runtime behavior.

---

## Phase 4 Implemented State

Phase 4 consumes the existing multilingual `classifyWithConfig()` intent result inside
`resolveAutoStrategyOrder()`. It adds only synchronous request-shape checks and performs no I/O or
additional model call.

### Classification Policy

```text
simple + no complex signal         → Fast Worker
light coding                        → Fast Worker
heavy coding                        → Strong Reasoning
ambiguous coding                    → neutral / router scoring first; optional AI tie-breaker only if still neutral
math | reasoning                    → Strong Reasoning
explicit tool choice                → Strong Reasoning for a new user request
estimated input >= 2,000 tokens     → Strong Reasoning
medium | creative without signals   → neutral
```

Neutral is deliberate: an ambiguous request first follows existing Auto-Combo scoring with the
effective base weights and no adaptive role boost. If that scoring has a unique Fast or Strong
winner, the role is resolved locally. Only a role-neutral top result can reach the optional AI
classifier, and only when both role pools have routable candidates.

### Role-Aware Score

The scorer now supports two optional factors:

```text
fastWorkerPoolSuitability
strongReasoningPoolSuitability
```

Membership is resolved by stable Step ID after the normal eligibility and quota-cutoff stages. The
active role factor is `1` for a matching role member and `0` otherwise. Runtime activation scales
the existing normalized weights down and reserves a bounded share for the preferred role, so the
final distribution remains normalized.

Mode-pack defaults are request-aware:

- Ship Fast gives its strongest adaptive allocation to Fast Worker requests.
- Quality First gives its strongest adaptive allocation to Strong Reasoning requests.
- Cost Saver moderately favors Fast Worker requests.
- Other/unknown packs use a conservative balanced allocation.

No role weight is activated when the preferred pool has no routable candidate. Combos without role
configuration therefore retain their prior scoring behavior.

### Selection and Fallback

For the standard rules router, the adaptive weights are passed into the existing primary provider
selection engine and the fallback scorer. Explicit cost/latency/SLA/LKGP router strategies remain
authoritative for the primary selection.

After the primary target, the fallback tail is finite and role-aware:

```text
remaining preferred role → alternate role → unassigned/ordinary candidates
```

Each execution key appears once. Role membership cannot bypass circuit breakers, connection
cooldowns, model lockouts, tool/context compatibility filters, or quota cutoff.

### Phase Boundary

At the Phase 4 boundary, manual role-specific Advanced Weight controls had not been added yet; mode
packs supplied the defaults. The post-Phase 5 extension below adds persisted Fast Worker and Strong
Reasoning profiles without changing the original automatic defaults.

---

## Phase 5 Implemented State

Phase 5 closes the feature across storage, UI, runtime cost, and public contract documentation.

### End-to-End Contract

The integration test creates a real `auto` Combo through `POST /api/combos`, reloads it through
`GET /api/combos`, and updates its model Steps through `PUT /api/combos/[id]`. Role arrays are
normalized against current model Step IDs on every write: unknown references disappear, references
to removed Steps disappear, and a valid Step shared by both pools remains valid.

The Chromium test covers the human-facing path: create two Steps in the Combo Builder, assign one
to Fast Worker and one to Strong Reasoning, review the membership, save, and inspect the request
payload. This run also exposed and fixed missing template variables in the i18n fallback helper.

### Runtime Cost Gate

`tests/integration/adaptive-routing-performance.test.ts` performs 2,000 warm-up requests followed
by 20,000 measured requests. Each request classifies intent/request shape, activates the adaptive
role distribution, and scores 20 candidates. The test fails if the average reaches 1 ms/request,
keeping the synchronous adaptive layer small relative to provider network latency.

### Public Contract

`docs/routing/AUTO-COMBO.md` now documents 14 baseline factors plus the two optional adaptive role
factors, their zero default, normalized activation, classification thresholds, and finite fallback.
`docs/reference/API_REFERENCE.md` and `docs/openapi.yaml` document stable Step-ID references and the
actual Combo GET/POST/PUT/DELETE surface.

### Completion Boundary

The scoped feature is complete: persistence, Builder UX, deterministic request analysis,
role-aware scoring/fallback, integration/E2E coverage, performance protection, and documentation
are present. Role-weight controls were subsequently implemented; adaptive telemetry remains a
separate optional enhancement.

---

## Client-Agnostic Intent Extraction Hardening

The classifier now treats the current human request as the authority. Plain chat messages pass
through unchanged. For IDE clients that embed environment, editor, memory, reminder, and prior-turn
metadata in one user message, the last explicit request tag is extracted before classification.

System prompts are excluded from intent keyword matching because they describe the assistant's
capabilities rather than the user's current goal. Likewise, the presence of `tools` only means a
client made schemas available; it no longer implies that the request needs a Strong Reasoning model.
Only an explicit required/any/named `tool_choice` promotes an otherwise neutral new user request.
On an assistant/tool automation continuation, the same field is treated as protocol state and does
not force Strong Reasoning.

Long-request promotion is calculated from the extracted current user request. Accumulated message
count and metadata volume no longer force a role. ASCII/Latin keywords use whole-word matching to
avoid fragments such as `api` inside `capital`; non-Latin languages retain substring matching for
scripts that do not consistently use spaces.

For rules-based routing, a non-empty routable preferred pool is also the hard primary-selection
boundary. Epsilon exploration operates inside that pool instead of across every Combo Step. This
prevents a Simple/Fast Worker request from randomly selecting a Strong Reasoning model, while the
alternate role and unassigned models remain available as the finite execution fallback chain.

---

## Role-Specific Advanced Scoring Weights

The Advanced section now persists three independent profiles: `weights` for neutral/default
routing, `fastWorkerWeights`, and `strongReasoningWeights`. An unset role profile inherits the
default profile, so existing Combos keep their previous behavior.

After intent classification and normal eligibility filtering, routing is deliberately scoped:

- One eligible model in the preferred role pool is selected directly.
- Two or more eligible models are ranked against that role's Advanced Weight profile.
- A request-level `X-OmniRoute-Mode` override still has higher priority than persisted profiles.
- Task routing and prompt-cache affinity may reorder only the fallback tail; neither can replace
  Auto's selected primary or move the primary into another role pool.
- If the preferred role has no assigned models, every non-judge model Step is treated as a general
  worker and ranked with that role's Advanced Weight profile. `task-route` still cannot replace the
  resulting Auto primary.

The Builder shows whether each role inherits Default or uses a custom profile, and the Review step
shows the saved state before submission. The Combo API schema, normalization, OpenAPI contract, and
integration tests preserve both optional profiles across create, list, and update operations.

`Use Default` removes that role's override rather than copying the current defaults into a second
persisted profile. The Builder then hides the role sliders and displays the inheritance notice.
Re-enabling customization seeds the sliders from the current Default / Neutral profile, so later
default changes are reflected instead of reviving discarded role values.

## Internal Context-Handoff Controls

`_omnirouteInternalRequest` and `_omnirouteSkipContextRelay` are local recursion/control flags used
by Context Handoff. They are now stripped at the universal target request boundary before provider
dispatch. This prevents strict upstream APIs from rejecting an otherwise valid request with an
unsupported-parameter 400 while preserving the flags inside OmniRoute's own pipeline.

---

## Optional AI Intent Classifier

Adaptive Routing can delegate the Fast Worker versus Strong Reasoning decision to one selected
model Step through `adaptiveJudgeModelRef`. The value is a single stable Step ID, not an arbitrary
model string or an array. The Builder's single-select is populated only from explicit model Steps
already present in the current Combo, and API normalization removes stale or non-model references.

The judge is a **last-resort tie-breaker**, not the normal neutral path. Deterministic Fast Worker
and Strong Reasoning classifications bypass it. A deterministic neutral result first reuses the
existing Auto scorer with the effective base router weights and no adaptive role boost. If the top
score belongs uniquely to a Fast Worker or Strong Reasoning Step, that role is accepted locally and
no classifier model call is made.

The AI classifier is eligible only when **both** Fast Worker and Strong Reasoning have routable
candidates and the neutral scoring pass still has no unique role: the top candidate is
General/unassigned, the top Step belongs to both roles, or Fast and Strong candidates tie inside the
router-score epsilon. With only one or zero routable role pools the classifier is skipped because
there is no meaningful Fast-versus-Strong choice to resolve.

When invoked, the judge receives the extracted current user request plus bounded routing context and
a fixed classification instruction. Tool schemas and the original response stream are not
forwarded. It must answer with exactly `FAST_WORKER` or `STRONG_REASONING`. A valid verdict supplies
the missing role preference before role-scoped scoring; it does not choose the final provider
itself.

The selected Step is judge-only by default. Unless it is also explicitly checked in Fast Worker or
Strong Reasoning, it is removed from the worker candidate universe before scoring and therefore
cannot become the final responder through fallback, session stickiness, or prompt-cache affinity.
Explicitly assigning the same Step to a worker role intentionally allows it to serve both purposes.

The call is marked internal, skips Context Relay and session-affinity tracking, and uses the exact
resolved Step target, including its pinned connection when configured. HTTP errors, timeouts,
invalid output, an unavailable target, or a missing reference all fail open to the existing neutral
Auto path so the main request continues normally.

Valid judge decisions are still reused for repeated identical automation turns through a bounded
process-local cache keyed by Combo, judge execution target, extracted prompt, and routing-context
digest (one-hour TTL, 1,000 entries). The cache is now secondary protection: neutral requests that
the normal router can resolve never spend classifier tokens in the first place.

### Builder Naming and Layout

The user-facing control is named **AI Intent Classifier** rather than AI Judger because its only
responsibility is resolving an ambiguous Fast Worker versus Strong Reasoning role. The persisted
`adaptiveJudgeModelRef` field and internal service names remain unchanged for compatibility. The
classifier card has the same vertical gutter as the following Mode Pack / Router Strategy row, and
the Review step uses the same label.

### Deferred Effective-Weights UI

A Mode Pack is currently the effective base weight source when one is selected. Consequently,
Default / Neutral sliders can remain editable while a preset shadows them. A follow-up should show
the effective profile and normalized factor contributions (or disable shadowed controls), and
rename the stale `Rules (6-Factor Scoring)` label now that the scorer exposes more factors.

---

## Front Task Analysis

Auto routing now builds one bounded context before worker-role selection. The context keeps three
concerns separate:

- **current task**: the extracted request remains authoritative for Fast/Strong complexity;
- **recent execution**: at most six meaningful events summarize continuation state and recent tool
  failures without forwarding raw history;
- **capability metadata**: total input size, requested output, message count, and advertised tools
  constrain what a model can execute but do not imply reasoning difficulty.

When deterministic classification remains neutral, Auto first performs the local neutral router
scoring pass described above. Only if that scoring is still role-neutral can the optional AI Intent
Classifier receive the bounded context. Its cache key includes a context digest, so identical text
such as `continue` is rejudged only when the AI tie-breaker is actually needed and recent execution
state changes. Legacy task-aware fallback ordering consumes the final front role decision: it
retains raw input size for context-window fit but cannot independently promote a Fast request to
Heavy/Critical because the conversation happens to be long.

Task-aware execution is observable at INFO level on every non-empty task-aware route. Auto logs use
`scope=fallback-only` and show the protected primary plus ordered fallback tail; legacy task-aware
strategies that may choose the primary use `scope=primary-and-fallback`. The task level, reasons,
and conversation cache key remain visible in the same decision line.

---

## Categorized Adaptive Fallback Pools

The fallback tail is now a **classified execution plan**, not a single globally sortable list.
After the front classifier chooses a preferred worker role, `rolePools.ts` stamps each resolved
worker target with request-local membership and an authoritative fallback tier.

The execution hierarchy is:

```text
Strong Reasoning request:
  Strong Reasoning pool → Fast Worker pool → General/unassigned

Fast Worker request:
  Fast Worker pool → Strong Reasoning pool → General/unassigned
```

`task-route` still scores model fitness, but it sorts **within a tier only**. A high task-fit score
from a later pool cannot cross the tier boundary. For example, a Fast Worker candidate cannot jump
between two Strong Reasoning candidates while Strong is still the active fallback category.
Prompt-cache affinity follows the same rule, so the cache stage cannot undo the task-route boundary.

General/unassigned models are intentionally the final safety pool. A Step assigned to both Fast and
Strong is consumed in the first applicable worker tier and deduplicated by `executionKey`, avoiding
repeat attempts or fallback loops.

### Task-Route Logging

Adaptive task-route decisions now expose the categorized fallback plan directly at INFO level. A
Strong Reasoning decision can look like:

```text
task-route task=heavy (adaptive-role:strongReasoning) scope=fallback-only \
primary=<selected-strong-model> \
fallbackPools=strongReasoning:[<strong-2>,<strong-3>] > fastWorker:[<fast-1>,<fast-2>] > general:[<general-1>] \
cacheKey=<key>
```

For a Fast Worker request the first two categories reverse. Categories with no surviving target are
absent from the log. Non-adaptive task-aware strategies keep the legacy flat `fallbacks=...` field,
so this observability change does not alter their log contract.

### Regression Coverage

`tests/unit/adaptive-task-routing-pool-boundaries.test.ts` locks four behaviors:

1. Strong Reasoning exhausts Strong, then Fast, then General.
2. Fast Worker exhausts Fast, then Strong, then General.
3. `task-route` may rearrange models inside a pool but cannot cross pool boundaries.
4. Prompt-cache affinity cannot promote a target from a later adaptive pool.

The repository's push-triggered `Build App` workflow is also expected to run for this branch. The
GitHub connector used for this edit does not expose a command runner or workflow run listing for
push events, so Node/Vitest/typecheck/lint results must be recorded as green only after an actual
runner reports them; `status.md` keeps that validation state explicit.

---

## Neutral Router-Score Gate Before AI Classification

The neutral path now preserves the intended token-cost hierarchy:

```text
Deterministic Fast/Strong
  → use that role directly

Deterministic neutral
  → ordinary Auto router scoring, base/effective weights, no role boost
      → unique Fast top score   → Fast Worker, no AI call
      → unique Strong top score → Strong Reasoning, no AI call
      → role-neutral top score  → optional AI Intent Classifier
```

A router score is considered role-neutral when the top score band contains a General/unassigned
candidate, a candidate assigned to both roles, or equally-scored Fast and Strong candidates. The
comparison uses a small `1e-4` epsilon to absorb floating-point normalization noise without treating
a meaningfully lower opposing role as a tie.

The AI branch additionally requires routable candidates in **both** explicit role pools. If one side
is absent or fully filtered by quota/eligibility, no classifier tokens are spent; neutral Auto
scoring continues normally. This gate changes only how a missing role preference is resolved. It
does not alter primary-selection authority, role-specific weight application, or the categorized
Strong → Fast → General / Fast → Strong → General fallback contract.

Focused regression coverage lives in `tests/unit/autoCombo/adaptiveRoleResolution.test.ts` and locks
unique Fast/Strong resolution, cross-role ties, General and dual-role neutrality, and the epsilon
boundary.