// Gemini Live-style streaming channel (browser -> backend -> Gemini).
//
// - Streams telemetry + ~1 JPEG frame/sec as visual evidence.
// - Supports request/response coaching over the same socket.
// - Carries no permanent credentials: the backend owns the API key.
//
// The live channel is best-effort. If it fails, the controller transparently
// falls back to the REST coaching endpoint, and local measurement is never
// blocked.

import { wsUrl } from "@/utils/config";
import type { CoachingRequest, CoachingResponse } from "./coaching-schema";

interface PendingCall {
  resolve: (v: CoachingResponse) => void;
  reject: (e: Error) => void;
  timer: number;
}

export class LiveClient {
  private ws: WebSocket | null = null;
  private pending = new Map<string, PendingCall>();
  private idCounter = 0;
  private onStatus: (open: boolean) => void;

  constructor(onStatus: (open: boolean) => void) {
    this.onStatus = onStatus;
  }

  open(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const ws = new WebSocket(wsUrl("/api/gemini/live/ws"));
        this.ws = ws;
        const fail = () => {
          this.onStatus(false);
          reject(new Error("live channel unavailable"));
        };
        ws.onopen = () => {
          this.onStatus(true);
          resolve();
        };
        ws.onmessage = (event) => {
          this.handleMessage(event.data as string);
        };
        ws.onclose = () => {
          this.onStatus(false);
          this.rejectAll(new Error("live channel closed"));
        };
        ws.onerror = () => {
          this.onStatus(false);
          fail();
        };
      } catch (err) {
        this.onStatus(false);
        reject(err instanceof Error ? err : new Error("live channel unavailable"));
      }
    });
  }

  isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private handleMessage(data: string) {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(data) as Record<string, unknown>;
    } catch {
      return;
    }
    const id = typeof msg.id === "string" ? msg.id : undefined;
    if (id && this.pending.has(id)) {
      const call = this.pending.get(id)!;
      this.pending.delete(id);
      clearTimeout(call.timer);
      if (msg.type === "coaching") {
        call.resolve(msg as unknown as CoachingResponse);
      } else {
        call.reject(new Error("coaching failed over live channel"));
      }
    }
  }

  private rejectAll(err: Error) {
    for (const [, call] of this.pending) {
      clearTimeout(call.timer);
      call.reject(err);
    }
    this.pending.clear();
  }

  coach(req: CoachingRequest, timeoutMs = 8000): Promise<CoachingResponse> {
    return new Promise((resolve, reject) => {
      const ws = this.ws;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        reject(new Error("live channel not open"));
        return;
      }
      const id = `c${++this.idCounter}`;
      const timer = window.setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("live coaching timeout"));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        ws.send(JSON.stringify({ type: "coach", id, request: req }));
      } catch (err) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error("send failed"));
      }
    });
  }

  sendTelemetry(payload: Record<string, unknown>) {
    if (!this.isOpen()) return;
    try {
      this.ws!.send(JSON.stringify({ type: "telemetry", ...payload }));
    } catch {
      /* ignore */
    }
  }

  sendFrame(jpeg: string) {
    if (!this.isOpen()) return;
    try {
      this.ws!.send(JSON.stringify({ type: "frame", jpeg }));
    } catch {
      /* ignore */
    }
  }

  close() {
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
    this.ws = null;
    this.rejectAll(new Error("live channel closed"));
  }
}
