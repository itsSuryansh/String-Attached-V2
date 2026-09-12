// Squat form engine — deterministic measurement + state machine.
//
//   idle -> calibrating -> READY -> DESCENDING -> BOTTOM -> ASCENDING
//        -> COMPLETED -> COACHING -> RETRY -> (new rep)
//
// A squat requires an actual standing -> descending -> bottom -> ascending ->
// standing cycle. Static poses and incomplete movements never count.

import type { Landmark3D, Metric, ModeEvent, ModeSnapshot } from "@/types";
import { SQUAT_CONFIG } from "@/cv/sportConfig";
import {
  ascentControlMetric,
  ankleMidpoint,
  depthMetric,
  hipHeight,
  kneeAlignmentMetric,
  meanKneeAngle,
  squatCoreVisible,
  squatScale,
  torsoAngleMetric,
} from "@/cv/squatMetrics";
import { positionStability, ScalarTracker } from "@/cv/movement";
import { makeMetric, type FormMetric } from "@/cv/metrics";

export interface SquatFrame {
  timestampMs: number;
  landmarks: Landmark3D[];
  trackingValid: boolean;
}

const DROPOUT_MAX_MS = 300;
const CYCLE_TIMEOUT_MS = 6000;

type Phase =
  | "idle"
  | "calibrating"
  | "READY"
  | "DESCENDING"
  | "BOTTOM"
  | "ASCENDING"
  | "COMPLETED"
  | "COACHING"
  | "RETRY";

export class SquatEngine {
  private phase: Phase = "idle";
  private trackingValid = false;
  private prevFrameTime = -1;

  private standingHipY = 0;
  private minKneeAngle = 180;
  private lastKneeAngle = 180;
  private minHipY = 0;
  private bottomTorso: FormMetric | null = null;
  private bottomAlignment: FormMetric | null = null;
  private bottomStabilitySamples: Array<{ x: number; y: number }> = [];
  private kneeTracker = new ScalarTracker(400, 30);
  private cycleStartMs = 0;
  private ascentMs = 0;
  private dropoutMs = 0;

  private lastScore: number | null = null;
  private lastMetrics: FormMetric[] = [];
  private retryPending = false;
  private retryBaseline: number | null = null;

  private attemptCounter = 0;
  private listeners: Array<(e: ModeEvent) => void> = [];

  onEvent(cb: (e: ModeEvent) => void): () => void {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb);
    };
  }

  private emit(e: ModeEvent) {
    for (const l of this.listeners) l(e);
  }

  private makeAttemptId(): string {
    this.attemptCounter += 1;
    return `sq-${Date.now()}-${this.attemptCounter}`;
  }

  start() {
    if (this.phase === "idle") this.phase = "calibrating";
  }

  acknowledgeCoaching() {
    if (this.phase === "COACHING") this.phase = "RETRY";
  }

  reset() {
    this.phase = "idle";
    this.trackingValid = false;
    this.prevFrameTime = -1;
    this.standingHipY = 0;
    this.minKneeAngle = 180;
    this.minHipY = 0;
    this.bottomTorso = null;
    this.bottomAlignment = null;
    this.bottomStabilitySamples = [];
    this.kneeTracker.clear();
    this.cycleStartMs = 0;
    this.ascentMs = 0;
    this.dropoutMs = 0;
    this.lastScore = null;
    this.lastMetrics = [];
    this.retryPending = false;
    this.retryBaseline = null;
  }

  process(frame: SquatFrame) {
    const t = frame.timestampMs;
    const dt = this.prevFrameTime < 0 ? 0 : Math.max(0, t - this.prevFrameTime);
    this.prevFrameTime = t;
    this.trackingValid = frame.trackingValid;

    if (this.phase === "idle") return;

    const visible = frame.trackingValid && squatCoreVisible(frame.landmarks);
    if (!visible || frame.landmarks.length < 33) {
      this.dropoutMs += dt;
      if (
        (this.phase === "DESCENDING" ||
          this.phase === "BOTTOM" ||
          this.phase === "ASCENDING") &&
        this.dropoutMs > DROPOUT_MAX_MS
      ) {
        this.abortAttempt();
      }
      return;
    }
    this.dropoutMs = 0;

    if (this.phase === "calibrating") {
      this.phase = "READY";
    }

    const kneeAngle = meanKneeAngle(frame.landmarks);
    const hipY = hipHeight(frame.landmarks);
    const scale = squatScale(frame.landmarks);
    this.kneeTracker.push(t, kneeAngle);
    this.lastKneeAngle = kneeAngle;

    switch (this.phase) {
      case "READY":
      case "RETRY": {
        if (kneeAngle >= SQUAT_CONFIG.standingKneeMin) {
          this.standingHipY = hipY;
        }
        if (kneeAngle <= SQUAT_CONFIG.descendKneeMax) {
          this.phase = "DESCENDING";
          this.minKneeAngle = kneeAngle;
          this.minHipY = hipY;
          this.cycleStartMs = t;
          this.dropoutMs = 0;
        }
        break;
      }

      case "DESCENDING": {
        if (kneeAngle < this.minKneeAngle) {
          this.minKneeAngle = kneeAngle;
        }
        if (hipY > this.minHipY) {
          this.minHipY = hipY;
        }
        if (t - this.cycleStartMs > CYCLE_TIMEOUT_MS) {
          this.abortAttempt();
          return;
        }
        const velocity = this.kneeTracker.velocityPerSec() ?? 0;
        // Bottom reached when the knee angle stops decreasing.
        if (velocity >= 0 && kneeAngle <= SQUAT_CONFIG.descendKneeMax) {
          this.enterBottom(frame.landmarks, t);
        }
        break;
      }

      case "BOTTOM": {
        if (kneeAngle < this.minKneeAngle) {
          this.minKneeAngle = kneeAngle;
          this.minHipY = Math.max(this.minHipY, hipY);
        }
        this.bottomStabilitySamples.push(ankleMidpoint(frame.landmarks));
        if (t - this.cycleStartMs > CYCLE_TIMEOUT_MS) {
          this.abortAttempt();
          return;
        }
        if (kneeAngle > SQUAT_CONFIG.bottomKneeMax) {
          this.phase = "ASCENDING";
          this.ascentMs = 0;
        }
        break;
      }

      case "ASCENDING": {
        this.ascentMs += dt;
        if (t - this.cycleStartMs > CYCLE_TIMEOUT_MS) {
          this.abortAttempt();
          return;
        }
        if (kneeAngle >= SQUAT_CONFIG.standingKneeMin) {
          this.finalizeRep(scale, t);
        }
        break;
      }

      default:
        break;
    }
  }

  private enterBottom(landmarks: Landmark3D[], t: number) {
    this.phase = "BOTTOM";
    this.bottomTorso = torsoAngleMetric(landmarks, t);
    this.bottomAlignment = kneeAlignmentMetric(landmarks, t);
    this.bottomStabilitySamples = [ankleMidpoint(landmarks)];
  }

  private finalizeRep(scale: number, t: number) {
    const hipDropFraction =
      scale > 0 ? (this.minHipY - this.standingHipY) / scale : 0;

    // Real motion guard: must have descended meaningfully.
    const minMotionDrop = SQUAT_CONFIG.depthHipDropMin * 0.35;
    const movedEnough = hipDropFraction >= minMotionDrop;

    if (!movedEnough) {
      // Static pose or micro-motion — not a squat.
      this.abortAttempt();
      return;
    }

    const depth = depthMetric(this.minKneeAngle, hipDropFraction, t, 1);
    const alignment = this.bottomAlignment ?? makeMetric(0, false, 0, t);
    const torso = this.bottomTorso ?? makeMetric(0, false, 0, t);
    const ascent = ascentControlMetric(this.ascentMs, t, 1);
    const stability = positionStability(this.bottomStabilitySamples, scale);
    const stabilityMetric = makeMetric(
      stability,
      this.bottomStabilitySamples.length >= 2,
      1,
      t
    );

    const formScore = squatFormScoreWrapped({
      depth,
      kneeAlignment: alignment,
      torsoAngle: torso,
      ascentControl: ascent,
    });

    this.lastScore = formScore.value;
    this.lastMetrics = [depth, alignment, torso, ascent, stabilityMetric];
    this.phase = "COMPLETED";

    this.emit({
      type: "attempt-complete",
      mode: "squats",
      score: Math.round(formScore.value),
    });

    const baseline = formScore.value;
    const attemptId = this.makeAttemptId();

    if (this.retryPending) {
      this.retryPending = false;
      this.emit({
        type: "retry-complete",
        mode: "squats",
        priority: "squat_form",
        state: "COMPLETED",
        baseline: this.retryBaseline ?? formScore.value,
        after: formScore.value,
        measurable: true,
        attemptId,
      });
    }

    this.retryBaseline = formScore.value;
    this.retryPending = true;
    this.emit({
      type: "coaching",
      mode: "squats",
      priority: "squat_form",
      state: "COMPLETED",
      reason: "squat rep completed",
      baseline,
      attemptId,
      metrics: this.formMetricsList(),
    });

    this.phase = "COACHING";
  }

  private abortAttempt() {
    this.phase = "READY";
    this.minKneeAngle = 180;
    this.minHipY = 0;
    this.bottomTorso = null;
    this.bottomAlignment = null;
    this.bottomStabilitySamples = [];
    this.kneeTracker.clear();
    this.dropoutMs = 0;
  }

  private formMetricsList(): Metric[] {
    const labels = [
      "Depth",
      "Knee alignment",
      "Torso angle",
      "Ascent control",
      "Bottom stability",
    ];
    return this.lastMetrics.map((m, i) => ({
      key: labels[i].toLowerCase().replace(/ /g, "_"),
      label: labels[i],
      value: Math.round(m.value),
      valid: m.valid,
      confidence: m.confidence,
      timestamp: m.timestamp,
    }));
  }

  getSnapshot(): ModeSnapshot {
    const metrics = this.formMetricsList();
    const kneeAngle = Math.round(this.lastKneeAngle);
    return {
      mode: "squats",
      phase: this.phase,
      formMatch: this.lastScore === null ? 0 : Math.round(this.lastScore),
      formMatchValid: this.lastScore !== null,
      stateHint: this.stateHint(),
      trackingValid: this.trackingValid,
      poseValid: this.trackingValid,
      metrics,
      extras: {
        kneeAngle,
        lastScore: this.lastScore === null ? null : Math.round(this.lastScore),
      },
    };
  }

  private stateHint(): string {
    switch (this.phase) {
      case "idle":
        return "Waiting to start";
      case "calibrating":
        return "Stand in frame, facing the camera";
      case "READY":
        return "Stand tall — then squat down";
      case "RETRY":
        return "Ready for your next rep";
      case "DESCENDING":
        return "Lowering…";
      case "BOTTOM":
        return "At the bottom — drive up";
      case "ASCENDING":
        return "Rising…";
      case "COMPLETED":
        return "Rep complete";
      case "COACHING":
        return "Coach is reviewing…";
      default:
        return "";
    }
  }
}

function squatFormScoreWrapped(metrics: {
  depth: FormMetric;
  kneeAlignment: FormMetric;
  torsoAngle: FormMetric;
  ascentControl: FormMetric;
}): FormMetric {
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
