import { createHash } from "node:crypto";

const MAX_RECENT_ITEMS = 6;
const MAX_ITEM_CHARS = 360;
const MAX_SUMMARY_CHARS = 2_000;
const FAILURE_RE = /\b(error|failed|failure|exception|timeout|invalid|denied|unavailable)\b/i;

export interface FrontRoutingContext {
  currentRequest: string;
  recentWorkSummary: string;
  contextDigest: string;
  capability: {
    estimatedTotalInputTokens: number;
    requestedOutputTokens: number;
    messageCount: number;
    advertisedToolCount: number;
    requiresTools: boolean;
  };
  execution: {
    isContinuation: boolean;
    recentToolEvents: number;
    recentFailures: number;
    reasoningEffort: string;
  };
}

function collectText(value: unknown, output: string[] = []): string[] {
  if (value == null) return output;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    output.push(String(value));
    return output;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectText(item, output);
    return output;
  }
  if (typeof value !== "object") return output;

  const record = value as Record<string, unknown>;
  for (const key of ["text", "input_text", "output_text", "content", "parts"] as const) {
    if (key in record) collectText(record[key], output);
  }
  return output;
}

function normalizeText(value: unknown, maxChars = MAX_ITEM_CHARS): string {
  return collectText(value).join("\n").replace(/\s+/g, " ").trim().slice(0, maxChars);
}

function requestItems(body: Record<string, unknown>): unknown[] {
  if (Array.isArray(body.messages)) return body.messages;
  if (Array.isArray(body.input)) return body.input;
  if (Array.isArray(body.contents)) return body.contents;
  const nested = body.request as Record<string, unknown> | undefined;
  return Array.isArray(nested?.contents) ? nested.contents : [];
}

function maxRequestedOutput(body: Record<string, unknown>): number {
  const generationConfig = body.generationConfig as Record<string, unknown> | undefined;
  const values = [
    body.max_tokens,
    body.max_output_tokens,
    body.max_completion_tokens,
    generationConfig?.maxOutputTokens,
  ]
    .map((value) => Number.parseInt(String(value ?? ""), 10))
    .filter(Number.isFinite);
  return values.length > 0 ? Math.max(...values) : 0;
}

function normalizeEffort(body: Record<string, unknown>): string {
  const reasoning = body.reasoning as Record<string, unknown> | undefined;
  return String(body.reasoning_effort ?? reasoning?.effort ?? "").toLowerCase();
}

function hasExplicitToolChoice(body: Record<string, unknown>): boolean {
  const choice = body.tool_choice ?? body.toolChoice;
  if (choice === "required" || choice === "any") return true;
  if (!choice || typeof choice !== "object" || Array.isArray(choice)) return false;
  const record = choice as Record<string, unknown>;
  return (
    record.type === "required" || record.type === "any" || "function" in record || "name" in record
  );
}

function buildRecentWork(items: unknown[], currentRequest: string) {
  const recent: string[] = [];
  let recentToolEvents = 0;
  let recentFailures = 0;
  let lastMeaningfulRole = "";
  let skippedCurrentUserItem = false;

  for (let index = items.length - 1; index >= 0 && recent.length < MAX_RECENT_ITEMS; index -= 1) {
    const item = items[index];
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const role = String(record.role ?? "").toLowerCase();
    if (!role || role === "system" || role === "developer") continue;

    const toolCalls = Array.isArray(record.tool_calls) ? record.tool_calls.length : 0;
    const isToolEvent = role === "tool" || role === "function" || toolCalls > 0;

    const text = normalizeText(record.content ?? record.parts ?? record);
    if (!text) continue;
    const normalizedCurrentRequest = currentRequest.trim();
    if (
      role === "user" &&
      !skippedCurrentUserItem &&
      normalizedCurrentRequest &&
      (text === normalizedCurrentRequest || text.includes(normalizedCurrentRequest))
    ) {
      skippedCurrentUserItem = true;
      continue;
    }
    if (!lastMeaningfulRole) lastMeaningfulRole = role;
    if (isToolEvent) recentToolEvents += Math.max(1, toolCalls);
    if (isToolEvent && FAILURE_RE.test(text)) recentFailures += 1;
    recent.push(`${role}: ${text}`);
  }

  return {
    recentWorkSummary: recent.reverse().join("\n").slice(0, MAX_SUMMARY_CHARS),
    recentToolEvents,
    recentFailures,
    isContinuation: ["assistant", "tool", "function"].includes(lastMeaningfulRole),
  };
}

function estimateTotalInputChars(body: Record<string, unknown>): number {
  const nested = body.request as Record<string, unknown> | undefined;
  return collectText([
    body.system,
    body.instructions,
    body.messages,
    body.input,
    body.contents,
    nested?.contents,
    body.query,
  ]).join("\n").length;
}

export function buildFrontRoutingContext(
  body: Record<string, unknown> | null | undefined,
  currentRequest: string
): FrontRoutingContext {
  const requestBody = body ?? {};
  const items = requestItems(requestBody);
  const recent = buildRecentWork(items, currentRequest);
  const advertisedToolCount = Array.isArray(requestBody.tools) ? requestBody.tools.length : 0;
  const contextWithoutDigest = {
    currentRequest: currentRequest.trim(),
    recentWorkSummary: recent.recentWorkSummary,
    capability: {
      estimatedTotalInputTokens: Math.ceil(estimateTotalInputChars(requestBody) / 4),
      requestedOutputTokens: maxRequestedOutput(requestBody),
      messageCount: items.length,
      advertisedToolCount,
      requiresTools: hasExplicitToolChoice(requestBody),
    },
    execution: {
      isContinuation: recent.isContinuation,
      recentToolEvents: recent.recentToolEvents,
      recentFailures: recent.recentFailures,
      reasoningEffort: normalizeEffort(requestBody),
    },
  };
  const contextDigest = createHash("sha256")
    .update(JSON.stringify(contextWithoutDigest))
    .digest("hex")
    .slice(0, 24);

  return { ...contextWithoutDigest, contextDigest };
}

export function formatRoutingContextForClassifier(context: FrontRoutingContext): string {
  const recentWork = context.recentWorkSummary || "None available.";
  return [
    "CURRENT REQUEST:",
    context.currentRequest,
    "",
    "RECENT RELEVANT WORK (bounded; use only to resolve continuation):",
    recentWork,
    "",
    "EXECUTION STATE:",
    `continuation=${context.execution.isContinuation}; recentToolEvents=${context.execution.recentToolEvents}; recentFailures=${context.execution.recentFailures}; reasoningEffort=${context.execution.reasoningEffort || "unspecified"}`,
    "",
    "CAPABILITY METADATA (do not treat size or advertised tools alone as reasoning difficulty):",
    `estimatedTotalInputTokens=${context.capability.estimatedTotalInputTokens}; requestedOutputTokens=${context.capability.requestedOutputTokens}; advertisedTools=${context.capability.advertisedToolCount}`,
  ].join("\n");
}
