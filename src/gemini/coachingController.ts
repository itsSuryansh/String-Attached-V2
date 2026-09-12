// The universal coaching loop controller.
//
//   WATCH -> MEASURE -> GEMINI COACHING -> HUMAN CORRECTION ->
//   MEASURE AGAIN -> OUTCOME -> ADAPT
//
// Local engines own every measurement and every state transition. This
// controller only (1) relays evidence to Gemini, (2) validates the response,
// (3) surfaces the HUD, and (4) classifies the locally-measured outcome.

import type {
  CoachingHUD,
  CoachingPriority,
  InterventionRecord,
  Mode,
  ModeEvent,
  Outcome,
} from "@/types";
import { classifyOutcome } from "@/state/outcome";
import { SessionStore } from "@/state/sessionStore";
import {
  DETERMINISTIC_CUES,
  buildCoachingPrompt,
  validateCoachingResponse,
  type CoachingRequest,
} from "./coaching-schema";
import { CoachingClient, type GeminiStatus } from "./coachingClient";
import { LiveClient } from "./live-client";

export interface ResultDisplay {
  before: number | null;
  after: number;
  delta: number;
  outcome: Outcome;
  priority: CoachingPriority;
  measurable: boolean;
}

export interface CoachingControllerCallbacks {
  onHUD: (hud: CoachingHUD | null) => void;
  onResult: (result: ResultDisplay) => void;
  onGeminiStatus: (status: GeminiStatus) => void;
  onHistory: (history: InterventionRecord[]) => void;
}

interface Pending {
  priority: CoachingPriority;
  baseline: number;
  state: string;
  mode: Mode;
}

export class CoachingController {
  private client: CoachingClient;
  private store: SessionStore;
  private cb: CoachingControllerCallbacks;
  private pending = new Map<string, Pending>();
  private corrections = new Map<string, { correction: string; source: string }>();
  private queue: Promise<void> = Promise.resolve();
  private geminiStatus: GeminiStatus = "idle";
  private live: LiveClient | null = null;

  constructor(
    client: CoachingClient,
    store: SessionStore,
    callbacks: CoachingControllerCallbacks
  ) {
    this.client = client;
    this.store = store;
    this.cb = callbacks;
  }

  async init() {
    this.setStatus("checking");
    const status = await this.client.fetchStatus();
    if (status.configured) {
      this.setStatus("ready");
    } else {
      this.setStatus("unavailable");
    }
  }

  private setStatus(status: GeminiStatus) {
    this.geminiStatus = status;
    this.cb.onGeminiStatus(status);
  }

  setLive(live: LiveClient | null) {
    this.live = live;
  }

  private requestCoaching(req: CoachingRequest): Promise<unknown> {
    if (this.live && this.live.isOpen()) {
      return this.live.coach(req).catch(() => this.client.requestCoaching(req));
    }
    return this.client.requestCoaching(req);
  }

  getStatus(): GeminiStatus {
    return this.geminiStatus;
  }

  reset() {
    this.pending.clear();
    this.corrections.clear();
    this.queue = Promise.resolve();
  }

  handleEvent(e: ModeEvent) {
    switch (e.type) {
      case "coaching":
        this.onCoaching(e);
        break;
      case "retry-complete":
        this.onRetryComplete(e);
        break;
      default:
        break;
    }
  }

  private onCoaching(e: Extract<ModeEvent, { type: "coaching" }>) {
    this.pending.set(e.attemptId, {
      priority: e.priority,
      baseline: e.baseline,
      state: e.state,
      mode: e.mode,
    });

    const request: CoachingRequest = {
      mode: e.mode,
      state: e.state,
      priority: e.priority,
      metrics: e.metrics,
      trackingStatus: "tracking",
      history: this.store.recent(8),
    };

    // Non-blocking: local tracking/measurement keeps running regardless of
    // Gemini latency. Responses are queued so they never race each other.
    this.queue = this.queue
      .then(() => this.requestCoaching(request))
      .then((raw) => {
        const result = validateCoachingResponse(raw);
        if (!result.ok) {
          this.applyFallback(e, "malformed response");
          return;
        }
        const decision = result.value;
        this.corrections.set(e.attemptId, {
          correction: decision.correction,
          source: "gemini",
        });
        this.cb.onHUD({
          priority: decision.priority,
          correction: decision.correction,
          noIntervention: decision.noIntervention,
          source: "gemini",
          state: e.state as CoachingHUD["state"],
          updatedAt: Date.now(),
        });
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : "unknown";
        this.applyFallback(e, msg === "gemini-unconfigured" ? "unconfigured" : "error");
      });
  }

  private applyFallback(
    e: Extract<ModeEvent, { type: "coaching" }>,
    reason: string
  ) {
    const cue = DETERMINISTIC_CUES[e.priority] || DETERMINISTIC_CUES.squat_form;
    this.corrections.set(e.attemptId, {
      correction: cue,
      source: "deterministic-fallback",
    });
    this.cb.onHUD({
      priority: e.priority,
      correction: cue,
      noIntervention: false,
      source: "deterministic-fallback",
      state: e.state as CoachingHUD["state"],
      updatedAt: Date.now(),
    });
    if (reason === "unconfigured" && this.geminiStatus !== "unavailable") {
      this.setStatus("unavailable");
    }
  }

  private onRetryComplete(e: Extract<ModeEvent, { type: "retry-complete" }>) {
    const pending = this.pending.get(e.attemptId);
    this.pending.delete(e.attemptId);

    const baseline = pending?.baseline ?? e.baseline;
    const delta = e.after - baseline;
    const outcome = classifyOutcome(delta, e.priority, e.measurable);
    const correctionInfo = this.corrections.get(e.attemptId) ?? {
      correction: "",
      source: "gemini",
    };

    const record: InterventionRecord = {
      id: e.attemptId,
      mode: e.mode,
      state: e.state,
      priority: e.priority,
      correction: correctionInfo.correction,
      source: correctionInfo.source as "gemini" | "deterministic-fallback",
      baseline: Math.round(baseline),
      after: Math.round(e.after),
      delta: Math.round(delta),
      outcome,
      timestamp: Date.now(),
    };

    this.store.add(record);
    this.cb.onHistory(this.store.list());
    this.cb.onResult({
      before: Math.round(baseline),
      after: Math.round(e.after),
      delta: Math.round(delta),
      outcome,
      priority: e.priority,
      measurable: e.measurable,
    });
  }

  history(): InterventionRecord[] {
    return this.store.list();
  }
}

export { buildCoachingPrompt };
