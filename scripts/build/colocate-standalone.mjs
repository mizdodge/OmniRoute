#!/usr/bin/env node
/**
 * OmniRoute — Co-locate runtime workers into the raw Next standalone build.
 *
 * WHY: `npm run build` produces `.build/next/standalone/` and THIS machine's PM2
 * deployment runs `server.js` from that directory directly (not the assembled
 * `dist/` bundle). The standalone trace cannot see worker_threads entrypoints
 * resolved at runtime, including the required call-log artifact worker and the
 * optional LLMLingua-2 worker. It also omits LLMLingua's optional dependencies.
 *
 * The call-log worker is required, so a bundle failure must fail the build.
 * LLMLingua remains fail-soft when its optional dependencies are absent.
 *
 * Run manually after a build, or automatically via the `postbuild` npm hook.
 */
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { computeDependencyClosure } from "./colocateOptionals.mjs";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const STANDALONE = join(ROOT, ".build", "next", "standalone");
const ESBUILD_CLI = join(ROOT, "node_modules", "esbuild", "bin", "esbuild");

const CALL_LOG_WORKER_REL = join("src", "lib", "usage", "callLogArtifactWorker.js");
const CALL_LOG_WORKER_SRC = join(ROOT, "src", "lib", "usage", "callLogArtifactWorker.ts");
const WORKER_REL = join(
  "open-sse",
  "services",
  "compression",
  "engines",
  "llmlingua",
  "onnxWorker.js"
);
const GATE_PKG = join("node_modules", "@atjsh", "llmlingua-2", "package.json");

const hasOptionals = existsSync(
  join(ROOT, "node_modules", "@atjsh", "llmlingua-2", "package.json")
);

if (!existsSync(STANDALONE)) {
  console.log("[colocate-standalone] .build/next/standalone not found — nothing to do.");
  process.exit(0);
}
const callLogWorkerDest = join(STANDALONE, CALL_LOG_WORKER_REL);
mkdirSync(dirname(callLogWorkerDest), { recursive: true });
execFileSync(
  process.execPath,
  [
    ESBUILD_CLI,
    CALL_LOG_WORKER_SRC,
    "--bundle",
    "--platform=node",
    "--packages=external",
    "--format=esm",
    `--outfile=${callLogWorkerDest}`,
  ],
  { stdio: "inherit" }
);
console.log("[colocate-standalone] ✅ call-log artifact worker bundled");

if (!hasOptionals) {
  console.log(
    "[colocate-standalone] optional SLM deps absent at root node_modules — LLMLingua stays fail-open (slim install)."
  );
  process.exit(0);
}

// 1) Bundle the worker the resolver expects: <standalone>/open-sse/.../onnxWorker.js
const workerDest = join(STANDALONE, WORKER_REL);
if (!existsSync(workerDest)) {
  mkdirSync(dirname(workerDest), { recursive: true });
  try {
    execFileSync(
      process.execPath,
      [
        ESBUILD_CLI,
        join(ROOT, "open-sse", "services", "compression", "engines", "llmlingua", "onnxWorker.ts"),
        "--bundle",
        "--platform=node",
        "--packages=external",
        "--format=esm",
        `--outfile=${workerDest}`,
      ],
      { stdio: "inherit" }
    );
    console.log("[colocate-standalone] ✅ LLMLingua worker bundled into standalone tree");
  } catch (err) {
    console.warn("[colocate-standalone] ⚠️  worker bundle error:", err.message);
  }
} else {
  console.log("[colocate-standalone] worker already present (skipping bundle)");
}

// 2) Co-locate the optional-dep closure (NO-CLOBBER, same semantics as colocateOptionals.mjs)
const srcNm = join(ROOT, "node_modules");
const dstNm = join(STANDALONE, "node_modules");
const closure = computeDependencyClosure(srcNm);
let copied = 0;
for (const pkg of closure) {
  const src = join(srcNm, pkg);
  const dst = join(dstNm, pkg);
  if (!existsSync(src)) continue;
  if (existsSync(dst)) continue; // no-clobber: keep traced instances (e.g. pinned @huggingface/transformers)
  mkdirSync(dirname(dst), { recursive: true });
  cpSync(src, dst, { recursive: true });
  copied++;
}
console.log(
  `[colocate-standalone] ✅ optional-dep closure: ${closure.length} packages (copied ${copied})`
);
