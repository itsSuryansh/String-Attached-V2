// Deterministic ukulele measurement math (pure functions, fully unit-tested).
//
// Pose score, transition score, strum score, and the Form Match Index (FMI)
// composition. These formulas are part of the measurement contract (§12-§18).

import type { NormalizedLandmark } from "@/types";
import { meanLandmarkDistance, poseScore } from "@/cv/normalizer";

export const POSE_DISTANCE_NORM = 0.8;
export const TRANSITION_FAST_MS = 1500;
export const STRUM_REQUIRED = 2;

export function chordPoseScore(
  landmarks: NormalizedLandmark[],
  template: NormalizedLandmark[]
): number {
  const d = meanLandmarkDistance(landmarks, template);
  const clamped = Math.max(0, Math.min(1, 1 - d / POSE_DISTANCE_NORM));
  return 100 * clamped;
}

export { poseScore as rawPoseScore };

/**
 * Transition score from the measured C->Am transition time.
 *   Δt <= 1500ms -> 100, otherwise 100 * min(1, 1500/Δt).
 */
export function transitionScore(deltaMs: number): number {
  if (deltaMs <= 0) return 0;
  if (deltaMs <= TRANSITION_FAST_MS) return 100;
  return 100 * Math.min(1, TRANSITION_FAST_MS / deltaMs);
}

/** Strum score grows with each correlated downstroke (2 => 100). */
export function strumScore(strumCount: number): number {
  return Math.min(100, (strumCount / STRUM_REQUIRED) * 100);
}

export interface FmiParts {
  poseScoreC: number;
  poseScoreAm: number;
  transition: number | null;
  strum: number | null;
}

/**
 * Form Match Index composition. Only currently-valid metrics are included and
 * the weights are renormalized over the valid subset (§17).
 */
export function computeFmi(
  phase: string,
  parts: FmiParts
): { value: number; valid: boolean } {
  switch (phase) {
    case "C_CHORD":
    case "C_STABLE":
      return { value: parts.poseScoreC, valid: true };
    case "TRANSITIONING":
      return {
        value: Math.max(parts.poseScoreC, parts.poseScoreAm),
        valid: true,
      };
    case "AM_CANDIDATE":
    case "AM_STABLE": {
      if (parts.transition === null) {
        return { value: parts.poseScoreAm, valid: true };
      }
      const value =
        (0.5 * parts.poseScoreAm + 0.3 * parts.transition) / 0.8;
      return { value, valid: true };
    }
    case "STRUM_DYNAMICS":
    case "LESSON_PASS": {
      // Pose .50, transition .30, strum .20 — renormalized over the valid set.
      const entries: Array<{ v: number; w: number }> = [
        { v: parts.poseScoreAm, w: 0.5 },
      ];
      if (parts.transition !== null) {
        entries.push({ v: parts.transition, w: 0.3 });
      }
      if (parts.strum !== null) {
        entries.push({ v: parts.strum, w: 0.2 });
      }
      let wSum = 0;
      let acc = 0;
      for (const e of entries) {
        wSum += e.w;
        acc += e.w * e.v;
      }
      return { value: acc / wSum, valid: true };
    }
    default:
      return { value: 0, valid: false };
  }
}
