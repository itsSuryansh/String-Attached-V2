// Single source of truth for sport-mode thresholds and weights.
// Magic numbers should not be scattered through the codebase.

export const JOINT_VISIBILITY_MIN = 0.5;

export interface MetricWeight {
  weight: number;
}

export const BASKETBALL_CONFIG = {
  // Set position: shooting wrist must be between these fractions of the
  // shoulder->eye vertical span to start stance capture.
  wristSetMin: 0.35,
  wristSetMax: 1.1,
  // Wrist must rise this far above the shoulder (as a fraction of torso
  // length) to count as an upward shooting motion.
  extensionLiftMin: 0.25,
  // Wrist apex must reach this far above the shoulder for full credit.
  apexFull: 0.9,
  // Elbow extension at release: below this angle the shot is "pushed".
  releaseElbowMin: 150,
  // Knee flexion sweet spot (degrees). Slightly bent, not locked, not deep.
  kneeIdeal: 130,
  kneeTolerance: 45,
  // Stance capture window.
  stanceCaptureMs: 400,
  motionApexWaitMs: 250,
  // Metric weights (must sum to 1 when all valid).
  weights: {
    stanceStability: 0.2,
    kneeFlexion: 0.2,
    elbowAlignment: 0.25,
    armExtension: 0.2,
    upwardMotion: 0.15,
  },
  // Outcome improvement target for the coaching loop (form-score points).
  improvementTarget: 10,
} as const;

export const SQUAT_CONFIG = {
  // Knee angle (hip-knee-ankle) thresholds for the rep cycle.
  standingKneeMin: 165, // above this = standing
  descendKneeMax: 145, // below this = descending
  bottomKneeMax: 105, // below this = bottom (depth reached)
  // Hip-vertical-drop fraction of torso length required to count as a rep.
  depthHipDropMin: 0.5,
  // Torso lean (from vertical) that is considered excessive.
  torsoLeanMax: 35,
  // Knee-over-toes lateral tolerance (fraction of foot span).
  kneeOverToeTolerance: 0.25,
  // Ascent control: ideal ascent duration (ms) for a controlled rep.
  idealAscentMs: 900,
  ascentTooFastMs: 300,
  // Metric weights.
  weights: {
    depth: 0.35,
    kneeAlignment: 0.25,
    torsoAngle: 0.2,
    ascentControl: 0.2,
  },
  // Outcome improvement target for the coaching loop (form-score points).
  improvementTarget: 10,
} as const;

export const BASKETBALL_PRIORITY = "basketball_form";
export const SQUAT_PRIORITY = "squat_form";
