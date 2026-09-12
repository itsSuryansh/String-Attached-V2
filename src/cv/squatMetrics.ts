// Deterministic squat form metrics.
//
// A squat requires an actual standing → descending → bottom → ascending →
// standing cycle. Static poses and incomplete movements never count.

import type { Landmark3D } from "@/types";
import { SQUAT_CONFIG, JOINT_VISIBILITY_MIN } from "./sportConfig";
import {
  angleAt,
  angleFromVertical,
  distance2D,
  jointVisible,
  toPoint2,
} from "./angles";
import { makeMetric, type FormMetric } from "./metrics";

// MediaPipe pose landmark indices.
const SHOULDER_L = 11;
const SHOULDER_R = 12;
const HIP_L = 23;
const HIP_R = 24;
const KNEE_L = 25;
const KNEE_R = 26;
const ANKLE_L = 27;
const ANKLE_R = 28;

export function midpoint(
  a: { x: number; y: number },
  b: { x: number; y: number }
): { x: number; y: number } {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function kneeAngleLeft(landmarks: Landmark3D[]): number {
  return angleAt(
    toPoint2(landmarks[HIP_L]),
    toPoint2(landmarks[KNEE_L]),
    toPoint2(landmarks[ANKLE_L])
  );
}

export function kneeAngleRight(landmarks: Landmark3D[]): number {
  return angleAt(
    toPoint2(landmarks[HIP_R]),
    toPoint2(landmarks[KNEE_R]),
    toPoint2(landmarks[ANKLE_R])
  );
}

/** Mean knee angle across both legs. */
export function meanKneeAngle(landmarks: Landmark3D[]): number {
  return (kneeAngleLeft(landmarks) + kneeAngleRight(landmarks)) / 2;
}

export function hipAngle(landmarks: Landmark3D[]): number {
  // Hip flexion: torso (shoulder-hip) vs thigh (hip-knee).
  const shoMid = midpoint(
    toPoint2(landmarks[SHOULDER_L]),
    toPoint2(landmarks[SHOULDER_R])
  );
  const hipMid = midpoint(toPoint2(landmarks[HIP_L]), toPoint2(landmarks[HIP_R]));
  const kneeMid = midpoint(
    toPoint2(landmarks[KNEE_L]),
    toPoint2(landmarks[KNEE_R])
  );
  return angleAt(shoMid, hipMid, kneeMid);
}

export function hipHeight(landmarks: Landmark3D[]): number {
  return midpoint(toPoint2(landmarks[HIP_L]), toPoint2(landmarks[HIP_R])).y;
}

export function ankleMidpoint(landmarks: Landmark3D[]) {
  return midpoint(toPoint2(landmarks[ANKLE_L]), toPoint2(landmarks[ANKLE_R]));
}

export function squatScale(landmarks: Landmark3D[]): number {
  const hipMid = midpoint(toPoint2(landmarks[HIP_L]), toPoint2(landmarks[HIP_R]));
  const shoMid = midpoint(
    toPoint2(landmarks[SHOULDER_L]),
    toPoint2(landmarks[SHOULDER_R])
  );
  const scale = distance2D(hipMid, shoMid);
  return scale > 0 ? scale : 1e-6;
}

function jointConfidence(landmarks: Landmark3D[], indices: number[]): number {
  let sum = 0;
  let n = 0;
  for (const i of indices) {
    const l = landmarks[i];
    if (!l) return 0;
    sum += typeof l.visibility === "number" ? l.visibility : 0;
    n++;
  }
  return n > 0 ? sum / n : 0;
}

const CORE_JOINTS = [
  HIP_L,
  HIP_R,
  KNEE_L,
  KNEE_R,
  ANKLE_L,
  ANKLE_R,
  SHOULDER_L,
  SHOULDER_R,
];

export function squatCoreVisible(landmarks: Landmark3D[]): boolean {
  return jointVisible(landmarks, CORE_JOINTS, JOINT_VISIBILITY_MIN);
}

/**
 * Depth metric: based on the minimum knee angle and the hip drop (both
 * normalized). Deep, controlled squats score higher.
 */
export function depthMetric(
  minKneeAngle: number,
  hipDropFraction: number,
  timestamp: number,
  confidence = 1
): FormMetric {
  const { bottomKneeMax, depthHipDropMin } = SQUAT_CONFIG;
  // Angle component: 105° (bottom) -> 165° (no depth) maps to 100 -> 0.
  const angleScore = Math.max(
    0,
    Math.min(1, (165 - minKneeAngle) / (165 - bottomKneeMax))
  );
  // Hip drop component: reaching depthHipDropMin (0.5) = full credit.
  const dropScore = Math.max(0, Math.min(1, hipDropFraction / depthHipDropMin));
  const score = (0.6 * angleScore + 0.4 * dropScore) * 100;
  return makeMetric(score, true, confidence, timestamp);
}

/**
 * Knee alignment: knees should track over toes (limited lateral drift) and
 * both sides should be symmetric.
 */
export function kneeAlignmentMetric(
  landmarks: Landmark3D[],
  timestamp: number
): FormMetric {
  const joints = [KNEE_L, KNEE_R, ANKLE_L, ANKLE_R];
  const conf = jointConfidence(landmarks, joints);
  if (!jointVisible(landmarks, joints, JOINT_VISIBILITY_MIN)) {
    return makeMetric(0, false, conf, timestamp);
  }
  const footSpan = Math.abs(
    toPoint2(landmarks[ANKLE_L]).x - toPoint2(landmarks[ANKLE_R]).x
  ) || 1e-6;

  const driftL = Math.abs(
    toPoint2(landmarks[KNEE_L]).x - toPoint2(landmarks[ANKLE_L]).x
  );
  const driftR = Math.abs(
    toPoint2(landmarks[KNEE_R]).x - toPoint2(landmarks[ANKLE_R]).x
  );
  const tol = SQUAT_CONFIG.kneeOverToeTolerance * footSpan;
  const driftScore = Math.max(
    0,
    Math.min(1, 1 - (driftL + driftR) / (2 * tol))
  );

  const kneeSpan = Math.abs(
    toPoint2(landmarks[KNEE_L]).x - toPoint2(landmarks[KNEE_R]).x
  );
  const symmetryScore = Math.max(
    0,
    Math.min(1, 1 - Math.abs(kneeSpan - footSpan) / (footSpan * 0.8))
  );

  const score = (0.7 * driftScore + 0.3 * symmetryScore) * 100;
  return makeMetric(score, true, conf, timestamp);
}

/**
 * Torso angle: the torso should stay fairly upright through the rep.
 */
export function torsoAngleMetric(
  landmarks: Landmark3D[],
  timestamp: number
): FormMetric {
  const joints = [SHOULDER_L, SHOULDER_R, HIP_L, HIP_R];
  const conf = jointConfidence(landmarks, joints);
  if (!jointVisible(landmarks, joints, JOINT_VISIBILITY_MIN)) {
    return makeMetric(0, false, conf, timestamp);
  }
  const shoMid = midpoint(
    toPoint2(landmarks[SHOULDER_L]),
    toPoint2(landmarks[SHOULDER_R])
  );
  const hipMid = midpoint(toPoint2(landmarks[HIP_L]), toPoint2(landmarks[HIP_R]));
  const lean = angleFromVertical(shoMid, hipMid);
  const { torsoLeanMax } = SQUAT_CONFIG;
  const score = Math.max(0, Math.min(1, 1 - lean / torsoLeanMax)) * 100;
  return makeMetric(score, true, conf, timestamp);
}

/**
 * Ascent control: a controlled ascent (not too fast) scores higher.
 */
export function ascentControlMetric(
  ascentMs: number,
  timestamp: number,
  confidence = 1
): FormMetric {
  const { idealAscentMs, ascentTooFastMs } = SQUAT_CONFIG;
  if (ascentMs <= ascentTooFastMs) {
    return makeMetric(0, true, confidence, timestamp);
  }
  const ratio = Math.min(ascentMs, idealAscentMs) / idealAscentMs;
  return makeMetric(ratio * 100, true, confidence, timestamp);
}

export interface SquatFormMetrics {
  depth: FormMetric;
  kneeAlignment: FormMetric;
  torsoAngle: FormMetric;
  ascentControl: FormMetric;
}

/** Weighted squat form score over the supplied metrics. */
export function squatFormScore(metrics: SquatFormMetrics): FormMetric {
  const { weights } = SQUAT_CONFIG;
  const entries = [
    { metric: metrics.depth, weight: weights.depth },
    { metric: metrics.kneeAlignment, weight: weights.kneeAlignment },
    { metric: metrics.torsoAngle, weight: weights.torsoAngle },
    { metric: metrics.ascentControl, weight: weights.ascentControl },
  ];
  let wSum = 0;
  let acc = 0;
  let conf = 0;
  let ts = 0;
  let anyValid = false;
  for (const e of entries) {
    if (e.metric.valid) {
      anyValid = true;
      wSum += e.weight;
      acc += e.weight * e.metric.value;
      conf += e.metric.confidence * e.weight;
      ts = Math.max(ts, e.metric.timestamp);
    }
  }
  if (!anyValid) return makeMetric(0, false, 0, ts);
  return makeMetric(acc / wSum, true, conf / wSum, ts);
}
