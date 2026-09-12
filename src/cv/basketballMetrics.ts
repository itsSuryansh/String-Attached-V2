// Deterministic basketball shooting-form metrics.
//
// All metrics are computed locally from body-pose landmarks. Nothing here
// claims to measure ball trajectory or hoop success — only the visible motor
// behavior that the camera can actually observe.

import type { Landmark3D } from "@/types";
import { BASKETBALL_CONFIG, JOINT_VISIBILITY_MIN } from "./sportConfig";
import {
  angleAt,
  clamp01,
  distance2D,
  jointVisible,
  toPoint2,
} from "./angles";
import { makeMetric, type FormMetric } from "./metrics";

// MediaPipe pose landmark indices (0-based).
const SHOULDER_R = 12;
const ELBOW_R = 14;
const WRIST_R = 16;
const HIP_R = 24;
const KNEE_R = 26;
const ANKLE_R = 28;

const SHOULDER_L = 11;
const ELBOW_L = 13;
const WRIST_L = 15;
const HIP_L = 23;
const KNEE_L = 25;
const ANKLE_L = 27;

export type ShootingSide = "left" | "right";

const sideIndex = {
  left: {
    shoulder: SHOULDER_L,
    elbow: ELBOW_L,
    wrist: WRIST_L,
    hip: HIP_L,
    knee: KNEE_L,
    ankle: ANKLE_L,
  },
  right: {
    shoulder: SHOULDER_R,
    elbow: ELBOW_R,
    wrist: WRIST_R,
    hip: HIP_R,
    knee: KNEE_R,
    ankle: ANKLE_R,
  },
};

export function pickShootingSide(landmarks: Landmark3D[]): ShootingSide | null {
  const lw = landmarks[WRIST_L];
  const rw = landmarks[WRIST_R];
  const ls = landmarks[SHOULDER_L];
  const rs = landmarks[SHOULDER_R];
  if (!lw || !rw || !ls || !rs) return null;
  const lLift = ls.y - lw.y;
  const rLift = rs.y - rw.y;
  if (lLift <= 0 && rLift <= 0) return null;
  return lLift >= rLift ? "left" : "right";
}

export function shootingWristAboveShoulder(
  landmarks: Landmark3D[],
  side: ShootingSide
): number {
  const idx = sideIndex[side];
  return landmarks[idx.shoulder].y - landmarks[idx.wrist].y;
}

export interface BasketballStance {
  kneeFlexion: FormMetric;
  stanceStability: FormMetric;
  valid: boolean;
}

/**
 * Knee flexion at the shooting stance: the knee should be slightly bent.
 * Score peaks at the ideal angle and falls off for locked or over-bent knees.
 */
export function kneeFlexionMetric(
  landmarks: Landmark3D[],
  side: ShootingSide,
  timestamp: number
): FormMetric {
  const idx = sideIndex[side];
  const joints = [idx.hip, idx.knee, idx.ankle];
  const conf = jointConfidence(landmarks, joints);
  if (!jointVisible(landmarks, joints, JOINT_VISIBILITY_MIN)) {
    return makeMetric(0, false, conf, timestamp);
  }
  const angle = angleAt(
    toPoint2(landmarks[idx.hip]),
    toPoint2(landmarks[idx.knee]),
    toPoint2(landmarks[idx.ankle])
  );
  const { kneeIdeal, kneeTolerance } = BASKETBALL_CONFIG;
  const score = clamp01(1 - Math.abs(angle - kneeIdeal) / kneeTolerance) * 100;
  return makeMetric(score, true, conf, timestamp);
}

/**
 * Elbow alignment at the set point: elbow angle near 90° and the wrist
 * stacked over the elbow (minimal lateral drift).
 */
export function elbowAlignmentMetric(
  landmarks: Landmark3D[],
  side: ShootingSide,
  timestamp: number
): FormMetric {
  const idx = sideIndex[side];
  const joints = [idx.shoulder, idx.elbow, idx.wrist];
  const conf = jointConfidence(landmarks, joints);
  if (!jointVisible(landmarks, joints, JOINT_VISIBILITY_MIN)) {
    return makeMetric(0, false, conf, timestamp);
  }
  const angle = angleAt(
    toPoint2(landmarks[idx.shoulder]),
    toPoint2(landmarks[idx.elbow]),
    toPoint2(landmarks[idx.wrist])
  );
  // Peak at ~90°.
  const angleScore = clamp01(1 - Math.abs(angle - 90) / 50) * 100;

  const wrist = toPoint2(landmarks[idx.wrist]);
  const elbow = toPoint2(landmarks[idx.elbow]);
  const lateral = Math.abs(wrist.x - elbow.x);
  // Normalize lateral drift by upper-arm length so camera distance is removed.
  const upperArm = distance2D(
    toPoint2(landmarks[idx.shoulder]),
    elbow
  );
  const lateralScore = clamp01(1 - lateral / Math.max(upperArm, 1e-6) / 0.6) * 100;

  const score = 0.6 * angleScore + 0.4 * lateralScore;
  return makeMetric(score, true, conf, timestamp);
}

/**
 * Arm extension at release: elbow should approach full extension (180°).
 */
export function armExtensionMetric(
  landmarks: Landmark3D[],
  side: ShootingSide,
  timestamp: number
): FormMetric {
  const idx = sideIndex[side];
  const joints = [idx.shoulder, idx.elbow, idx.wrist];
  const conf = jointConfidence(landmarks, joints);
  if (!jointVisible(landmarks, joints, JOINT_VISIBILITY_MIN)) {
    return makeMetric(0, false, conf, timestamp);
  }
  const angle = angleAt(
    toPoint2(landmarks[idx.shoulder]),
    toPoint2(landmarks[idx.elbow]),
    toPoint2(landmarks[idx.wrist])
  );
  // Score rises from 130° to 180°.
  const score = clamp01((angle - 130) / 50) * 100;
  return makeMetric(score, true, conf, timestamp);
}

/**
 * Upward motion: how far above the shoulder the wrist apex reached,
 * normalized by torso length.
 */
export function upwardMotionMetric(
  apexLift: number,
  scale: number,
  timestamp: number,
  confidence = 1
): FormMetric {
  if (scale <= 0) return makeMetric(0, false, confidence, timestamp);
  const { apexFull } = BASKETBALL_CONFIG;
  const score = clamp01(apexLift / (scale * apexFull)) * 100;
  return makeMetric(score, true, confidence, timestamp);
}

/** Torso length used to normalize distance-dependent measurements. */
export function basketballScale(landmarks: Landmark3D[]): number {
  const hipMid = midpoint(
    toPoint2(landmarks[HIP_L]),
    toPoint2(landmarks[HIP_R])
  );
  const shoMid = midpoint(
    toPoint2(landmarks[SHOULDER_L]),
    toPoint2(landmarks[SHOULDER_R])
  );
  const scale = distance2D(hipMid, shoMid);
  return scale > 0 ? scale : 1e-6;
}

export function hipMidpoint(landmarks: Landmark3D[]) {
  return midpoint(toPoint2(landmarks[HIP_L]), toPoint2(landmarks[HIP_R]));
}

function midpoint(
  a: { x: number; y: number },
  b: { x: number; y: number }
): { x: number; y: number } {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
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

/** Weighted basketball form score over the supplied metrics. */
export function basketballFormScore(metrics: {
  stanceStability: FormMetric;
  kneeFlexion: FormMetric;
  elbowAlignment: FormMetric;
  armExtension: FormMetric;
  upwardMotion: FormMetric;
}): FormMetric {
  const { weights } = BASKETBALL_CONFIG;
  const entries = [
    { metric: metrics.stanceStability, weight: weights.stanceStability },
    { metric: metrics.kneeFlexion, weight: weights.kneeFlexion },
    { metric: metrics.elbowAlignment, weight: weights.elbowAlignment },
    { metric: metrics.armExtension, weight: weights.armExtension },
    { metric: metrics.upwardMotion, weight: weights.upwardMotion },
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
