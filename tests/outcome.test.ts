import { describe, expect, it } from "vitest";
import { OUTCOME_TARGETS, classifyOutcome } from "../src/state/outcome";

describe("outcome classification (local, never Gemini)", () => {
  it("returns IMPROVED when delta >= target", () => {
    expect(classifyOutcome(10, "hand_configuration", true)).toBe("IMPROVED");
    expect(classifyOutcome(15, "transition_speed", true)).toBe("IMPROVED");
    expect(classifyOutcome(20, "strum_form", true)).toBe("IMPROVED");
    expect(classifyOutcome(25, "squat_form", true)).toBe("IMPROVED");
  });

  it("returns WORSE when delta <= -target", () => {
    expect(classifyOutcome(-10, "hand_configuration", true)).toBe("WORSE");
    expect(classifyOutcome(-15, "transition_speed", true)).toBe("WORSE");
  });

  it("returns UNCHANGED for small deltas", () => {
    expect(classifyOutcome(3, "hand_configuration", true)).toBe("UNCHANGED");
    expect(classifyOutcome(-4, "squat_form", true)).toBe("UNCHANGED");
  });

  it("returns NOT_MEASURABLE when tracking was invalid", () => {
    expect(classifyOutcome(50, "hand_configuration", false)).toBe("NOT_MEASURABLE");
  });

  it("has the required per-priority targets", () => {
    expect(OUTCOME_TARGETS.hand_configuration).toBe(10);
    expect(OUTCOME_TARGETS.transition_speed).toBe(15);
    expect(OUTCOME_TARGETS.strum_form).toBe(20);
    expect(OUTCOME_TARGETS.basketball_form).toBe(10);
    expect(OUTCOME_TARGETS.squat_form).toBe(10);
  });
});
