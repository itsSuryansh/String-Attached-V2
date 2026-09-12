import { describe, expect, it } from "vitest";
import {
  chordPoseScore,
  computeFmi,
  strumScore,
  transitionScore,
} from "../src/modes/ukulele/ukuleleMetrics";
import { normalizeHandLandmarks } from "../src/cv/normalizer";
import { getChordTemplate } from "../src/assets/templates/templates";
import { rawAm, rawC, rawFist, rawNeutral } from "./helpers/hands";

describe("chord detection (coarse hand configuration)", () => {
  it("detects C from the canonical C hand", () => {
    const score = chordPoseScore(
      normalizeHandLandmarks(rawC()).landmarks,
      getChordTemplate("C")
    );
    expect(score).toBeGreaterThan(95);
  });

  it("detects Am from the canonical Am hand", () => {
    const score = chordPoseScore(
      normalizeHandLandmarks(rawAm()).landmarks,
      getChordTemplate("Am")
    );
    expect(score).toBeGreaterThan(95);
  });

  it("does NOT confuse C with Am", () => {
    const cHand = normalizeHandLandmarks(rawC()).landmarks;
    const scoreVsAm = chordPoseScore(cHand, getChordTemplate("Am"));
    expect(scoreVsAm).toBeLessThan(90);
  });

  it("scores a fist poorly against C (bad C attempt)", () => {
    const score = chordPoseScore(
      normalizeHandLandmarks(rawFist()).landmarks,
      getChordTemplate("C")
    );
    expect(score).toBeLessThan(80);
  });

  it("scores a release (neutral) hand poorly against both chords", () => {
    const neutral = normalizeHandLandmarks(rawNeutral()).landmarks;
    const scoreC = chordPoseScore(neutral, getChordTemplate("C"));
    const scoreAm = chordPoseScore(neutral, getChordTemplate("Am"));
    expect(scoreC).toBeLessThan(60);
    expect(scoreAm).toBeLessThan(75);
  });
});

describe("transition score", () => {
  it("scores <=1500ms as 100", () => {
    expect(transitionScore(1500)).toBe(100);
    expect(transitionScore(800)).toBe(100);
  });

  it("scores slow transitions proportionally", () => {
    expect(transitionScore(3000)).toBeCloseTo(50, 5);
    expect(transitionScore(15000)).toBeCloseTo(10, 5);
  });

  it("scores non-positive delta as 0", () => {
    expect(transitionScore(0)).toBe(0);
    expect(transitionScore(-5)).toBe(0);
  });
});

describe("strum score", () => {
  it("grows with strum count and saturates at 2", () => {
    expect(strumScore(0)).toBe(0);
    expect(strumScore(1)).toBe(50);
    expect(strumScore(2)).toBe(100);
    expect(strumScore(5)).toBe(100);
  });
});

describe("FMI composition", () => {
  it("C_CHORD FMI is the C pose score", () => {
    const fmi = computeFmi("C_CHORD", {
      poseScoreC: 70,
      poseScoreAm: 0,
      transition: null,
      strum: null,
    });
    expect(fmi.value).toBe(70);
    expect(fmi.valid).toBe(true);
  });

  it("AM_STABLE FMI combines pose and transition (0.5/0.3 over 0.8)", () => {
    const fmi = computeFmi("AM_STABLE", {
      poseScoreC: 0,
      poseScoreAm: 90,
      transition: 100,
      strum: null,
    });
    expect(fmi.value).toBeCloseTo((0.5 * 90 + 0.3 * 100) / 0.8, 5);
  });

  it("STRUM_DYNAMICS renormalizes weights over valid metrics", () => {
    // Before any strum, only the pose metric is valid.
    const before = computeFmi("STRUM_DYNAMICS", {
      poseScoreC: 0,
      poseScoreAm: 80,
      transition: null,
      strum: null,
    });
    expect(before.value).toBe(80);

    const after = computeFmi("STRUM_DYNAMICS", {
      poseScoreC: 0,
      poseScoreAm: 80,
      transition: null,
      strum: 100,
    });
    expect(after.value).toBeCloseTo((0.5 * 80 + 0.2 * 100) / 0.7, 5);

    // With a completed transition the .30 weight is re-included.
    const full = computeFmi("LESSON_PASS", {
      poseScoreC: 0,
      poseScoreAm: 80,
      transition: 90,
      strum: 100,
    });
    expect(full.value).toBeCloseTo(0.5 * 80 + 0.3 * 90 + 0.2 * 100, 5);
  });

  it("TRANSITIONING FMI is the best chord match", () => {
    const fmi = computeFmi("TRANSITIONING", {
      poseScoreC: 40,
      poseScoreAm: 70,
      transition: null,
      strum: null,
    });
    expect(fmi.value).toBe(70);
  });
});
