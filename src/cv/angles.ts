// Joint-angle geometry for body-pose modes (basketball, squats).
// Angles are computed in 2D (x, y) from normalized, roughly-metric landmarks.

import type { Landmark3D } from "@/types";

export interface Point2 {
  x: number;
  y: number;
}

export function toPoint2(l: Landmark3D): Point2 {
  return { x: l.x, y: l.y };
}

export function distance2D(a: Point2, b: Point2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Signed angle in degrees at vertex `v` formed by a—v—b. Range 0..180. */
export function angleAt(a: Point2, v: Point2, b: Point2): number {
  const v1x = a.x - v.x;
  const v1y = a.y - v.y;
  const v2x = b.x - v.x;
  const v2y = b.y - v.y;
  const dot = v1x * v2x + v1y * v2y;
  const mag1 = Math.sqrt(v1x * v1x + v1y * v1y);
  const mag2 = Math.sqrt(v2x * v2x + v2y * v2y);
  if (mag1 < 1e-6 || mag2 < 1e-6) return 0;
  const cos = Math.max(-1, Math.min(1, dot / (mag1 * mag2)));
  return (Math.acos(cos) * 180) / Math.PI;
}

/**
 * Angle of the segment b->a relative to the vertical (pointing "up" is 0°).
 * Returns degrees in [0, 180]; the torso standing upright is near 0.
 */
export function angleFromVertical(a: Point2, b: Point2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1e-6) return 0;
  // Dot with up vector (0, -1) in screen coords (y grows downward).
  const cos = Math.max(-1, Math.min(1, (-dy) / len));
  return (Math.acos(cos) * 180) / Math.PI;
}

export const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
export const clamp = (x: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, x));

/**
 * Visibility filter: a joint group is only usable when the weakest relevant
 * landmark meets `minVisibility`. MediaPipe reports 0..1 visibility.
 */
export function jointVisible(
  landmarks: Landmark3D[],
  indices: number[],
  minVisibility = 0.5
): boolean {
  for (const i of indices) {
    const l = landmarks[i];
    if (!l) return false;
    if (typeof l.visibility === "number" && l.visibility < minVisibility) {
      return false;
    }
  }
  return true;
}

/** Max hip-to-shoulder distance (or torso length) used for normalization. */
export function torsoScale(landmarks: Landmark3D[]): number {
  return distance2D(toPoint2(landmarks[24]), toPoint2(landmarks[12]));
}

/** Z-value (depth) contrast between left and right shoulders — symmetry cue. */
export function shoulderDepthDelta(landmarks: Landmark3D[]): number {
  return landmarks[12].z - landmarks[11].z;
}
