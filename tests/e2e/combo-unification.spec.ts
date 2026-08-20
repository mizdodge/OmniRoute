import { expect, test } from "@playwright/test";
import { gotoDashboardRoute } from "./helpers/dashboardAuth";

async function mockCombosPageApis(page: import("@playwright/test").Page) {
  await page.route("**/api/combos", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        combos: [
          {
            id: "combo-auto",
            name: "combo-auto",
            models: ["openai/gpt-4o-mini"],
            strategy: "auto",
            config: { candidatePool: ["openai", "anthropic"], modePack: "ship-fast" },
            isActive: true,
          },
          {
            id: "combo-priority",
            name: "combo-priority",
            models: ["anthropic/claude-sonnet-4-6"],
            strategy: "priority",
            isActive: true,
          },
        ],
      }),
    });
  });

  await page.route("**/api/combos/metrics", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ metrics: {} }),
    });
  });

  await page.route("**/api/providers", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        connections: [
          { id: "conn-openai", provider: "openai", name: "OpenAI", testStatus: "active" },
          {
            id: "conn-anthropic",
            provider: "anthropic",
            name: "Anthropic",
            testStatus: "active",
          },
        ],
      }),
    });
  });

  await page.route("**/api/provider-nodes", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ nodes: [] }),
    });
  });

  await page.route("**/api/settings/proxy", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ combos: {} }),
    });
  });

  await page.route("**/api/monitoring/health", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        circuitBreakers: [
          { provider: "openai", state: "CLOSED" },
          { provider: "anthropic", state: "OPEN", lastFailure: new Date().toISOString() },
        ],
      }),
    });
  });
}

async function mockBuilderApis(page: import("@playwright/test").Page) {
  await page.route("**/api/models/alias", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ aliases: {} }),
    });
  });

  await page.route("**/api/pricing", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({}),
    });
  });

  await page.route("**/api/settings/combo-defaults", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ comboDefaults: {} }),
    });
  });

  await page.route("**/api/combos/builder/options", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        providers: [
          {
            providerId: "openai",
            displayName: "OpenAI",
            connectionCount: 1,
            models: [
              { id: "gpt-4o-mini", name: "gpt-4o-mini" },
              { id: "gpt-4o", name: "gpt-4o" },
            ],
            connections: [{ id: "conn-openai", label: "OpenAI Main", status: "active" }],
          },
        ],
        comboRefs: [],
      }),
    });
  });
}

test.describe("Combo Unification", () => {
  test.beforeEach(async ({ page }) => {
    await mockCombosPageApis(page);
    await mockBuilderApis(page);
  });

  test("combos page exposes strategy tabs and intelligent panel", async ({ page }) => {
    await gotoDashboardRoute(page, "/dashboard/combos?filter=intelligent");

    await expect(
      page
        .locator("button")
        .filter({ has: page.locator("span", { hasText: "layers" }) })
        .filter({ hasText: "All" })
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /intelligent/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /deterministic/i })).toBeVisible();
    await expect(page.getByText("Intelligent Routing Dashboard")).toBeVisible();
    await expect(page.getByText("Provider Scores")).toBeVisible();
  });

  test("legacy auto-combo route redirects to intelligent combos filter", async ({ page }) => {
    await gotoDashboardRoute(page, "/dashboard/auto-combo");
    await page.waitForURL(/\/dashboard\/combos\?filter=intelligent/);
    await expect(page).toHaveURL(/\/dashboard\/combos\?filter=intelligent/);
  });

  test("sidebar no longer shows auto combo entry", async ({ page }) => {
    await gotoDashboardRoute(page, "/dashboard/combos");

    const sidebar = page.locator("aside, nav").first();
    await expect(sidebar.getByText("Combos", { exact: true })).toBeVisible();
    await expect(sidebar.getByText("Auto Combo")).toHaveCount(0);
  });

  test("builder shows intelligent step when auto strategy is selected", async ({ page }) => {
    await gotoDashboardRoute(page, "/dashboard/combos");

    await page.getByRole("button", { name: /create combo/i }).click();
    await page.getByLabel(/combo name/i).waitFor({ state: "visible" });
    await page.getByLabel(/combo name/i).fill("e2e-auto-builder");
    await page.getByTestId("combo-builder-next").click();

    await page.getByTestId("combo-builder-provider").waitFor({ state: "visible" });
    await page.getByTestId("combo-builder-provider").selectOption("openai");
    await page.getByTestId("combo-builder-model").waitFor({ state: "attached" });
    await page.getByTestId("combo-builder-model").selectOption("gpt-4o-mini");
    await page.getByTestId("combo-builder-add-step").click();
    await page.getByTestId("combo-builder-next").click();

    await page.getByTestId("strategy-option-auto").waitFor({ state: "visible" });
    await page.getByTestId("strategy-option-auto").click();
    await page.getByTestId("combo-builder-next").click();

    await expect(page.getByText("Candidate Pool", { exact: true })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("Mode Pack", { exact: true })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("Exploration Rate", { exact: true })).toBeVisible({
      timeout: 15000,
    });
  });

  test("builder saves Fast Worker and Strong Reasoning Step references", async ({ page }) => {
    let savedPayload: Record<string, unknown> | null = null;
    const savedCombos: Record<string, unknown>[] = [];

    await page.unroute("**/api/combos");
    await page.route("**/api/combos", async (route) => {
      if (route.request().method() === "POST") {
        savedPayload = route.request().postDataJSON() as Record<string, unknown>;
        const combo = { id: "adaptive-e2e-id", ...savedPayload };
        savedCombos.push(combo);
        await route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify(combo),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ combos: savedCombos, total: savedCombos.length }),
      });
    });

    await gotoDashboardRoute(page, "/dashboard/combos");
    await page
      .getByRole("button", { name: /create combo/i })
      .first()
      .click();
    const dialog = page.getByRole("dialog").first();
    const next = dialog.getByTestId("combo-builder-next");

    await dialog.getByLabel(/combo name/i).fill("adaptive-e2e-combo");
    await next.click();

    await dialog.getByTestId("combo-builder-provider").selectOption("openai");
    await dialog.getByTestId("combo-builder-model").selectOption("gpt-4o-mini");
    await dialog.getByTestId("combo-builder-add-step").click();
    await dialog.getByTestId("combo-builder-model").selectOption("gpt-4o");
    await dialog.getByTestId("combo-builder-add-step").click();
    await next.click();

    await dialog.getByTestId("strategy-option-auto").click();
    await next.click();

    const fastPool = dialog.getByRole("group", { name: "Fast Worker Pool" });
    const strongPool = dialog.getByRole("group", { name: "Strong Reasoning Pool" });
    await fastPool.getByRole("button").filter({ hasText: "openai/gpt-4o-mini" }).click();
    await strongPool.getByRole("button", { name: /openai\/gpt-4o OpenAI Main$/ }).click();
    await expect(fastPool.getByRole("button", { pressed: true })).toHaveCount(1);
    await expect(strongPool.getByRole("button", { pressed: true })).toHaveCount(1);
    await dialog
      .getByLabel("AI Intent Classifier")
      .selectOption({ label: "openai/gpt-4o — OpenAI Main" });
    await dialog.getByText("Advanced: Scoring Weights", { exact: true }).click();
    const fastWeightsHeader = dialog
      .getByText("Fast Worker Weights", { exact: true })
      .locator("../..");
    await expect(fastWeightsHeader.getByText(/one eligible model/i)).toBeVisible();
    await fastWeightsHeader.getByRole("button", { name: "Customize" }).click();
    await next.click();

    await expect(dialog.getByText("Fast Worker Pool", { exact: true })).toBeVisible();
    await expect(dialog.getByText("Strong Reasoning Pool", { exact: true })).toBeVisible();
    await dialog
      .getByRole("button", { name: /create combo/i })
      .last()
      .click();
    await expect(dialog).toBeHidden();

    expect(savedPayload).not.toBeNull();
    const payload = savedPayload as Record<string, unknown>;
    const models = payload.models as Array<{ id?: string; model?: string }>;
    const config = payload.config as Record<string, unknown>;
    const fastStepId = models.find((step) => step.model === "openai/gpt-4o-mini")?.id;
    const strongStepId = models.find((step) => step.model === "openai/gpt-4o")?.id;

    expect(fastStepId).toBeTruthy();
    expect(strongStepId).toBeTruthy();
    expect(config.fastWorkerModelRefs).toEqual([fastStepId]);
    expect(config.strongReasoningModelRefs).toEqual([strongStepId]);
    expect(config.adaptiveJudgeModelRef).toBe(strongStepId);
    expect(config.fastWorkerWeights).toEqual(expect.objectContaining({ latencyInv: 0.12 }));
    expect(config.strongReasoningWeights).toBeUndefined();
  });
});
