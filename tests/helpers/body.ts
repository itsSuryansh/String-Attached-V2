// Test helpers: synthetic 33-landmark body skeletons.

import type { Landmark3D } from "../../src/types";

/** A full standing skeleton in normalized image coordinates (y grows down). */
export function standingBody(): Landmark3D[] {
  const pts = defaultSkeleton();
  return pts.map(([x, y, z], i) => ({ x, y, z, visibility: i < 33 ? 1 : 0 }));
}

type Pose = Array<[number, number, number, number]>;

function defaultSkeleton(): Array<[number, number, number]> {
  // Index: [x, y, z]
  const s: Array<[number, number, number]> = new Array(33).fill([0.5, 0.5, 0]);
  s[0] = [0.5, 0.08, 0]; // nose
  s[11] = [0.42, 0.32, 0]; // L shoulder
  s[12] = [0.58, 0.32, 0]; // R shoulder
  s[13] = [0.40, 0.5, 0]; // L elbow
  s[14] = [0.6, 0.5, 0]; // R elbow
  s[15] = [0.38, 0.68, 0]; // L wrist
  s[16] = [0.62, 0.68, 0]; // R wrist
  s[23] = [0.44, 0.6, 0]; // L hip
  s[24] = [0.56, 0.6, 0]; // R hip
  s[25] = [0.44, 0.76, 0]; // L knee
  s[26] = [0.56, 0.76, 0]; // R knee
  s[27] = [0.44, 0.92, 0]; // L ankle
  s[28] = [0.56, 0.92, 0]; // R ankle
  return s;
}

export function bodyWith(overrides: Pose): Landmark3D[] {
  const s = defaultSkeleton();
  for (const [i, x, y, z] of overrides) {
    s[i] = [x, y, z];
  }
  return s.map(([x, y, z]) => ({ x, y, z, visibility: 1 }));
}

/**
 * Right arm in a shooting set position: elbow out (upper arm horizontal),
 * forearm vertical, wrist near the chin. Elbow angle ≈ 90°.
 */
export function basketballSetPose(): Landmark3D[] {
  return bodyWith([
    [12, 0.56, 0.34, 0], // R shoulder
    [14, 0.68, 0.34, 0], // R elbow (out from body)
    [16, 0.68, 0.25, 0], // R wrist (above elbow, near chin)
  ]);
}

/** Right arm fully extended overhead (the shot). */
export function basketballShotPose(): Landmark3D[] {
  return bodyWith([
    [12, 0.56, 0.34, 0], // R shoulder
    [14, 0.57, 0.1, 0], // R elbow (up)
    [16, 0.58, 0.02, 0], // R wrist (overhead)
  ]);
}

/** Knees bent to roughly a quarter squat (~135°). */
export function squatDescendPose(): Landmark3D[] {
  return bodyWith([
    [23, 0.44, 0.62, 0],
    [24, 0.56, 0.62, 0],
    [25, 0.38, 0.8, 0],
    [26, 0.62, 0.8, 0],
  ]);
}

/** Bottom of a squat (knees near 90°). */
export function squatBottomPose(): Landmark3D[] {
  return bodyWith([
    [23, 0.44, 0.72, 0],
    [24, 0.56, 0.72, 0],
    [25, 0.34, 0.84, 0],
    [26, 0.66, 0.84, 0],
  ]);
}
