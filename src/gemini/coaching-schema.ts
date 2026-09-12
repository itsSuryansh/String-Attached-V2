// Coaching contract + response validation.
//
// There is exactly ONE coaching decision mechanism: updateCoachingHUD.
// Gemini returns a small decision object; every response is validated before
// it is rendered. Malformed output is rejected and never silently replaced.

import type {
  CoachingPriority,
  InterventionRecord,
  Metric,
  Mode,
} from "@/types";

export const VALID_PRIORITIES: readonly CoachingPriority[] = [
  "hand_configuration",
  "transition_speed",
  "strum_form",
  "basketball_form",
  "squat_form",
  "none",
] as const;

export const MAX_CORRECTION_WORDS = 6;
export const MAX_CORRECTION_CHARS = 80;

export interface CoachingResponse {
  priority: CoachingPriority;
  correction: string;
  noIntervention: boolean;
  reason?: string;
}

export interface CoachingRequest {
  mode: Mode;
  state: string;
  priority: CoachingPriority;
  metrics: Metric[];
  trackingStatus: string;
  history: InterventionRecord[];
  /** Optional JPEG frame (base64, data URL) as visual evidence. */
  evidenceImage?: string;
}

export type ValidationResult =
  | { ok: true; value: CoachingResponse }
  | { ok: false; error: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isPriority(v: unknown): v is CoachingPriority {
  return (
    typeof v === "string" &&
    (VALID_PRIORITIES as readonly string[]).includes(v)
  );
}

/** Validate a raw Gemini coaching response before it is rendered. */
export function validateCoachingResponse(raw: unknown): ValidationResult {
  if (!isRecord(raw)) {
    return { ok: false, error: "response is not an object" };
  }

  const { priority, correction, noIntervention, reason } = raw;

  if (!isPriority(priority)) {
    return {
      ok: false,
      error: `invalid priority: ${String(priority)}`,
    };
  }

  if (typeof noIntervention !== "boolean") {
    return { ok: false, error: "missing noIntervention flag" };
  }

  const correctionStr = typeof correction === "string" ? correction.trim() : "";

  if (!noIntervention) {
    if (correctionStr.length === 0) {
      return { ok: false, error: "missing correction text" };
    }
    if (correctionStr.length > MAX_CORRECTION_CHARS) {
      return { ok: false, error: "correction too long" };
    }
    const wordCount = correctionStr.split(/\s+/).filter(Boolean).length;
    if (wordCount > MAX_CORRECTION_WORDS) {
      return { ok: false, error: "correction exceeds 6 words" };
    }
  }

  if (priority === "none" && !noIntervention) {
    return { ok: false, error: "none priority must be NO INTERVENTION" };
  }

  return {
    ok: true,
    value: {
      priority: priority as CoachingPriority,
      correction: noIntervention ? "" : correctionStr,
      noIntervention,
      reason: typeof reason === "string" ? reason : undefined,
    },
  };
}

/** Deterministic fallback cues — clearly labeled, never attributed to Gemini. */
export const DETERMINISTIC_CUES: Record<CoachingPriority, string> = {
  hand_configuration: "Adjust your finger placement",
  transition_speed: "Speed up the chord switch",
  strum_form: "Strum with a steady wrist",
  basketball_form: "Raise your shooting elbow",
  squat_form: "Keep knees over toes",
  none: "",
};

/** The system prompt contract handed to Gemini. */
export function buildCoachingPrompt(req: CoachingRequest): string {
  const metrics = req.metrics
    .filter((m) => m.valid)
    .map((m) => `${m.label}: ${m.value}`)
    .join(", ");
  const history = req.history
    .slice(-5)
    .map(
      (h) =>
        `${h.priority} -> "${h.correction}" (delta ${h.delta ?? "n/a"}, ${h.outcome ?? "pending"})`
    )
    .join("; ");

  return [
    "You are the coach in a motor-skill training app. You receive local measurements",
    "from the computer-vision system. You do NOT invent measurements. You only",
    "interpret the evidence you are given.",
    "",
    `Mode: ${req.mode}`,
    `State: ${req.state}`,
    `Suggested priority: ${req.priority}`,
    `Tracking status: ${req.trackingStatus}`,
    `Measurements: ${metrics || "none"}`,
    `Recent interventions: ${history || "none"}`,
    "",
    "Decide whether the learner needs a correction right now. If the evidence does",
    "not justify one, return NO INTERVENTION.",
    "",
    "Return STRICT JSON only, with exactly these fields:",
    '{ "priority": "<hand_configuration|transition_speed|strum_form|basketball_form|squat_form|none>", "correction": "<max 6 words, actionable>", "noIntervention": <bool>, "reason": "<short internal reason>" }',
    "",
    "If noIntervention is true, set priority to none and correction to empty.",
  ].join("\n");
}
