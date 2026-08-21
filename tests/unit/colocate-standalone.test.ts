import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

test("colocate standalone invokes esbuild through Node on Windows", () => {
  const script = readFileSync(
    join(process.cwd(), "scripts", "build", "colocate-standalone.mjs"),
    "utf8"
  );

  assert.match(
    script,
    /const ESBUILD_CLI = join\(ROOT, "node_modules", "esbuild", "bin", "esbuild"\)/
  );
  assert.doesNotMatch(script, /join\(ROOT, "node_modules", "\.bin", "esbuild"\)/);
  assert.equal((script.match(/execFileSync\(\s*process\.execPath/g) ?? []).length, 2);
});

test("prepublish routes every esbuild invocation through the Windows-safe helper", () => {
  const script = readFileSync(join(process.cwd(), "scripts", "build", "prepublish.ts"), "utf8");

  assert.match(
    script,
    /Bundling ChatGPT Web \(Codex\) MCP bridge[\s\S]*?runBuildTool\(\s*"esbuild",\s*"esbuild"/
  );
});
