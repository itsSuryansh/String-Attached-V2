// Lightweight debug telemetry (used by the developer/debug panel only).
// Kept out of the primary UI.

import type { Metric } from "@/types";

export interface TelemetryEntry {
  t: number;
  phase: string;
  formMatch: number;
  trackingValid: boolean;
  metrics: Metric[];
}

export class Telemetry {
  private entries: TelemetryEntry[] = [];
  private latencies: number[] = [];

  push(entry: TelemetryEntry) {
    this.entries.push(entry);
    if (this.entries.length > 300) {
      this.entries = this.entries.slice(-300);
    }
  }

  recordLatency(ms: number) {
    this.latencies.push(ms);
    if (this.latencies.length > 60) {
      this.latencies = this.latencies.slice(-60);
    }
  }

  list(): TelemetryEntry[] {
    return this.entries.slice();
  }

  avgLatencyMs(): number | null {
    if (this.latencies.length === 0) return null;
    const sum = this.latencies.reduce((a, b) => a + b, 0);
    return Math.round(sum / this.latencies.length);
  }

  clear() {
    this.entries = [];
    this.latencies = [];
  }
}
