# Upstream v3.8.52 integration — verification pending

## Scope
- Upstream: diegosouzapw/OmniRoute `release/v3.8.52` at `7f3cbb046b3706bf0bbc047b7eaa0cbada8d9e50`
- Custom base: mizdodge/OmniRoute `codex/v3.8.51` at `19971f8b630a79976d88fc834edda0ffc8aa6966`
- Target: `sync/upstream-v3.8.52-from-v3.8.51` only.
- Merge method: 3-way text reconciliation based on common ancestor `b754e44e260ba888035b8ec077b4da8ea4483e48`, including manual corrections for overlapping hunks.

## Custom behavior retained for validation
- Adaptive Fast Worker / Strong Reasoning role pools; tiered fallback and judge separation.
- Task/intent/context classifiers and deterministic-first routing.
- Role-specific weights, selection, failover order, UI panels, API schemas and regression tests.

## Upstream behavior manually restored
- Quota-share and quota-weighted in-flight release lifecycle.
- Strategy-registry traits for prompt-cache affinity.
- Auto reset-window compatibility and Nadir configuration.
- OpenAI/GitHub provider retirement filtering imports, Combo UI imports.
- Quality and reliability score factors.
- Complexity-routing async invocation.
- Upstream version/package-lock consistency.
- Upstream build worker colocation tooling (already bundles call-log artifact worker).
- Latest upstream changelog intact; its GitHub content response is too large to reconcile line-by-line through this connector.

## NOT yet verified
This is an integration **candidate**, not a production-ready release.

1. CI jobs in this fork failed before any build/test step executed.
2. Local Git transport in the assistant environment could not resolve github.com.
3. Functional regression checks and typechecks have therefore NOT been run.
4. Manual conflict choices, especially `resolveAutoStrategy.ts`, UI Combo, API routes, scoring, OpenAPI spec, and custom tests, require review and validation.

## Required commands
```bash
npm ci
npm run typecheck:core
npm run check:open-sse-typecheck
npm run check:dashboard-typecheck
npm run lint
npm run test:unit:ci
npm run build:fast
```
Additionally run custom targeted adaptive routing tests and verify the full Fast Worker -> Strong Reasoning fallback sequence.

Do not merge this integration branch into your main or production branch until all checks pass.
