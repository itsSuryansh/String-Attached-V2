import { describe, expect, it } from "vitest";
import {
  DETERMINISTIC_CUES,
  MAX_CORRECTION_WORDS,
  VALID_PRIORITIES,
  buildCoachingPrompt,
  validateCoachingResponse,
} from "../src/gemini/coaching-schema";

describe("coaching response validation", () => {
  it("accepts a valid coaching response", () => {
    const res = validateCoachingResponse({
      priority: "hand_configuration",
      correction: "Adjust your finger placement",
      noIntervention: false,
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.correction).toBe("Adjust your finger placement");
  });

  it("accepts NO INTERVENTION", () => {
    const res = validateCoachingResponse({
      priority: "none",
      correction: "",
      noIntervention: true,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.noIntervention).toBe(true);
      expect(res.value.correction).toBe("");
    }
  });

  it("rejects malformed (non-object) output", () => {
    expect(validateCoachingResponse("hello").ok).toBe(false);
    expect(validateCoachingResponse(null).ok).toBe(false);
    expect(validateCoachingResponse([1, 2, 3]).ok).toBe(false);
  });

  it("rejects an impossible priority", () => {
    const res = validateCoachingResponse({
      priority: "magic",
      correction: "Do better",
      noIntervention: false,
    });
    expect(res.ok).toBe(false);
  });

  it("rejects missing correction text", () => {
    const res = validateCoachingResponse({
      priority: "squat_form",
      correction: "   ",
      noIntervention: false,
    });
    expect(res.ok).toBe(false);
  });

  it("rejects corrections over 6 words", () => {
    const res = validateCoachingResponse({
      priority: "basketball_form",
      correction: "one two three four five six seven",
      noIntervention: false,
    });
    expect(res.ok).toBe(false);
  });

  it("rejects corrections over the character cap", () => {
    const res = validateCoachingResponse({
      priority: "strum_form",
      correction: "x".repeat(200),
      noIntervention: false,
    });
    expect(res.ok).toBe(false);
  });

  it("rejects 'none' priority without NO INTERVENTION", () => {
    const res = validateCoachingResponse({
      priority: "none",
      correction: "Do stuff",
      noIntervention: false,
    });
    expect(res.ok).toBe(false);
  });

  it("requires a boolean noIntervention flag", () => {
    const res = validateCoachingResponse({
      priority: "hand_configuration",
      correction: "Do stuff",
      noIntervention: "yes",
    });
    expect(res.ok).toBe(false);
  });

  it("allows the sports priorities", () => {
    expect(VALID_PRIORITIES).toContain("basketball_form");
    expect(VALID_PRIORITIES).toContain("squat_form");
    expect(VALID_PRIORITIES).toContain("none");
  });
});

describe("deterministic fallback cues", () => {
  it("has concise, 6-word-or-fewer cues for every priority", () => {
    for (const priority of VALID_PRIORITIES) {
      if (priority === "none") continue;
      const cue = DETERMINISTIC_CUES[priority];
      expect(cue).toBeTruthy();
      expect(cue.split(/\s+/).length).toBeLessThanOrEqual(MAX_CORRECTION_WORDS);
    }
  });
});

describe("prompt builder", () => {
  it("includes measurements and history and forbids fabrication", () => {
    const prompt = buildCoachingPrompt({
      mode: "squats",
      state: "COMPLETED",
      priority: "squat_form",
      trackingStatus: "tracking",
      metrics: [{ key: "depth", label: "Depth", value: 45, valid: true, confidence: 1, timestamp: 0 }],
      history: [
        {
          id: "1",
          mode: "squats",
          state: "COMPLETED",
          priority: "squat_form",
          correction: "Keep knees out",
          source: "gemini",
          baseline: 50,
          after: 42,
          delta: -8,
          outcome: "WORSE",
          timestamp: 0,
        },
      ],
    });
    expect(prompt).toContain("Depth: 45");
    expect(prompt).toContain("Keep knees out");
    expect(prompt).toContain("do NOT invent measurements");
  });
});
