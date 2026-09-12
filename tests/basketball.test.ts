import { describe, expect, it } from "vitest";
import {
  armExtensionMetric,
  basketballFormScore,
  basketballScale,
  elbowAlignmentMetric,
  kneeFlexionMetric,
  pickShootingSide,
  upwardMotionMetric,
} from "../src/cv/basketballMetrics";
import { BasketballEngine } from "../src/modes/basketball/basketballEngine";
import {
  basketballSetPose,
  basketballShotPose,
  standingBody,
} from "./helpers/body";

describe("basketball metrics", () => {
  it("picks the raised shooting side", () => {
    expect(pickShootingSide(basketballShotPose())).toBe("right");
    expect(pickShootingSide(standingBody())).toBeNull();
  });

  it("scores knee flexion at a sensible stance", () => {
    const m = kneeFlexionMetric(standingBody(), "right", 0);
    expect(m.valid).toBe(true);
    // Locked knees (180°) are not ideal, so the score is below 100.
    expect(m.value).toBeLessThan(100);
  });

  it("scores a near-90° elbow highly for alignment", () => {
    const m = elbowAlignmentMetric(basketballSetPose(), "right", 0);
    expect(m.valid).toBe(true);
    expect(m.value).toBeGreaterThan(50);
  });

  it("scores a fully extended elbow highly for extension", () => {
    const m = armExtensionMetric(basketballShotPose(), "right", 0);
    expect(m.valid).toBe(true);
    expect(m.value).toBeGreaterThan(80);
  });

  it("scores upward motion from apex lift", () => {
    const m = upwardMotionMetric(0.27, 0.25, 0, 1);
    expect(m.valid).toBe(true);
    expect(m.value).toBeGreaterThan(50);
  });

  it("computes a weighted form score over valid metrics only", () => {
    const scale = basketballScale(standingBody());
    const score = basketballFormScore({
      stanceStability: { value: 90, valid: true, confidence: 1, timestamp: 0 },
      kneeFlexion: { value: 70, valid: true, confidence: 1, timestamp: 0 },
      elbowAlignment: { value: 0, valid: false, confidence: 0, timestamp: 0 },
      armExtension: { value: 80, valid: true, confidence: 1, timestamp: 0 },
      upwardMotion: { value: 60, valid: true, confidence: 1, timestamp: 0 },
    });
    expect(score.valid).toBe(true);
    expect(score.value).toBeGreaterThan(0);
    expect(score.value).toBeLessThanOrEqual(100);
    expect(scale).toBeGreaterThan(0);
  });
});

describe("basketball engine", () => {
  it("does NOT classify a static person as a completed shot", () => {
    const engine = new BasketballEngine();
    const events: string[] = [];
    engine.onEvent((e) => events.push(e.type));
    engine.start();
    for (let t = 0; t < 3000; t += 100) {
      engine.process({ timestampMs: t, landmarks: standingBody(), trackingValid: true });
    }
    expect(events).not.toContain("attempt-complete");
    expect(events).not.toContain("coaching");
  });

  it("detects a full shooting attempt (set -> shot)", () => {
    const engine = new BasketballEngine();
    const events: string[] = [];
    engine.onEvent((e) => events.push(e.type));
    engine.start();

    // Ready with arms down.
    for (let t = 0; t < 500; t += 100) {
      engine.process({ timestampMs: t, landmarks: standingBody(), trackingValid: true });
    }
    // Set position.
    for (let t = 500; t < 1200; t += 100) {
      engine.process({ timestampMs: t, landmarks: basketballSetPose(), trackingValid: true });
    }
    // Shot: raise and release.
    for (let t = 1200; t < 1800; t += 100) {
      engine.process({ timestampMs: t, landmarks: basketballShotPose(), trackingValid: true });
    }
    expect(events).toContain("attempt-complete");
    expect(events).toContain("coaching");
  });

  it("aborts the attempt when tracking is lost during the motion", () => {
    const engine = new BasketballEngine();
    const events: string[] = [];
    engine.onEvent((e) => events.push(e.type));
    engine.start();
    for (let t = 0; t < 500; t += 100) {
      engine.process({ timestampMs: t, landmarks: standingBody(), trackingValid: true });
    }
    engine.process({ timestampMs: 500, landmarks: basketballSetPose(), trackingValid: true });
    // Tracking drops out for longer than the dropout budget.
    for (let t = 600; t < 1500; t += 100) {
      engine.process({ timestampMs: t, landmarks: [], trackingValid: false });
    }
    expect(events).not.toContain("attempt-complete");
  });
});
