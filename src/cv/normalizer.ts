// Ukulele hand normalization — the deterministic core of StringsAttached.
//
// Uses 21 MediaPipe 3D hand landmarks.
//   P0 = wrist (landmark 0)
//   P5 = index MCP (landmark 5)
//   P9 = middle MCP (landmark 9)
//
// The formulas in this file are part of the measurement contract and MUST NOT
// be changed (see the build specification §11).

import type { Landmark3D, NormalizedLandmark } from "@/types";

export const HAND_LANDMARK_COUNT = 21;
export const P0 = 0; // wrist
export const P5 = 5; // index MCP
export const P9 = 9; // middle MCP

const EPS = 1e-6;
const COLLINEAR_EPS = 1e-4;

export interface NormalizationResult {
  ok: boolean;
  /** Reason when `ok === false` (e.g. "uncalibrated"). */
  reason?: "collinear" | "short_input";
  landmarks: NormalizedLandmark[];
  scale: number;
  /** Mean landmark visibility across the 21 landmarks (0..1). */
  meanVisibility: number;
}

function landmarkDistance(a: Landmark3D, b: Landmark3D): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function vecLength(v: { x: number; y: number; z: number }): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

function cross(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number }
): { x: number; y: number; z: number } {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

/** Maximum pairwise 3D distance among the supplied landmarks. */
export function maxPairwiseDistance(pts: Landmark3D[]): number {
  let max = 0;
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const d = landmarkDistance(pts[i], pts[j]);
      if (d > max) max = d;
    }
  }
  return max;
}

/**
 * Normalize a full 21-landmark hand into the canonical StringsAttached space.
 *
 *   Q_i  = P_i - P0
 *   s    = max pairwise 3D distance (s_safe = max(s, 1e-6))
 *   Q'_i = Q_i / s_safe
 *   u    = Q'_9 / ||Q'_9||
 *   p    = Q'_5
 *   w_raw= u x p
 *   if ||w_raw|| < 1e-4  -> frame is UNCALIBRATED (rotation bypassed)
 *   w    = w_raw / ||w_raw||
 *   v    = w x u
 *   R    = [u; v; w] (row-major)
 *   P''_i= R Q'_i
 */
export function normalizeHandLandmarks(
  landmarks: Landmark3D[]
): NormalizationResult {
  if (!landmarks || landmarks.length < HAND_LANDMARK_COUNT) {
    return {
      ok: false,
      reason: "short_input",
      landmarks: [],
      scale: 0,
      meanVisibility: 0,
    };
  }

  const pts = landmarks.slice(0, HAND_LANDMARK_COUNT);

  let visSum = 0;
  let visCount = 0;
  for (const p of pts) {
    if (typeof p.visibility === "number") {
      visSum += p.visibility;
      visCount++;
    }
  }
  const meanVisibility = visCount > 0 ? visSum / visCount : 1;

  const p0 = pts[P0];

  // Translation.
  const q = pts.map((p) => ({
    x: p.x - p0.x,
    y: p.y - p0.y,
    z: p.z - p0.z,
  }));

  // Scale.
  const s = maxPairwiseDistance(pts);
  const sSafe = Math.max(s, EPS);
  const qn = q.map((v) => ({
    x: v.x / sSafe,
    y: v.y / sSafe,
    z: v.z / sSafe,
  }));

  // Rotation basis.
  const u = qn[P9];
  const uLen = vecLength(u);
  if (uLen < EPS) {
    return { ok: false, reason: "collinear", landmarks: [], scale: sSafe, meanVisibility };
  }
  const uNorm = { x: u.x / uLen, y: u.y / uLen, z: u.z / uLen };

  const p = qn[P5];
  const wRaw = cross(uNorm, p);
  const wLen = vecLength(wRaw);

  if (wLen < COLLINEAR_EPS) {
    // UNCALIBRATED frame — bypass rotation entirely, do not use as measurement.
    return {
      ok: false,
      reason: "collinear",
      landmarks: [],
      scale: sSafe,
      meanVisibility,
    };
  }

  const w = { x: wRaw.x / wLen, y: wRaw.y / wLen, z: wRaw.z / wLen };
  const v = cross(w, uNorm);

  // Row-major rotation applied as R * Q'_i.
  const result: NormalizedLandmark[] = qn.map((qi) => ({
    x: uNorm.x * qi.x + uNorm.y * qi.y + uNorm.z * qi.z,
    y: v.x * qi.x + v.y * qi.y + v.z * qi.z,
    z: w.x * qi.x + w.y * qi.y + w.z * qi.z,
  }));

  return { ok: true, landmarks: result, scale: sSafe, meanVisibility };
}

/** Mean 3D distance between two normalized landmark sets. */
export function meanLandmarkDistance(
  a: NormalizedLandmark[],
  b: NormalizedLandmark[]
): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return Infinity;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const dx = a[i].x - b[i].x;
    const dy = a[i].y - b[i].y;
    const dz = a[i].z - b[i].z;
    sum += Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
  return sum / n;
}

/**
 * Pose score: S_pose = 100 * clamp(1 - D / 0.80, 0, 1) where D is the mean
 * 3D landmark distance to a canonical template. Range 0..100.
 */
export function poseScore(
  landmarks: NormalizedLandmark[],
  template: NormalizedLandmark[]
): number {
  const d = meanLandmarkDistance(landmarks, template);
  const clamped = Math.max(0, Math.min(1, 1 - d / 0.8));
  return 100 * clamped;
}
