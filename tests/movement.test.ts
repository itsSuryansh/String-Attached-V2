import { describe, expect, it } from "vitest";
import { ScalarTracker, positionStability } from "../src/cv/movement";

describe("ScalarTracker", () => {
  it("computes velocity in units per second", () => {
    const t = new ScalarTracker(1000, 100);
    t.push(0, 0);
    t.push(500, 1); // 1 unit in 0.5s = 2 units/s
    expect(t.velocityPerSec()).toBeCloseTo(2, 5);
  });

  it("returns null with fewer than two samples", () => {
    const t = new ScalarTracker();
    t.push(0, 1);
    expect(t.velocityPerSec()).toBeNull();
  });

  it("tracks recent min/max", () => {
    const t = new ScalarTracker(1000, 100);
    t.push(0, 5);
    t.push(100, 2);
    t.push(200, 9);
    expect(t.recentMin()).toBe(2);
    expect(t.recentMax()).toBe(9);
  });

  it("drops samples outside the window", () => {
    const t = new ScalarTracker(100, 100);
    t.push(0, 0);
    t.push(1000, 1);
    expect(t.size()).toBe(1);
  });
});

describe("positionStability", () => {
  it("scores a perfectly still centroid as 100", () => {
    const pts = [
      { x: 0.5, y: 0.5 },
      { x: 0.5, y: 0.5 },
      { x: 0.5, y: 0.5 },
    ];
    expect(positionStability(pts, 0.25)).toBeCloseTo(100, 5);
  });

  it("scores a widely moving centroid lower", () => {
    const pts = [
      { x: 0.4, y: 0.4 },
      { x: 0.6, y: 0.6 },
    ];
    expect(positionStability(pts, 0.25)).toBeLessThan(50);
  });

  it("returns 0 for fewer than two points", () => {
    expect(positionStability([{ x: 0.5, y: 0.5 }], 0.25)).toBe(0);
  });
});
