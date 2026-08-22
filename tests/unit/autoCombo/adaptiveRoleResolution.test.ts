import assert from "node:assert/strict";
import test from "node:test";

import { resolveNeutralRoleFromRouterScores } from "@omniroute/open-sse/services/autoCombo/adaptiveRoleResolution.ts";

type Scored = Parameters<typeof resolveNeutralRoleFromRouterScores>[0][number];

function scored(stepId: string, score: number): Scored {
  return { target: { stepId }, score };
}

const fast = new Set(["fast-1", "both-1"]);
const strong = new Set(["strong-1", "both-1"]);

test("neutral router scoring resolves a unique Fast Worker winner without AI", () => {
  assert.equal(
    resolveNeutralRoleFromRouterScores(
      [scored("fast-1", 0.91), scored("strong-1", 0.72)],
      fast,
      strong
    ),
    "fastWorker"
  );
});

test("neutral router scoring resolves a unique Strong Reasoning winner without AI", () => {
  assert.equal(
    resolveNeutralRoleFromRouterScores(
      [scored("strong-1", 0.93), scored("fast-1", 0.71)],
      fast,
      strong
    ),
    "strongReasoning"
  );
});

test("Fast and Strong tied in the top score band remain neutral", () => {
  assert.equal(
    resolveNeutralRoleFromRouterScores(
      [scored("fast-1", 0.9), scored("strong-1", 0.89995)],
      fast,
      strong
    ),
    null
  );
});

test("General top scorer remains role-neutral", () => {
  assert.equal(
    resolveNeutralRoleFromRouterScores(
      [scored("general-1", 0.95), scored("fast-1", 0.8)],
      fast,
      strong
    ),
    null
  );
});

test("dual-role top scorer remains role-neutral", () => {
  assert.equal(
    resolveNeutralRoleFromRouterScores(
      [scored("both-1", 0.95), scored("fast-1", 0.8)],
      fast,
      strong
    ),
    null
  );
});

test("lower opposing role outside the top score band does not neutralize the winner", () => {
  assert.equal(
    resolveNeutralRoleFromRouterScores(
      [scored("fast-1", 0.9), scored("strong-1", 0.8998)],
      fast,
      strong
    ),
    "fastWorker"
  );
});
