// A scripted model for tests and e2e (COACH_MOCK=1, never in production): the first step calls get_day (log_water
// when asked to log), the next answers in text. Deterministic, so the e2e can assert on the tool card and the reply.
import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 10, text: 10, reasoning: undefined },
};

export const MOCK_REPLY = "Your recovery is shown above. **Take it easy** if it is low, and aim for your usual bedtime.";

/** What the scripted model reads out of any document (medical/extract.ts): a small blood test with one high result. */
export const MOCK_EXTRACTION = {
  kind: "lab_report",
  title: "Blood test (mock)",
  date: "2026-09-30",
  practitioner: "Dr Mock",
  labName: "Mock Lab",
  labs: [
    { analyte: "hemoglobin", label: "Hemoglobin", value: 14.2, valueText: null, unit: "g/dL", refLow: 13, refHigh: 17, refText: null, flag: null },
    { analyte: "ldl_cholesterol", label: "LDL cholesterol", value: 1.7, valueText: null, unit: "g/L", refLow: null, refHigh: 1.6, refText: null, flag: "high" },
  ],
  medications: [{ name: "Mockstatin", dose: "10 mg", form: "tablet", route: "oral", times: ["20:00"], prn: false, durationDays: 90, reason: "cholesterol" }],
  appointments: [],
  summary: "A routine blood test. LDL cholesterol is above the printed range.",
};

/** A prompt that carries a file part: the extraction, not a chat turn. */
const hasFile = (prompt: { role: string; content: unknown }[]) =>
  prompt.some((m) => m.role === "user" && Array.isArray(m.content) && m.content.some((p: { type?: string }) => p?.type === "file"));

export function mockModel() {
  return new MockLanguageModelV4({
    doGenerate: async ({ prompt }) => ({
      content: [{ type: "text", text: hasFile(prompt) ? JSON.stringify(MOCK_EXTRACTION) : "ok" }],
      finishReason: { unified: "stop", raw: undefined },
      usage,
      warnings: [],
    }),
    doStream: async ({ prompt }) => {
      const text = [
        { type: "text-start" as const, id: "t1" },
        ...MOCK_REPLY.split(/(?<= )/).map((delta) => ({ type: "text-delta" as const, id: "t1", delta })),
        { type: "text-end" as const, id: "t1" },
        { type: "finish" as const, finishReason: { unified: "stop" as const, raw: undefined }, usage },
      ];
      const current = prompt.slice(prompt.findLastIndex((m) => m.role === "user"));
      const question = JSON.stringify(current[0]?.content ?? "").toLowerCase();
      const used = new Set(current.flatMap((m) => m.role === "tool" ? m.content.flatMap((p) => p.type === "tool-result" ? [p.toolName] : []) : []));
      const plan = /\blog\b/.test(question) ? ["log_water"] : /m[ée]dic|traitement|pill|medication/.test(question) ? ["get_medications"] : /\blab|analys|blood|sang|cholest/.test(question) ? ["get_lab_results"] : question.includes("brief") ? ["get_day", "get_sleep", "get_health", "get_activities"] : question.includes("trend") || question.includes("hrv") ? ["get_trend"] : question.includes("habit") ? ["get_journal_impacts"] : question.includes("sleep") ? ["get_sleep"] : ["get_day"];
      const next = plan.find((name) => !used.has(name));
      const input = next === "get_trend" ? JSON.stringify({ metric: question.includes("hrv") ? "hrv" : "recovery" }) : next === "get_activities" ? JSON.stringify({ days: 14 }) : next === "get_journal_impacts" ? JSON.stringify({ outcome: "recovery" }) : next === "log_water" ? JSON.stringify({ ml: 500 }) : "{}";
      const call = [
        { type: "tool-call" as const, toolCallId: `call-${prompt.length}`, toolName: next ?? "get_day", input },
        { type: "finish" as const, finishReason: { unified: "tool-calls" as const, raw: undefined }, usage },
      ];
      const chunks: ((typeof text)[number] | (typeof call)[number])[] = next ? call : text;
      return { stream: simulateReadableStream({ chunks, chunkDelayInMs: 20 }) };
    },
  });
}
