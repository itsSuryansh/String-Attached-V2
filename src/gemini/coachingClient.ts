// Backend → Gemini coaching client.
//
// The browser NEVER sees permanent Gemini credentials. It exchanges a session
// id for a short-lived token (handled server-side) and uses that for every
// coaching call. All requests are non-blocking and time out cleanly.

import { apiUrl } from "@/utils/config";
import type { CoachingRequest, CoachingResponse } from "./coaching-schema";

export type GeminiStatus =
  | "idle"
  | "checking"
  | "ready"
  | "unavailable"
  | "error";

export interface GeminiStatusInfo {
  configured: boolean;
}

export class CoachingClient {
  private token: string | null = null;
  private configured = false;

  async fetchStatus(): Promise<GeminiStatusInfo> {
    try {
      const res = await fetch(apiUrl("/api/gemini/status"), {
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return { configured: false };
      const data = (await res.json()) as { configured?: boolean };
      this.configured = Boolean(data.configured);
      return { configured: this.configured };
    } catch {
      this.configured = false;
      return { configured: false };
    }
  }

  isConfigured(): boolean {
    return this.configured;
  }

  private async ensureSession(): Promise<string> {
    if (this.token) return this.token;
    const res = await fetch(apiUrl("/api/gemini/session"), {
      method: "POST",
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error("coaching session unavailable");
    const data = (await res.json()) as { sessionId: string; token: string };
    this.token = data.token;
    return data.token;
  }

  /**
   * Request a coaching decision. Throws on network error, backend
   * unavailability, or timeout. Never blocks the local measurement loop.
   */
  async requestCoaching(
    req: CoachingRequest,
    timeoutMs = 8000
  ): Promise<CoachingResponse> {
    const token = await this.ensureSession();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(apiUrl("/api/gemini/coach"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Session-Token": token,
        },
        body: JSON.stringify(req),
        signal: controller.signal,
      });
      if (res.status === 503) {
        throw new Error("gemini-unconfigured");
      }
      if (!res.ok) {
        throw new Error(`coaching request failed (${res.status})`);
      }
      const data = (await res.json()) as CoachingResponse;
      return data;
    } finally {
      clearTimeout(timer);
    }
  }
}
