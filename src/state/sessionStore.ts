// Session-local intervention history (in-memory only).
//
// Every intervention records the coaching it produced and the locally measured
// outcome. Gemini receives this history so it can adapt future coaching.

import type { InterventionRecord } from "@/types";

export class SessionStore {
  private interventions: InterventionRecord[] = [];

  add(record: InterventionRecord) {
    this.interventions.push(record);
    // Cap in-memory history to avoid unbounded growth.
    if (this.interventions.length > 100) {
      this.interventions = this.interventions.slice(-100);
    }
  }

  list(): InterventionRecord[] {
    return this.interventions.slice();
  }

  recent(n = 10): InterventionRecord[] {
    return this.interventions.slice(-n);
  }

  clear() {
    this.interventions = [];
  }
}
