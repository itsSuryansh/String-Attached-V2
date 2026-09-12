// Basketball shooting-form engine — deterministic measurement + state machine.
//
//   idle -> calibrating -> READY -> STANCE_CAPTURE -> SHOOTING_MOTION
//        -> FORM_RESULT -> COACHING -> RETRY -> (new attempt)
//
// A static person is NEVER classified as a completed attempt: a shot requires
// an actual set position followed by upward extension and release.

import type { Landmark3D, Metric, ModeEvent, ModeSnapshot } from "@/types";
import { BASKETBALL_CONFIG } from "@/cv/sportConfig";
import {
  armExtensionMetric,
  basketballFormScore,
  basketballScale,
  elbowAlignmentMetric,
  hipMidpoint,
  kneeFlexionMetric,
  pickShootingSide,
  shootingWristAboveShoulder,
  upwardMotionMetric,
  type ShootingSide,
} from "@/cv/basketballMetrics";
import { positionStability, ScalarTracker } from "@/cv/movement";
import { makeMetric, type FormMetric } from "@/cv/metrics";

export interface BasketballFrame {
  timestampMs: number;
  landmarks: Landmark3D[];
  trackingValid: boolean;
}

const DROPOUT_MAX_MS = 300;
const MOTION_TIMEOUT_MS = 1600;

type Phase =
  | "idle"
  | "calibrating"
  | "READY"
  | "STANCE_CAPTURE"
  | "SHOOTING_MOTION"
  | "FORM_RESULT"
  | "COACHING"
  | "RETRY";

export class BasketballEngine {
  private phase: Phase = "idle";
  private trackingValid = false;
  private prevFrameTime = -1;

  private side: ShootingSide | null = null;
  private hipSamples: Array<{ x: number; y: number }> = [];
  private kneeSamples: number[] = [];
  private setElbow: FormMetric | null = null;
  private apexLift = 0;
  private apexElbow: FormMetric | null = null;
  private wristMotion = new ScalarTracker(400, 30);
  private motionStartMs = 0;
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
    return `bb-${Date.now()}-${this.attemptCounter}`;
  }

  start() {
    if (this.phase === "idle") this.phase = "calibrating";
  }

  /** Called by the controller once Gemini has produced the coaching decision. */
  acknowledgeCoaching() {
    if (this.phase === "COACHING") this.phase = "RETRY";
  }

  reset() {
    this.phase = "idle";
    this.trackingValid = false;
    this.prevFrameTime = -1;
    this.side = null;
    this.hipSamples = [];
    this.kneeSamples = [];
    this.setElbow = null;
    this.apexLift = 0;
    this.apexElbow = null;
    this.wristMotion.clear();
    this.motionStartMs = 0;
    this.dropoutMs = 0;
    this.lastScore = null;
    this.lastMetrics = [];
    this.retryPending = false;
    this.retryBaseline = null;
  }

  process(frame: BasketballFrame) {
    const t = frame.timestampMs;
    const dt = this.prevFrameTime < 0 ? 0 : Math.max(0, t - this.prevFrameTime);
    this.prevFrameTime = t;
    this.trackingValid = frame.trackingValid;

    if (this.phase === "idle") return;

    if (!frame.trackingValid || frame.landmarks.length < 33) {
      this.dropoutMs += dt;
      if (
        (this.phase === "STANCE_CAPTURE" || this.phase === "SHOOTING_MOTION") &&
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

    const scale = basketballScale(frame.landmarks);

    switch (this.phase) {
      case "READY":
      case "RETRY": {
        const side = pickShootingSide(frame.landmarks);
        const lift = side
          ? shootingWristAboveShoulder(frame.landmarks, side)
          : 0;
        if (side && lift > BASKETBALL_CONFIG.wristSetMin * scale) {
          if (lift > BASKETBALL_CONFIG.extensionLiftMin * scale) {
            // Skipped the set pause — start the shot motion directly.
            this.beginShotMotion(side, frame.landmarks, scale, t);
          } else {
            this.phase = "STANCE_CAPTURE";
            this.side = side;
            this.hipSamples = [hipMidpoint(frame.landmarks)];
            this.kneeSamples = [];
            this.setElbow = null;
            this.dropoutMs = 0;
          }
        }
        break;
      }

      case "STANCE_CAPTURE": {
        if (!this.side) {
          this.abortAttempt();
          return;
        }
        const lift = shootingWristAboveShoulder(frame.landmarks, this.side);
        this.hipSamples.push(hipMidpoint(frame.landmarks));
        this.kneeSamples.push(
          kneeFlexionMetric(frame.landmarks, this.side, t).value
        );
        this.setElbow = elbowAlignmentMetric(frame.landmarks, this.side, t);
        if (lift > BASKETBALL_CONFIG.extensionLiftMin * scale) {
          this.beginShotMotion(this.side, frame.landmarks, scale, t);
        }
        break;
      }

      case "SHOOTING_MOTION": {
        if (!this.side) {
          this.abortAttempt();
          return;
        }
        const lift = shootingWristAboveShoulder(frame.landmarks, this.side);
        this.wristMotion.push(t, lift);
        const elbow = armExtensionMetric(frame.landmarks, this.side, t);
        if (lift > this.apexLift) {
          this.apexLift = lift;
          this.apexElbow = elbow;
        }
        const velocity = this.wristMotion.velocityPerSec() ?? 0;
        const reachedApex =
          this.apexLift >= BASKETBALL_CONFIG.extensionLiftMin * scale;
        const descended = velocity >= 0; // lift stopped rising
        const timedOut = t - this.motionStartMs > MOTION_TIMEOUT_MS;

        if (reachedApex && (descended || timedOut)) {
          this.finalizeAttempt(scale, t);
        } else if (!reachedApex && timedOut) {
          this.abortAttempt();
        }
        break;
      }

      default:
        break;
    }
  }

  private beginShotMotion(
    side: ShootingSide,
    landmarks: Landmark3D[],
    _scale: number,
    t: number
  ) {
    this.side = side;
    this.phase = "SHOOTING_MOTION";
    this.apexLift = shootingWristAboveShoulder(landmarks, side);
    this.apexElbow = armExtensionMetric(landmarks, side, t);
    this.wristMotion.clear();
    this.wristMotion.push(t, this.apexLift);
    this.motionStartMs = t;
    this.dropoutMs = 0;
  }

  private finalizeAttempt(scale: number, t: number) {
    if (!this.side) return;

    const stability = positionStability(this.hipSamples, scale);
    const stabilityMetric = makeMetric(
      stability,
      this.hipSamples.length >= 2,
      this.hipSamples.length >= 2 ? 1 : 0,
      t
    );

    const kneeSum = this.kneeSamples.length
      ? this.kneeSamples.reduce((a, b) => a + b, 0) / this.kneeSamples.length
      : 0;
    const kneeMetric = makeMetric(
      kneeSum,
      this.kneeSamples.length >= 2,
      this.kneeSamples.length >= 2 ? 1 : 0,
      t
    );

    const elbowAlign = this.setElbow ?? makeMetric(0, false, 0, t);
    const extension = this.apexElbow ?? makeMetric(0, false, 0, t);
    const upward = upwardMotionMetric(this.apexLift, scale, t, 1);

    const formScore = basketballFormScore({
      stanceStability: stabilityMetric,
      kneeFlexion: kneeMetric,
      elbowAlignment: elbowAlign,
      armExtension: extension,
      upwardMotion: upward,
    });

    this.lastScore = formScore.value;
    this.lastMetrics = [stabilityMetric, kneeMetric, elbowAlign, extension, upward];
    this.phase = "FORM_RESULT";

    this.emit({
      type: "attempt-complete",
      mode: "basketball",
      score: Math.round(formScore.value),
    });

    const baseline = formScore.value;
    const attemptId = this.makeAttemptId();

    if (this.retryPending) {
      this.retryPending = false;
      this.emit({
        type: "retry-complete",
        mode: "basketball",
        priority: "basketball_form",
        state: "FORM_RESULT",
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
      mode: "basketball",
      priority: "basketball_form",
      state: "FORM_RESULT",
      reason: "shooting attempt completed",
      baseline,
      attemptId,
      metrics: this.formMetricsList(),
    });

    this.phase = "COACHING";
  }

  private abortAttempt() {
    this.phase = "READY";
    this.side = null;
    this.hipSamples = [];
    this.kneeSamples = [];
    this.setElbow = null;
    this.apexLift = 0;
    this.apexElbow = null;
    this.wristMotion.clear();
    this.dropoutMs = 0;
  }

  private formMetricsList(): Metric[] {
    const labels: Record<string, string> = {
      stanceStability: "Stance stability",
      kneeFlexion: "Knee flexion",
      elbowAlignment: "Elbow alignment",
      armExtension: "Arm extension",
      upwardMotion: "Upward motion",
    };
    const keys = [
      "stanceStability",
      "kneeFlexion",
      "elbowAlignment",
      "armExtension",
      "upwardMotion",
    ];
    return this.lastMetrics.map((m, i) => ({
      key: keys[i],
      label: labels[keys[i]],
      value: Math.round(m.value),
      valid: m.valid,
      confidence: m.confidence,
      timestamp: m.timestamp,
    }));
  }

  getSnapshot(): ModeSnapshot {
    const metrics = this.formMetricsList();
    return {
      mode: "basketball",
      phase: this.phase,
      formMatch: this.lastScore === null ? 0 : Math.round(this.lastScore),
      formMatchValid: this.lastScore !== null,
      stateHint: this.stateHint(),
      trackingValid: this.trackingValid,
      poseValid: this.trackingValid,
      metrics,
      extras: {
        side: this.side ?? "unknown",
        lastScore: this.lastScore === null ? null : Math.round(this.lastScore),
      },
    };
  }

  private stateHint(): string {
    switch (this.phase) {
      case "idle":
        return "Waiting to start";
      case "calibrating":
        return "Step into frame";
      case "READY":
        return "Raise the ball to your set position";
      case "RETRY":
        return "Ready for your next shot";
      case "STANCE_CAPTURE":
        return "Hold your set position…";
      case "SHOOTING_MOTION":
        return "Shoot!";
      case "FORM_RESULT":
        return "Measuring your form…";
      case "COACHING":
        return "Coach is reviewing…";
      default:
        return "";
    }
  }
}
