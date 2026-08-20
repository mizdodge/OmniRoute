import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { makeManagementSessionRequest } from "../helpers/managementSession.ts";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-adaptive-roles-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.DISABLE_SQLITE_AUTO_BACKUP = "true";
process.env.INITIAL_PASSWORD = "adaptive-routing-test-password";
process.env.JWT_SECRET = "adaptive-routing-test-jwt-secret";

const core = await import("../../src/lib/db/core.ts");
const combosRoute = await import("../../src/app/api/combos/route.ts");
const comboRoute = await import("../../src/app/api/combos/[id]/route.ts");

type JsonObject = Record<string, unknown>;

async function readJson(response: Response): Promise<JsonObject> {
  const value = (await response.json()) as unknown;
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};
}

function roleRefs(combo: JsonObject, field: string): string[] {
  const config = combo.config;
  if (!config || typeof config !== "object" || Array.isArray(config)) return [];
  const refs = (config as JsonObject)[field];
  return Array.isArray(refs) ? refs.filter((ref): ref is string => typeof ref === "string") : [];
}

function configField(combo: JsonObject, field: string): unknown {
  const config = combo.config;
  return config && typeof config === "object" && !Array.isArray(config)
    ? (config as JsonObject)[field]
    : undefined;
}

test.after(() => {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

test("adaptive role pools round-trip through Combo APIs and stale refs are pruned on Step update", async () => {
  const fastStep = {
    id: "adaptive-fast-step",
    kind: "model",
    providerId: "openai",
    model: "openai/gpt-4o-mini",
    connectionId: null,
    weight: 0,
  };
  const strongStep = {
    id: "adaptive-strong-step",
    kind: "model",
    providerId: "anthropic",
    model: "anthropic/claude-sonnet-4-6",
    connectionId: null,
    weight: 0,
  };

  const createResponse = await combosRoute.POST(
    await makeManagementSessionRequest("http://localhost/api/combos", {
      method: "POST",
      body: {
        name: "adaptive-role-contract",
        strategy: "auto",
        models: [fastStep, strongStep],
        config: {
          modePack: "ship-fast",
          explorationRate: 0,
          fastWorkerModelRefs: [fastStep.id, "stale-step"],
          strongReasoningModelRefs: [strongStep.id, fastStep.id],
          adaptiveJudgeModelRef: strongStep.id,
          fastWorkerWeights: {
            quota: 0,
            health: 0,
            costInv: 1,
            latencyInv: 0,
            taskFit: 0,
            stability: 0,
          },
          strongReasoningWeights: {
            quota: 0,
            health: 0,
            costInv: 0,
            latencyInv: 0,
            taskFit: 1,
            stability: 0,
          },
        },
      },
    })
  );
  const created = await readJson(createResponse);

  assert.equal(createResponse.status, 201, JSON.stringify(created));
  assert.equal(typeof created.id, "string");
  assert.deepEqual(roleRefs(created, "fastWorkerModelRefs"), [fastStep.id]);
  assert.deepEqual(roleRefs(created, "strongReasoningModelRefs"), [strongStep.id, fastStep.id]);
  assert.equal(configField(created, "adaptiveJudgeModelRef"), strongStep.id);
  assert.equal((configField(created, "fastWorkerWeights") as JsonObject)?.costInv, 1);
  assert.equal((configField(created, "strongReasoningWeights") as JsonObject)?.taskFit, 1);

  const listResponse = await combosRoute.GET(
    await makeManagementSessionRequest("http://localhost/api/combos")
  );
  const listed = await readJson(listResponse);
  const combos = Array.isArray(listed.combos) ? (listed.combos as JsonObject[]) : [];
  const saved = combos.find((combo) => combo.name === "adaptive-role-contract");

  assert.equal(listResponse.status, 200);
  assert.ok(saved, "created adaptive Combo must be returned by GET /api/combos");
  assert.deepEqual(roleRefs(saved, "fastWorkerModelRefs"), [fastStep.id]);
  assert.deepEqual(roleRefs(saved, "strongReasoningModelRefs"), [strongStep.id, fastStep.id]);
  assert.equal(configField(saved, "adaptiveJudgeModelRef"), strongStep.id);
  assert.equal((configField(saved, "fastWorkerWeights") as JsonObject)?.costInv, 1);
  assert.equal((configField(saved, "strongReasoningWeights") as JsonObject)?.taskFit, 1);

  const comboId = String(created.id);
  const updateResponse = await comboRoute.PUT(
    await makeManagementSessionRequest(`http://localhost/api/combos/${comboId}`, {
      method: "PUT",
      body: { models: [fastStep] },
    }),
    { params: Promise.resolve({ id: comboId }) }
  );
  const updated = await readJson(updateResponse);

  assert.equal(updateResponse.status, 200, JSON.stringify(updated));
  assert.deepEqual(roleRefs(updated, "fastWorkerModelRefs"), [fastStep.id]);
  assert.deepEqual(roleRefs(updated, "strongReasoningModelRefs"), [fastStep.id]);
  assert.equal(configField(updated, "adaptiveJudgeModelRef"), undefined);
  assert.equal((configField(updated, "fastWorkerWeights") as JsonObject)?.costInv, 1);
  assert.equal((configField(updated, "strongReasoningWeights") as JsonObject)?.taskFit, 1);
});
