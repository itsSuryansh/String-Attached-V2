// Local outcome classification. Gemini NEVER decides outcome — local code does.
//
//   delta >= target   -> IMPROVED
//   delta <= -target  -> WORSE
//   otherwise         -> UNCHANGED
//   (not measurable)  -> NOT_MEASURABLE

import type { CoachingPriority, Outcome } from "@/types";

export const OUTCOME_TARGETS: Record<CoachingPriority, number> = {
  hand_configuration: 10,
  transition_speed: 15,
  strum_form: 20,
  basketball_form: 10,
  squat_form: 10,
  none: 0,
};

export function classifyOutcome(
  delta: number,
  priority: CoachingPriority,
  measurable: boolean
): Outcome {
  if (!measurable) return "NOT_MEASURABLE";
  const target = OUTCOME_TARGETS[priority] ?? 10;
  if (delta >= target) return "IMPROVED";
  if (delta <= -target) return "WORSE";
  return "UNCHANGED";
}
