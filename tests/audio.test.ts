import { describe, expect, it } from "vitest";
import { StreamingResampler } from "../src/audio/resampler";
import {
  DownstrokeDetector,
  TRANSIENT_THRESHOLD_DB,
  WINDOW_SIZE,
  rmsDbOfWindow,
} from "../src/audio/downstroke";

describe("resampler", () => {
  it("downsamples 48kHz to 16kHz at the expected ratio", () => {
    const r = new StreamingResampler(48000, 16000);
    const input = new Float32Array(4800); // 100ms
    for (let i = 0; i < input.length; i++) input[i] = Math.sin(i / 10);
    const out = r.process(input);
    expect(out.length).toBeCloseTo(1600, 8);
  });

  it("keeps cross-block history (chunked output matches single-shot)", () => {
    const total = 48000;
    const full = new Float32Array(total);
    for (let i = 0; i < total; i++) full[i] = Math.sin(i / 5);

    // Single-shot reference.
    const single = Array.from(new StreamingResampler(48000, 16000).process(full));

    // Chunked processing.
    const r = new StreamingResampler(48000, 16000);
    const chunk = 1000;
    const pieces: Float32Array[] = [];
    for (let i = 0; i < total; i += chunk) {
      pieces.push(r.process(full.subarray(i, Math.min(i + chunk, total))));
    }
    const chunked = Array.prototype.concat(...pieces.map((p) => Array.from(p)));

    expect(chunked.length).toBe(single.length);
    for (let i = 0; i < single.length; i++) {
      expect(chunked[i]).toBeCloseTo(single[i], 6);
    }
    expect(single.length).toBeCloseTo(16000, 0);
  });

  it("resets cleanly", () => {
    const r = new StreamingResampler(48000, 16000);
    r.process(new Float32Array(4800));
    r.reset();
    const out = r.process(new Float32Array(4800));
    expect(out.length).toBeCloseTo(1600, 8);
  });
});

describe("downstroke detector", () => {
  it("computes RMS dB of silence near -120 dB", () => {
    const window = new Float32Array(WINDOW_SIZE);
    const db = rmsDbOfWindow(window);
    expect(db).toBeLessThan(-100);
  });

  it("computes RMS dB of a loud window", () => {
    const window = new Float32Array(WINDOW_SIZE).fill(0.5);
    const db = rmsDbOfWindow(window);
    expect(db).toBeCloseTo(20 * Math.log10(0.5), 3);
  });

  it("detects a transient above the noise floor", () => {
    const det = new DownstrokeDetector();
    // Quiet first window establishes the noise floor.
    det.push(new Float32Array(WINDOW_SIZE).fill(0.001));
    // Loud window: +60 dB above the floor.
    const events = det.push(new Float32Array(WINDOW_SIZE).fill(0.5));
    expect(events.length).toBe(1);
    expect(events[0].rmsDb).toBeGreaterThan(det.getNoiseFloorDb() + TRANSIENT_THRESHOLD_DB);
  });

  it("does not fire on continuous noise", () => {
    const det = new DownstrokeDetector();
    const events = det.push(new Float32Array(WINDOW_SIZE).fill(0.01));
    expect(events.length).toBe(0);
  });

  it("adapts its noise floor upward after loud events (cooldown prevents double-count)", () => {
    const det = new DownstrokeDetector();
    det.push(new Float32Array(WINDOW_SIZE).fill(0.001));
    const first = det.push(new Float32Array(WINDOW_SIZE).fill(0.5));
    expect(first.length).toBe(1);
    // Immediately after, another loud window is suppressed by the cooldown.
    const second = det.push(new Float32Array(WINDOW_SIZE).fill(0.5));
    expect(second.length).toBe(0);
  });
});
