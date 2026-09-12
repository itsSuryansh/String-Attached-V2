// Shared type definitions for StringsAttached.

export type Mode = "ukulele" | "basketball" | "squats";

export type TrackingStatus =
  | "uninitialized"
  | "loading"
  | "calibrating"
  | "tracking"
  | "lost"
  | "insufficient"
  | "unavailable";

export type Vec2 = { x: number; y: number };
export type Vec3 = { x: number; y: number; z: number };

/** A single 3D landmark (world-relative, roughly in meters for MediaPipe). */
export interface Landmark3D {
  x: number;
  y: number;
  z: number;
  visibility?: number;
}

/** Normalized landmark (centered at origin, unit scale). */
export interface NormalizedLandmark {
  x: number;
  y: number;
  z: number;
}

/** A named, deterministic, measurable metric with validity metadata. */
export interface Metric {
  key: string;
  label: string;
  value: number;
  valid: boolean;
  confidence: number;
  timestamp: number;
}

export type UkulelePhase =
  | "idle"
  | "calibrating"
  | "C_CHORD"
  | "C_STABLE"
  | "TRANSITIONING"
  | "AM_CANDIDATE"
  | "AM_STABLE"
  | "STRUM_DYNAMICS"
  | "LESSON_PASS";

export type BasketballPhase =
  | "idle"
  | "calibrating"
  | "READY"
  | "STANCE_CAPTURE"
  | "SHOOTING_MOTION"
  | "FORM_RESULT"
  | "COACHING"
  | "RETRY"
  | "OUTCOME";

export type SquatPhase =
  | "idle"
  | "calibrating"
  | "READY"
  | "DESCENDING"
  | "BOTTOM"
  | "ASCENDING"
  | "COMPLETED"
  | "COACHING"
  | "RETRY"
  | "OUTCOME";

export type Phase = UkulelePhase | BasketballPhase | SquatPhase;

/** Coaching priority keys. `none` is always allowed. */
export type CoachingPriority =
  | "hand_configuration"
  | "transition_speed"
  | "strum_form"
  | "basketball_form"
  | "squat_form"
  | "none";

/** Validated coaching decision produced by (or derived from) Gemini. */
export interface CoachingDecision {
  priority: CoachingPriority;
  correction: string;
  /** true when Gemini explicitly returned NO INTERVENTION. */
  noIntervention: boolean;
  /** Optional rationale, kept out of the compact HUD. */
  reason?: string;
  /** Source of the decision. */
  source: "gemini" | "deterministic-fallback" | "local";
  /** Wall-clock time the decision was produced. */
  timestamp: number;
}

export type Outcome = "IMPROVED" | "UNCHANGED" | "WORSE" | "NOT_MEASURABLE";

export interface InterventionRecord {
  id: string;
  mode: Mode;
  state: string;
  priority: CoachingPriority;
  correction: string;
  source: "gemini" | "deterministic-fallback";
  baseline: number | null;
  after: number | null;
  delta: number | null;
  outcome: Outcome | null;
  timestamp: number;
}

/** Snapshot of coaching state pushed to the UI HUD. */
export interface CoachingHUD {
  priority: CoachingPriority;
  correction: string;
  noIntervention: boolean;
  source: "gemini" | "deterministic-fallback" | "local";
  state: Phase;
  updatedAt: number;
}

/**
 * Unified event contract emitted by all three mode engines and consumed by
 * the coaching controller.
 */
export type ModeEvent =
  | {
      type: "coaching";
      mode: Mode;
      priority: CoachingPriority;
      state: string;
      reason: string;
      baseline: number;
      attemptId: string;
      metrics: Metric[];
    }
  | {
      type: "retry-complete";
      mode: Mode;
      priority: CoachingPriority;
      state: string;
      baseline: number;
      after: number;
      measurable: boolean;
      attemptId: string;
    }
  | { type: "strum"; mode: Mode; count: number }
  | { type: "lesson-pass"; mode: Mode }
  | { type: "attempt-complete"; mode: Mode; score: number }
  | { type: "transition-invalidated"; mode: Mode; reason: string }
  | { type: "transition-complete"; mode: Mode; deltaMs: number; score: number };

/** Unified snapshot contract rendered by the training screen. */
export interface ModeSnapshot {
  mode: Mode;
  phase: string;
  /** Headline local measurement (FORM MATCH for ukulele, form score otherwise). */
  formMatch: number;
  formMatchValid: boolean;
  stateHint: string;
  trackingValid: boolean;
  poseValid: boolean;
  metrics: Metric[];
  /** Mode-specific extras for the HUD/visualization. */
  extras: Record<string, number | string | boolean | null>;
}
