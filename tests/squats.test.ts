import { describe, expect, it } from "vitest";
import {
  ascentControlMetric,
  depthMetric,
  kneeAlignmentMetric,
  meanKneeAngle,
  squatCoreVisible,
  squatFormScore,
  torsoAngleMetric,
} from "../src/cv/squatMetrics";
import { SquatEngine } from "../src/modes/squats/squatEngine";
import {
  squatBottomPose,
  squatDescendPose,
  standingBody,
} from "./helpers/body";

describe("squat metrics", () => {
  it("computes a near-180° knee angle when standing", () => {
    expect(meanKneeAngle(standingBody())).toBeGreaterThan(160);
  });

  it("computes a bent knee angle at the bottom", () => {
    expect(meanKneeAngle(squatBottomPose())).toBeLessThan(110);
  });

  it("core joints are visible on a standing body", () => {
    expect(squatCoreVisible(standingBody())).toBe(true);
  });

  it("scores depth from knee angle + hip drop", () => {
    const shallow = depthMetric(140, 0.15, 0, 1);
    const deep = depthMetric(95, 0.6, 0, 1);
    expect(shallow.value).toBeLessThan(deep.value);
    expect(deep.value).toBeGreaterThan(50);
  });

  it("scores knee alignment and torso angle", () => {
    const align = kneeAlignmentMetric(squatBottomPose(), 0);
    const torso = torsoAngleMetric(standingBody(), 0);
    expect(align.valid).toBe(true);
    expect(torso.valid).toBe(true);
    expect(torso.value).toBeGreaterThan(50);
  });

  it("scores a too-fast ascent poorly", () => {
    const fast = ascentControlMetric(150, 0, 1);
    const controlled = ascentControlMetric(900, 0, 1);
    expect(fast.value).toBeLessThan(controlled.value);
  });

  it("computes a weighted squat form score", () => {
    const score = squatFormScore({
      depth: { value: 80, valid: true, confidence: 1, timestamp: 0 },
      kneeAlignment: { value: 60, valid: true, confidence: 1, timestamp: 0 },
      torsoAngle: { value: 70, valid: true, confidence: 1, timestamp: 0 },
      ascentControl: { value: 50, valid: true, confidence: 1, timestamp: 0 },
    });
    expect(score.valid).toBe(true);
    expect(score.value).toBeGreaterThan(0);
    expect(score.value).toBeLessThanOrEqual(100);
  });
});

describe("squat engine", () => {
  it("does NOT count a static pose as a squat", () => {
    const engine = new SquatEngine();
    const events: string[] = [];
    engine.onEvent((e) => events.push(e.type));
    engine.start();
    for (let t = 0; t < 3000; t += 100) {
      engine.process({ timestampMs: t, landmarks: standingBody(), trackingValid: true });
    }
    expect(events).not.toContain("attempt-complete");
    expect(events).not.toContain("coaching");
  });

  it("counts a full standing->bottom->standing cycle", () => {
    const engine = new SquatEngine();
    const events: string[] = [];
    engine.onEvent((e) => events.push(e.type));
    engine.start();

    // Standing.
    for (let t = 0; t <= 500; t += 100) {
      engine.process({ timestampMs: t, landmarks: standingBody(), trackingValid: true });
    }
    // Descend (~135°).
    for (let t = 600; t <= 800; t += 100) {
      engine.process({ timestampMs: t, landmarks: squatDescendPose(), trackingValid: true });
    }
    // Bottom (~90°), hold so the knee-angle velocity crosses zero.
    for (let t = 900; t <= 1300; t += 100) {
      engine.process({ timestampMs: t, landmarks: squatBottomPose(), trackingValid: true });
    }
    // Ascend.
    for (let t = 1400; t <= 1500; t += 100) {
      engine.process({ timestampMs: t, landmarks: squatDescendPose(), trackingValid: true });
    }
    // Back to standing.
    for (let t = 1600; t <= 1800; t += 100) {
      engine.process({ timestampMs: t, landmarks: standingBody(), trackingValid: true });
    }

    expect(events).toContain("attempt-complete");
    expect(events).toContain("coaching");
  });

  it("does not count an interrupted (tracking-lost) cycle", () => {
    const engine = new SquatEngine();
    const events: string[] = [];
    engine.onEvent((e) => events.push(e.type));
    engine.start();
    for (let t = 0; t < 600; t += 100) {
      engine.process({ timestampMs: t, landmarks: standingBody(), trackingValid: true });
    }
    engine.process({ timestampMs: 600, landmarks: squatDescendPose(), trackingValid: true });
    for (let t = 700; t < 1500; t += 100) {
      engine.process({ timestampMs: t, landmarks: [], trackingValid: false });
    }
    expect(events).not.toContain("attempt-complete");
  });
});
