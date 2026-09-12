// Generic deterministic metric helpers.
//
// Every metric exposed to the UI and to Gemini carries:
//   value, valid, confidence, timestamp
// Invalid landmarks must never produce a `valid: true` metric.

import type { Metric } from "@/types";

export interface FormMetric {
  value: number;
  valid: boolean;
  confidence: number;
  timestamp: number;
}

export function makeMetric(
  value: number,
  valid: boolean,
  confidence: number,
  timestamp: number
): FormMetric {
  return { value, valid, confidence, timestamp };
}

export function toMetric(key: string, label: string, m: FormMetric): Metric {
  return {
    key,
    label,
    value: m.value,
    valid: m.valid,
    confidence: m.confidence,
    timestamp: m.timestamp,
  };
}

export function weightedMean(
  entries: Array<{ metric: FormMetric; weight: number }>
): FormMetric {
  const validEntries = entries.filter((e) => e.metric.valid);
  if (validEntries.length === 0) {
    const t = entries[0]?.metric.timestamp ?? 0;
    return makeMetric(0, false, 0, t);
  }
  let wSum = 0;
  let acc = 0;
  let conf = 0;
  let ts = 0;
  for (const e of validEntries) {
    wSum += e.weight;
    acc += e.weight * e.metric.value;
    conf += e.metric.confidence * e.weight;
    ts = Math.max(ts, e.metric.timestamp);
  }
  return makeMetric(acc / wSum, true, conf / wSum, ts);
}

export const clamp = (x: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, x));

export const clamp01 = (x: number) => clamp(x, 0, 1);
