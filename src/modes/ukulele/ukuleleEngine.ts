// Ukulele motor-skill coaching engine — the deterministic state machine.
//
//   IDLE -> CALIBRATING -> C_CHORD -> C_STABLE -> TRANSITIONING
//        -> AM_CANDIDATE -> AM_STABLE -> STRUM_DYNAMICS -> LESSON_PASS
//
// The engine owns ALL measurement and state. It emits coaching triggers and
// retry completions; Gemini (via the coaching controller) only interprets the
// supplied evidence.

import type {
  CoachingPriority,
  Landmark3D,
  Metric,
  ModeEvent,
  ModeSnapshot,
  UkulelePhase,
} from "@/types";
import { normalizeHandLandmarks } from "@/cv/normalizer";
import { getChordTemplate } from "@/assets/templates/templates";
import { ScalarTracker } from "@/cv/movement";
import {
  chordPoseScore,
  computeFmi,
  strumScore,
  transitionScore,
} from "./ukuleleMetrics";

export const UKULELE_CONFIG = {
  stableChordThreshold: 75,
  stableHoldMs: 300,
  transitionStartPoseBelow: 60,
  transitionTimeoutMs: 5000,
  dropoutMaxMs: 250,
  amCandidateThreshold: 75,
  amHoldMs: 300,
  strumWindowMs: 10000,
  strumRequired: 2,
  lowFmiThreshold: 80,
  lowFmiCoachingMs: 3000,
  baselineWindowMs: 500,
  retryHoldMs: 300,
  visualDownstrokeVelocity: 1.0,
  strumCorrelationMs: 300,
  motionTrackerWindowMs: 250,
  motionCooldownMs: 250,
} as const;

export interface UkuleleFrame {
  timestampMs: number;
  /** 21 MediaPipe 3D WORLD landmarks (meters). */
  landmarks: Landmark3D[];
  /** Hand-center y in image space (0..1, y grows downward). */
  imageHandY: number;
  trackingValid: boolean;
}

export interface AudioTransientInput {
  timeMs: number;
  rmsDb: number;
}

export type UkuleleEvent = ModeEvent;

export interface UkuleleSnapshot {
  phase: UkulelePhase;
  fmi: number;
  fmiValid: boolean;
  poseScoreC: number;
  poseScoreAm: number;
  transitionScore: number | null;
  strumScore: number;
  strumCount: number;
  trackingValid: boolean;
  poseValid: boolean;
  transitionElapsedMs: number;
  stateHint: string;
}

interface PendingRetry {
  priority: CoachingPriority;
  baseline: number;
  attemptId: string;
}

interface TimedEvent {
  t: number;
}

export class UkuleleEngine {
  private phase: UkulelePhase = "idle";
  private poseScoreC = 0;
  private poseScoreAm = 0;
  private poseValid = false;
  private transitionScoreVal: number | null = null;
  private strumCount = 0;
  private trackingValid = false;
  private prevFrameTime = -1;

  // Timers (real, reset on invalid frames / tracking loss).
  private stableCTimerMs = 0;
  private amHoldTimerMs = 0;
  private transitionStartMs = 0;
  private transitionElapsedMs = 0;
  private dropoutMs = 0;
  private lowFmiTimerMs = 0;
  private strumWindowStartMs = 0;
  private strumWindowValidMs = 0;

  // Pending intervention (coaching -> retry -> outcome).
  private pendingRetry: PendingRetry | null = null;

  // Baseline / retry sampling.
  private fmiWindow: Array<{ t: number; v: number }> = [];
  private holdSamples: number[] = [];
  private holdTrackingMs = 0;

  // Motion + audio for strum correlation.
  private motion = new ScalarTracker(
    UKULELE_CONFIG.motionTrackerWindowMs,
    40
  );
  private lastMotionEventT = -Infinity;
  private visualEvents: TimedEvent[] = [];
  private audioEvents: Array<TimedEvent & { rmsDb: number }> = [];

  private attemptCounter = 0;
  private listeners: Array<(e: UkuleleEvent) => void> = [];

  onEvent(cb: (e: UkuleleEvent) => void): () => void {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb);
    };
  }

  private emit(e: UkuleleEvent) {
    for (const l of this.listeners) l(e);
  }

  private makeAttemptId(): string {
    this.attemptCounter += 1;
    return `uku-${Date.now()}-${this.attemptCounter}`;
  }

  start() {
    if (this.phase === "idle") {
      this.phase = "calibrating";
    }
  }

  reset() {
    this.phase = "idle";
    this.poseScoreC = 0;
    this.poseScoreAm = 0;
    this.poseValid = false;
    this.transitionScoreVal = null;
    this.strumCount = 0;
    this.trackingValid = false;
    this.prevFrameTime = -1;
    this.stableCTimerMs = 0;
    this.amHoldTimerMs = 0;
    this.transitionStartMs = 0;
    this.transitionElapsedMs = 0;
    this.dropoutMs = 0;
    this.lowFmiTimerMs = 0;
    this.strumWindowStartMs = 0;
    this.strumWindowValidMs = 0;
    this.pendingRetry = null;
    this.fmiWindow = [];
    this.holdSamples = [];
    this.holdTrackingMs = 0;
    this.motion.clear();
    this.lastMotionEventT = -Infinity;
    this.visualEvents = [];
    this.audioEvents = [];
  }

  onAudioTransient(ev: AudioTransientInput) {
    this.audioEvents.push({ t: ev.timeMs, rmsDb: ev.rmsDb });
    this.tryCorrelate("audio");
    this.pruneEvents();
  }

  private pruneEvents() {
    const now = this.prevFrameTime;
    this.audioEvents = this.audioEvents.filter((e) => now - e.t < 1500);
    this.visualEvents = this.visualEvents.filter((e) => now - e.t < 1500);
  }

  private tryCorrelate(source: "audio" | "visual") {
    if (this.phase !== "STRUM_DYNAMICS") return;
    const tolerance = UKULELE_CONFIG.strumCorrelationMs;
    if (source === "audio" && this.audioEvents.length > 0) {
      const audio = this.audioEvents[this.audioEvents.length - 1];
      const idx = this.visualEvents.findIndex(
        (v) => Math.abs(v.t - audio.t) <= tolerance
      );
      if (idx >= 0) {
        this.visualEvents.splice(idx, 1);
        this.audioEvents.pop();
        this.registerStrum();
      }
    } else if (source === "visual" && this.visualEvents.length > 0) {
      const visual = this.visualEvents[this.visualEvents.length - 1];
      const idx = this.audioEvents.findIndex(
        (a) => Math.abs(a.t - visual.t) <= tolerance
      );
      if (idx >= 0) {
        this.audioEvents.splice(idx, 1);
        this.visualEvents.pop();
        this.registerStrum();
      }
    }
  }

  private registerStrum() {
    this.strumCount += 1;
    this.emit({ type: "strum", mode: "ukulele", count: this.strumCount });
    if (this.strumCount >= UKULELE_CONFIG.strumRequired) {
      this.completeStrumWindow();
    }
  }

  private detectVisualDownstroke(t: number, y: number): boolean {
    this.motion.push(t, y);
    const v = this.motion.velocityPerSec();
    if (v === null) return false;
    if (
      v > UKULELE_CONFIG.visualDownstrokeVelocity &&
      t - this.lastMotionEventT > UKULELE_CONFIG.motionCooldownMs
    ) {
      this.lastMotionEventT = t;
      return true;
    }
    return false;
  }

  process(frame: UkuleleFrame) {
    const t = frame.timestampMs;
    const dt = this.prevFrameTime < 0 ? 0 : Math.max(0, t - this.prevFrameTime);
    this.prevFrameTime = t;
    this.trackingValid = frame.trackingValid;

    if (this.phase === "idle") return;

    // Visual motion detection (image space) runs independent of state validity.
    if (this.detectVisualDownstroke(t, frame.imageHandY)) {
      this.visualEvents.push({ t });
      this.tryCorrelate("visual");
    }

    // Normalize + measure. Invalid / UNCALIBRATED frames must NOT produce
    // measurements and MUST reset applicable timers.
    const norm = frame.trackingValid
      ? normalizeHandLandmarks(frame.landmarks)
      : null;
    const validFrame = norm !== null && norm.ok && frame.trackingValid;

    if (!validFrame) {
      this.poseValid = false;
      this.dropoutMs += dt;
      this.resetInvalidTimers();
      this.pushFmiSample(t, null);
      if (
        this.phase === "TRANSITIONING" &&
        this.dropoutMs > UKULELE_CONFIG.dropoutMaxMs
      ) {
        this.invalidateTransition("tracking dropout");
      }
      return;
    }

    // Valid frame.
    this.dropoutMs = 0;
    this.poseValid = true;

    const cTemplate = getChordTemplate("C");
    const amTemplate = getChordTemplate("Am");
    this.poseScoreC = chordPoseScore(norm.landmarks, cTemplate);
    this.poseScoreAm = chordPoseScore(norm.landmarks, amTemplate);

    const fmi = this.currentFmi();
    this.pushFmiSample(t, fmi.value);

    if (this.phase === "calibrating") {
      this.phase = "C_CHORD";
    }

    this.advance(t, dt);
  }

  private resetInvalidTimers() {
    this.stableCTimerMs = 0;
    this.amHoldTimerMs = 0;
    this.lowFmiTimerMs = 0;
    this.holdSamples = [];
    this.holdTrackingMs = 0;
  }

  private pushFmiSample(t: number, v: number | null) {
    if (v !== null) {
      this.fmiWindow.push({ t, v });
      const cutoff = t - UKULELE_CONFIG.baselineWindowMs;
      this.fmiWindow = this.fmiWindow.filter((s) => s.t >= cutoff);
    }
  }

  private baselineOverWindow(): number | null {
    if (this.fmiWindow.length === 0) return null;
    let sum = 0;
    for (const s of this.fmiWindow) sum += s.v;
    return sum / this.fmiWindow.length;
  }

  private currentFmi() {
    return computeFmi(this.phase, {
      poseScoreC: this.poseScoreC,
      poseScoreAm: this.poseScoreAm,
      transition: this.transitionScoreVal,
      strum: this.strumCount > 0 ? strumScore(this.strumCount) : null,
    });
  }

  private advance(t: number, dt: number) {
    const cfg = UKULELE_CONFIG;
    switch (this.phase) {
      case "C_CHORD":
      case "C_STABLE": {
        const fmi = this.poseScoreC;
        if (fmi < cfg.lowFmiThreshold) {
          this.lowFmiTimerMs += dt;
          if (this.lowFmiTimerMs >= cfg.lowFmiCoachingMs) {
            this.lowFmiTimerMs = 0;
            const baseline = this.baselineOverWindow() ?? fmi;
            this.triggerCoaching(
              "hand_configuration",
              "C chord form match low",
              baseline
            );
          }
        } else {
          this.lowFmiTimerMs = 0;
        }

        if (this.poseScoreC >= cfg.stableChordThreshold) {
          this.stableCTimerMs += dt;
          this.holdSamples.push(this.poseScoreC);
          this.holdTrackingMs += dt;
          if (this.stableCTimerMs >= cfg.stableHoldMs) {
            this.phase = "C_STABLE";
            this.completeHandConfigRetryIfPending();
          }
        } else {
          this.stableCTimerMs = 0;
          this.holdSamples = [];
          this.holdTrackingMs = 0;
        }

        if (
          this.phase === "C_STABLE" &&
          this.poseScoreC < cfg.transitionStartPoseBelow
        ) {
          this.beginTransition(t);
        }
        break;
      }

      case "TRANSITIONING": {
        this.transitionElapsedMs = t - this.transitionStartMs;
        if (this.transitionElapsedMs > cfg.transitionTimeoutMs) {
          this.invalidateTransition("timeout");
          return;
        }
        if (this.poseScoreAm >= cfg.amCandidateThreshold) {
          this.phase = "AM_CANDIDATE";
          this.amHoldTimerMs = 0;
        }
        break;
      }

      case "AM_CANDIDATE": {
        this.transitionElapsedMs = t - this.transitionStartMs;
        if (this.transitionElapsedMs > cfg.transitionTimeoutMs) {
          this.invalidateTransition("timeout");
          return;
        }
        if (this.poseScoreAm >= cfg.amCandidateThreshold) {
          this.amHoldTimerMs += dt;
          if (this.amHoldTimerMs >= cfg.amHoldMs) {
            this.phase = "AM_STABLE";
            const deltaMs = t - this.transitionStartMs;
            this.transitionScoreVal = transitionScore(deltaMs);
            this.emit({
              type: "transition-complete",
              mode: "ukulele",
              deltaMs,
              score: this.transitionScoreVal,
            });
            this.completeTransitionRetryIfPending(deltaMs);
            this.enterStrumDynamics(t);
          }
        } else {
          this.amHoldTimerMs = 0;
          this.phase = "TRANSITIONING";
        }
        break;
      }

      case "STRUM_DYNAMICS": {
        this.updateStrumWindow(t, dt);
        break;
      }

      default:
        break;
    }
  }

  private beginTransition(t: number) {
    this.phase = "TRANSITIONING";
    this.transitionStartMs = t;
    this.transitionElapsedMs = 0;
    this.dropoutMs = 0;
    this.stableCTimerMs = 0;
  }

  private invalidateTransition(reason: string) {
    this.emit({ type: "transition-invalidated", mode: "ukulele", reason });
    this.transitionElapsedMs = 0;
    this.amHoldTimerMs = 0;
    this.dropoutMs = 0;
    this.phase = "C_CHORD";
    this.stableCTimerMs = 0;
    const baseline = this.transitionScoreVal ?? 0;
    this.triggerCoaching("transition_speed", `transition ${reason}`, baseline);
  }

  private triggerCoaching(
    priority: CoachingPriority,
    reason: string,
    baseline: number
  ) {
    const attemptId = this.makeAttemptId();
    this.pendingRetry = { priority, baseline, attemptId };
    this.emit({
      type: "coaching",
      mode: "ukulele",
      priority,
      state: this.phase,
      reason,
      baseline,
      attemptId,
      metrics: this.evidenceMetrics(),
    });
  }

  private evidenceMetrics(): Metric[] {
    const now = this.prevFrameTime;
    return [
      {
        key: "poseC",
        label: "C chord match",
        value: Math.round(this.poseScoreC),
        valid: this.poseValid,
        confidence: 1,
        timestamp: now,
      },
      {
        key: "poseAm",
        label: "Am chord match",
        value: Math.round(this.poseScoreAm),
        valid: this.poseValid,
        confidence: 1,
        timestamp: now,
      },
      {
        key: "transition",
        label: "Transition score",
        value: Math.round(this.transitionScoreVal ?? 0),
        valid: this.transitionScoreVal !== null,
        confidence: 1,
        timestamp: now,
      },
      {
        key: "strum",
        label: "Strum score",
        value: Math.round(strumScore(this.strumCount)),
        valid: this.strumCount > 0,
        confidence: 1,
        timestamp: now,
      },
    ];
  }

  private completeHandConfigRetryIfPending() {
    if (this.pendingRetry?.priority !== "hand_configuration") return;
    if (this.holdSamples.length === 0) return;
    let sum = 0;
    for (const s of this.holdSamples) sum += s;
    const after = sum / this.holdSamples.length;
    const measurable = this.holdTrackingMs >= UKULELE_CONFIG.retryHoldMs;
    this.emitRetryComplete(after, measurable);
    this.holdSamples = [];
  }

  private completeTransitionRetryIfPending(deltaMs: number) {
    if (this.pendingRetry?.priority !== "transition_speed") return;
    const after = transitionScore(deltaMs);
    this.emitRetryComplete(after, true);
  }

  private emitRetryComplete(after: number, measurable: boolean) {
    if (!this.pendingRetry) return;
    const { priority, baseline, attemptId } = this.pendingRetry;
    this.pendingRetry = null;
    this.emit({
      type: "retry-complete",
      mode: "ukulele",
      priority,
      state: this.phase,
      baseline,
      after,
      measurable,
      attemptId,
    });
  }

  private enterStrumDynamics(t: number) {
    this.phase = "STRUM_DYNAMICS";
    this.strumCount = 0;
    this.strumWindowStartMs = t;
    this.strumWindowValidMs = 0;
    this.visualEvents = [];
    this.audioEvents = [];
  }

  private updateStrumWindow(t: number, dt: number) {
    if (this.strumWindowStartMs === 0) {
      this.strumWindowStartMs = t;
    }
    if (this.poseValid && this.trackingValid) {
      this.strumWindowValidMs += dt;
    }
    const elapsed = t - this.strumWindowStartMs;
    if (elapsed >= UKULELE_CONFIG.strumWindowMs) {
      const after = strumScore(this.strumCount);
      const measurable = this.strumWindowValidMs >= UKULELE_CONFIG.retryHoldMs;
      if (this.pendingRetry?.priority === "strum_form") {
        this.emitRetryComplete(after, measurable);
      } else {
        this.triggerCoaching("strum_form", "strum window timed out", after);
      }
      this.strumWindowStartMs = 0;
      this.strumWindowValidMs = 0;
      this.phase = "C_CHORD";
      this.stableCTimerMs = 0;
    }
  }

  private completeStrumWindow() {
    const after = strumScore(this.strumCount);
    const measurable = this.strumWindowValidMs >= UKULELE_CONFIG.retryHoldMs;
    if (this.pendingRetry?.priority === "strum_form") {
      this.emitRetryComplete(after, measurable);
    }
    this.strumWindowStartMs = 0;
    this.strumWindowValidMs = 0;
    this.phase = "LESSON_PASS";
    this.emit({ type: "lesson-pass", mode: "ukulele" });
  }

  getSnapshot(): ModeSnapshot {
    const fmi = this.currentFmi();
    const metrics = this.evidenceMetrics();
    return {
      mode: "ukulele",
      phase: this.phase,
      formMatch: Math.round(fmi.value),
      formMatchValid: fmi.valid && this.poseValid,
      stateHint: this.stateHint(),
      trackingValid: this.trackingValid,
      poseValid: this.poseValid,
      metrics,
      extras: {
        poseScoreC: Math.round(this.poseScoreC),
        poseScoreAm: Math.round(this.poseScoreAm),
        transitionScore: this.transitionScoreVal === null ? null : Math.round(this.transitionScoreVal),
        strumCount: this.strumCount,
        strumScore: Math.round(strumScore(this.strumCount)),
        transitionElapsedMs: Math.round(this.transitionElapsedMs),
      },
    };
  }

  private stateHint(): string {
    switch (this.phase) {
      case "idle":
        return "Waiting to start";
      case "calibrating":
        return "Show your fretting hand";
      case "C_CHORD":
        return "Form a C chord";
      case "C_STABLE":
        return "C locked — switch to Am";
      case "TRANSITIONING":
        return "Moving to Am…";
      case "AM_CANDIDATE":
        return "Hold the Am…";
      case "AM_STABLE":
        return "Am locked — strum!";
      case "STRUM_DYNAMICS":
        return `Strum down (${this.strumCount}/${UKULELE_CONFIG.strumRequired})`;
      case "LESSON_PASS":
        return "Lesson complete!";
      default:
        return "";
    }
  }
}
