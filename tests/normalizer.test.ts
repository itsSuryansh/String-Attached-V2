import { describe, expect, it } from "vitest";
import {
  maxPairwiseDistance,
  meanLandmarkDistance,
  normalizeHandLandmarks,
  poseScore,
} from "../src/cv/normalizer";
import { rawC, rawFist, rawNeutral, rawOpen } from "./helpers/hands";

describe("normalizer", () => {
  it("rejects short input", () => {
    const res = normalizeHandLandmarks([{ x: 0, y: 0, z: 0 }]);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("short_input");
  });

  it("normalizes a valid hand (translation to origin)", () => {
    const res = normalizeHandLandmarks(rawC());
    expect(res.ok).toBe(true);
    expect(res.landmarks).toHaveLength(21);
    // Wrist (landmark 0) is translated to the origin.
    expect(res.landmarks[0].x).toBeCloseTo(0, 5);
    expect(res.landmarks[0].y).toBeCloseTo(0, 5);
    expect(res.landmarks[0].z).toBeCloseTo(0, 5);
  });

  it("computes scale as the max pairwise distance", () => {
    const pts = rawC();
    const expected = maxPairwiseDistance(pts);
    const res = normalizeHandLandmarks(pts);
    expect(res.scale).toBeCloseTo(expected, 5);
    expect(res.scale).toBeGreaterThan(0);
  });

  it("guards against degenerate collinear hands (UNCALIBRATED)", () => {
    // A hand with all landmarks on a single line makes w_raw ≈ 0.
    const line = rawOpen().map((_, i) => ({ x: 0, y: -i * 0.1, z: 0 }));
    const res = normalizeHandLandmarks(line);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("collinear");
  });

  it("normalizes independent of translation (translation invariance)", () => {
    const a = rawC();
    const shifted = a.map((p) => ({ ...p, x: p.x + 5, y: p.y - 3, z: p.z + 2 }));
    const ra = normalizeHandLandmarks(a);
    const rb = normalizeHandLandmarks(shifted);
    expect(ra.ok && rb.ok).toBe(true);
    for (let i = 0; i < 21; i++) {
      expect(rb.landmarks[i].x).toBeCloseTo(ra.landmarks[i].x, 3);
      expect(rb.landmarks[i].y).toBeCloseTo(ra.landmarks[i].y, 3);
      expect(rb.landmarks[i].z).toBeCloseTo(ra.landmarks[i].z, 3);
    }
  });

  it("normalizes independent of scale (scale invariance)", () => {
    const a = rawC();
    const scaled = a.map((p) => ({ ...p, x: p.x * 10, y: p.y * 10, z: p.z * 10 }));
    const ra = normalizeHandLandmarks(a);
    const rb = normalizeHandLandmarks(scaled);
    expect(ra.ok && rb.ok).toBe(true);
    for (let i = 0; i < 21; i++) {
      expect(rb.landmarks[i].x).toBeCloseTo(ra.landmarks[i].x, 3);
      expect(rb.landmarks[i].y).toBeCloseTo(ra.landmarks[i].y, 3);
    }
  });

  it("computes pose distance and score", () => {
    const c = normalizeHandLandmarks(rawC());
    const same = meanLandmarkDistance(c.landmarks, c.landmarks);
    expect(same).toBeCloseTo(0, 5);
    const s = poseScore(c.landmarks, c.landmarks);
    expect(s).toBeCloseTo(100, 5);

    // A fist is far from the open hand.
    const fist = normalizeHandLandmarks(rawFist());
    const open = normalizeHandLandmarks(rawOpen());
    const d = meanLandmarkDistance(fist.landmarks, open.landmarks);
    expect(d).toBeGreaterThan(0.1);
    const score = poseScore(fist.landmarks, open.landmarks);
    expect(score).toBeLessThan(85);

    // A "release" hand (fingers curled forward) is far from the C template.
    const neutral = normalizeHandLandmarks(rawNeutral());
    const cTemplate = normalizeHandLandmarks(rawC());
    const neutralScore = poseScore(neutral.landmarks, cTemplate.landmarks);
    expect(neutralScore).toBeLessThan(60);
  });
});
