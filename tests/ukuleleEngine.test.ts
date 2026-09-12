import { describe, expect, it } from "vitest";
import { UkuleleEngine } from "../src/modes/ukulele/ukuleleEngine";
import type { Landmark3D, ModeEvent } from "../src/types";
import { rawAm, rawC, rawFist, rawNeutral } from "./helpers/hands";

function feed(
  engine: UkuleleEngine,
  startMs: number,
  count: number,
  hand: Landmark3D[],
  imageY = 0.4,
  trackingValid = true
) {
  for (let i = 0; i < count; i++) {
    engine.process({
      timestampMs: startMs + i * 100,
      landmarks: hand,
      imageHandY: imageY,
      trackingValid,
    });
  }
}

function collect(engine: UkuleleEngine): ModeEvent[] {
  const events: ModeEvent[] = [];
  engine.onEvent((e) => events.push(e));
  return events;
}

describe("ukulele engine state machine", () => {
  it("reaches C_STABLE from a correct C chord", () => {
    const engine = new UkuleleEngine();
    engine.start();
    feed(engine, 0, 6, rawC());
    const snap = engine.getSnapshot();
    expect(snap.phase).toBe("C_STABLE");
    expect(snap.poseValid).toBe(true);
    expect(snap.formMatch).toBeGreaterThan(90);
  });

  it("triggers hand-configuration coaching after a sustained bad C", () => {
    const engine = new UkuleleEngine();
    engine.start();
    const events = collect(engine);
    // A fist scores below the 80 FORM MATCH coaching threshold.
    feed(engine, 0, 32, rawFist());
    const coaching = events.find((e) => e.type === "coaching");
    expect(coaching).toBeDefined();
    if (coaching && coaching.type === "coaching") {
      expect(coaching.priority).toBe("hand_configuration");
      expect(coaching.baseline).toBeLessThan(80);
    }
  });

  it("starts the transition when C drops below 60 and completes with Am", () => {
    const engine = new UkuleleEngine();
    engine.start();
    const events = collect(engine);
    feed(engine, 0, 6, rawC()); // C stable
    feed(engine, 600, 1, rawNeutral()); // release -> transition starts
    feed(engine, 700, 5, rawAm()); // form Am -> candidate -> hold -> stable

    const complete = events.find((e) => e.type === "transition-complete");
    expect(complete).toBeDefined();
    if (complete && complete.type === "transition-complete") {
      expect(complete.score).toBe(100); // fast transition
      expect(complete.deltaMs).toBeLessThan(1500);
    }
    expect(engine.getSnapshot().phase).toBe("STRUM_DYNAMICS");
  });

  it("invalidates a transition that exceeds 5 seconds", () => {
    const engine = new UkuleleEngine();
    engine.start();
    const events = collect(engine);
    feed(engine, 0, 6, rawC());
    feed(engine, 600, 60, rawNeutral()); // stays between chords > 5s
    expect(events.some((e) => e.type === "transition-invalidated")).toBe(true);
    const coaching = events.find(
      (e) => e.type === "coaching" && e.priority === "transition_speed"
    );
    expect(coaching).toBeDefined();
    expect(engine.getSnapshot().phase).toBe("C_CHORD");
  });

  it("invalidates a transition on tracking dropout", () => {
    const engine = new UkuleleEngine();
    engine.start();
    const events = collect(engine);
    feed(engine, 0, 6, rawC());
    feed(engine, 600, 1, rawNeutral()); // begin transition
    // Dropout for >250ms.
    for (let i = 0; i < 6; i++) {
      engine.process({
        timestampMs: 700 + i * 100,
        landmarks: [],
        imageHandY: 0.4,
        trackingValid: false,
      });
    }
    expect(events.some((e) => e.type === "transition-invalidated")).toBe(true);
  });

  it("requires a continuous 300ms Am hold (interruption resets the hold)", () => {
    const engine = new UkuleleEngine();
    engine.start();
    const events = collect(engine);
    feed(engine, 0, 6, rawC());
    feed(engine, 600, 1, rawNeutral());
    // Am for only 200ms, then interrupted.
    feed(engine, 700, 2, rawAm());
    feed(engine, 900, 1, rawNeutral());
    expect(events.some((e) => e.type === "transition-complete")).toBe(false);
    // Hold Am continuously for 300ms.
    feed(engine, 1000, 4, rawAm());
    const complete = events.find((e) => e.type === "transition-complete");
    expect(complete).toBeDefined();
  });

  it("completes the lesson after two correlated downstrokes", () => {
    const engine = new UkuleleEngine();
    engine.start();
    const events = collect(engine);
    feed(engine, 0, 6, rawC());
    feed(engine, 600, 1, rawNeutral());
    feed(engine, 700, 5, rawAm()); // now STRUM_DYNAMICS

    // Strum 1: visual downstroke + acoustic transient.
    engine.process({ timestampMs: 2000, landmarks: rawAm(), imageHandY: 0.3, trackingValid: true });
    engine.process({ timestampMs: 2100, landmarks: rawAm(), imageHandY: 0.55, trackingValid: true });
    engine.onAudioTransient({ timeMs: 2150, rmsDb: -10 });

    // Strum 2.
    engine.process({ timestampMs: 3000, landmarks: rawAm(), imageHandY: 0.3, trackingValid: true });
    engine.process({ timestampMs: 3100, landmarks: rawAm(), imageHandY: 0.55, trackingValid: true });
    engine.onAudioTransient({ timeMs: 3150, rmsDb: -10 });

    expect(events.some((e) => e.type === "lesson-pass")).toBe(true);
    expect(engine.getSnapshot().phase).toBe("LESSON_PASS");
  });

  it("times out the strum window and returns to C_CHORD", () => {
    const engine = new UkuleleEngine();
    engine.start();
    const events = collect(engine);
    feed(engine, 0, 6, rawC());
    feed(engine, 600, 1, rawNeutral());
    feed(engine, 700, 5, rawAm());
    // Hold Am without strumming for > 10s.
    feed(engine, 1200, 110, rawAm(), 0.4);
    expect(events.some((e) => e.type === "coaching" && e.priority === "strum_form")).toBe(true);
    expect(engine.getSnapshot().phase).toBe("C_CHORD");
  });

  it("measures a retry (bad C -> corrected C) with retry-complete", () => {
    const engine = new UkuleleEngine();
    engine.start();
    const events = collect(engine);
    feed(engine, 0, 32, rawFist()); // coaching triggered
    const coaching = events.find(
      (e) => e.type === "coaching" && e.priority === "hand_configuration"
    );
    expect(coaching).toBeDefined();
    feed(engine, 3200, 6, rawC()); // user corrects -> C_STABLE -> retry complete
    const retry = events.find((e) => e.type === "retry-complete");
    expect(retry).toBeDefined();
    if (retry && retry.type === "retry-complete") {
      expect(retry.priority).toBe("hand_configuration");
      expect(retry.measurable).toBe(true);
      expect(retry.after).toBeGreaterThan(retry.baseline);
    }
  });

  it("does not produce measurements when tracking is invalid", () => {
    const engine = new UkuleleEngine();
    engine.start();
    for (let i = 0; i < 5; i++) {
      engine.process({
        timestampMs: i * 100,
        landmarks: [],
        imageHandY: 0.4,
        trackingValid: false,
      });
    }
    const snap = engine.getSnapshot();
    expect(snap.poseValid).toBe(false);
    expect(snap.formMatchValid).toBe(false);
  });
});
