// Acoustic transient (downstroke) detection.
//
// Audio is analyzed at 16 kHz mono. Windows of N = 320 samples (20 ms) are
// used to compute RMS and RMS dB. The noise floor is a slow EMA and a
// transient is declared when RMS_dB >= noiseFloor_dB + 12.
//
// This module is ONLY for detecting acoustic transients. It performs no pitch
// recognition, chord recognition, or transcription.

export const WINDOW_SIZE = 320;
export const TRANSIENT_THRESHOLD_DB = 12;
export const NOISE_FLOOR_ALPHA = 0.05; // 0.95 * previous + 0.05 * current
export const COOLDOWN_SAMPLES = Math.round(0.2 * 16000); // 200 ms at 16 kHz

export interface TransientEvent {
  /** Global 16 kHz sample index at the END of the detected window. */
  sampleIndex: number;
  rmsDb: number;
  noiseFloorDb: number;
}

export function rmsDbOfWindow(window: Float32Array | number[]): number {
  const n = window.length;
  if (n === 0) return -120;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const y = window[i];
    sum += y * y;
  }
  const rms = Math.sqrt(sum / n);
  return 20 * Math.log10(Math.max(rms, 1e-6));
}

/**
 * Streaming detector that consumes resampled 16 kHz mono samples and emits
 * transient events. A cooldown prevents a single strum's ring from counting
 * as many separate transients.
 */
export class DownstrokeDetector {
  private ring = new Float32Array(WINDOW_SIZE);
  private filled = 0;
  private noiseFloorDb = -120;
  private initialized = false;
  private sampleCount = 0;
  private lastEventSample = -Infinity;

  push(samples: Float32Array | number[]): TransientEvent[] {
    const events: TransientEvent[] = [];
    for (let i = 0; i < samples.length; i++) {
      this.ring[this.filled++] = samples[i];
      this.sampleCount++;
      if (this.filled === WINDOW_SIZE) {
        const window = this.ring.subarray(0, WINDOW_SIZE);
        const db = rmsDbOfWindow(window);
        const event = this.evaluateWindow(db);
        if (event) events.push(event);
        this.filled = 0;
      }
    }
    return events;
  }

  private evaluateWindow(db: number): TransientEvent | null {
    let event: TransientEvent | null = null;
    if (!this.initialized) {
      this.noiseFloorDb = db;
      this.initialized = true;
    } else {
      const triggered = db >= this.noiseFloorDb + TRANSIENT_THRESHOLD_DB;
      const cooled =
        this.sampleCount - this.lastEventSample >= COOLDOWN_SAMPLES;
      if (triggered && cooled) {
        event = {
          sampleIndex: this.sampleCount,
          rmsDb: db,
          noiseFloorDb: this.noiseFloorDb,
        };
        this.lastEventSample = this.sampleCount;
      }
      this.noiseFloorDb =
        (1 - NOISE_FLOOR_ALPHA) * this.noiseFloorDb + NOISE_FLOOR_ALPHA * db;
    }
    return event;
  }

  /** Current adaptive noise floor in dB (for debug/telemetry). */
  getNoiseFloorDb(): number {
    return this.noiseFloorDb;
  }

  reset() {
    this.ring.fill(0);
    this.filled = 0;
    this.noiseFloorDb = -120;
    this.initialized = false;
    this.sampleCount = 0;
    this.lastEventSample = -Infinity;
  }
}
