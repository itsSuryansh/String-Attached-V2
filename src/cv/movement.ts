// Temporal movement detection helpers.
//
// A static person must never be classified as having completed a movement.
// These helpers compute velocities and detect direction changes from a stream
// of timestamped scalar samples.

export interface TimeSample {
  /** Timestamp in milliseconds. */
  t: number;
  v: number;
}

/** Rolling window tracker for a single scalar signal. */
export class ScalarTracker {
  private samples: TimeSample[] = [];
  constructor(private readonly windowMs = 700, private readonly maxSamples = 60) {}

  push(t: number, v: number) {
    this.samples.push({ t, v });
    const cutoff = t - this.windowMs;
    while (this.samples.length > 0 && this.samples[0].t < cutoff) {
      this.samples.shift();
    }
    if (this.samples.length > this.maxSamples) {
      this.samples.splice(0, this.samples.length - this.maxSamples);
    }
  }

  clear() {
    this.samples = [];
  }

  size(): number {
    return this.samples.length;
  }

  /** Least-squares velocity of the signal, in units per second. */
  velocityPerSec(): number | null {
    const n = this.samples.length;
    if (n < 2) return null;
    let sumT = 0;
    let sumV = 0;
    for (const s of this.samples) {
      sumT += s.t;
      sumV += s.v;
    }
    const meanT = sumT / n;
    const meanV = sumV / n;
    let num = 0;
    let den = 0;
    for (const s of this.samples) {
      const dt = s.t - meanT;
      num += dt * (s.v - meanV);
      den += dt * dt;
    }
    if (den === 0) return 0;
    // dt is in ms; convert slope to per-second.
    return (num / den) * 1000;
  }

  recentMin(): number {
    let m = Infinity;
    for (const s of this.samples) m = Math.min(m, s.v);
    return m === Infinity ? 0 : m;
  }

  recentMax(): number {
    let m = -Infinity;
    for (const s of this.samples) m = Math.max(m, s.v);
    return m === -Infinity ? 0 : m;
  }

  latest(): number | null {
    return this.samples.length > 0 ? this.samples[this.samples.length - 1].v : null;
  }

  samplesCopy(): TimeSample[] {
    return this.samples.slice();
  }
}

/**
 * Position stability: 100 when a set of 2D positions barely moves, 0 when the
 * spread (standard deviation of distance from centroid) reaches `spreadFull`.
 * `scale` normalizes against body size (e.g. torso length) so results are
 * camera-distance independent.
 */
export function positionStability(
  points: Array<{ x: number; y: number }>,
  scale: number
): number {
  const n = points.length;
  if (n < 2 || scale <= 0) return 0;
  let cx = 0;
  let cy = 0;
  for (const p of points) {
    cx += p.x;
    cy += p.y;
  }
  cx /= n;
  cy /= n;
  let sum = 0;
  for (const p of points) {
    const dx = p.x - cx;
    const dy = p.y - cy;
    sum += dx * dx + dy * dy;
  }
  const std = Math.sqrt(sum / n);
  // spreadFull is a fraction of body scale.
  const spreadFull = scale * 0.08;
  const ratio = std / spreadFull;
  return Math.max(0, Math.min(1, 1 - ratio)) * 100;
}
