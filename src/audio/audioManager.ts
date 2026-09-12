// Main-thread microphone capture manager.
//
// - Requests microphone permission (never fakes status).
// - Creates an AudioContext + AudioWorklet that downsamples to 16 kHz mono.
// - Feeds the deterministic DownstrokeDetector.
// - Exposes transient events and error states.

import { DownstrokeDetector, type TransientEvent } from "./downstroke";

export type AudioStatus = "idle" | "starting" | "running" | "denied" | "error";

export interface AudioManagerOptions {
  onTransient: (event: TransientEvent) => void;
  onStatus: (status: AudioStatus) => void;
}

export class AudioManager {
  private context: AudioContext | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private stream: MediaStream | null = null;
  private detector = new DownstrokeDetector();
  private options: AudioManagerOptions;
  private status: AudioStatus = "idle";

  constructor(options: AudioManagerOptions) {
    this.options = options;
  }

  getStatus(): AudioStatus {
    return this.status;
  }

  getNoiseFloorDb(): number {
    return this.detector.getNoiseFloorDb();
  }

  private setStatus(status: AudioStatus) {
    this.status = status;
    this.options.onStatus(status);
  }

  async start(): Promise<void> {
    if (this.status === "running") return;

    if (typeof AudioContext === "undefined") {
      this.setStatus("error");
      throw new Error("This browser does not support the Web Audio API.");
    }

    this.setStatus("starting");
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
    } catch (err) {
      const name = err instanceof DOMException ? err.name : "";
      if (name === "NotAllowedError" || name === "SecurityError") {
        this.setStatus("denied");
        throw new Error("Microphone access denied.");
      }
      this.setStatus("error");
      throw new Error("Microphone unavailable.");
    }

    try {
      this.context = new AudioContext();
      await this.context.audioWorklet.addModule(
        new URL("./audio-processor.worklet.ts", import.meta.url)
      );
      const source = this.context.createMediaStreamSource(this.stream);
      this.workletNode = new AudioWorkletNode(
        this.context,
        "downsample-processor",
        { numberOfInputs: 1, numberOfOutputs: 0 }
      );
      this.workletNode.port.onmessage = (event: MessageEvent) => {
        const msg = event.data;
        if (msg && msg.type === "pcm") {
          const pcm = new Float32Array(msg.data as ArrayBuffer);
          const events = this.detector.push(pcm);
          for (const ev of events) this.options.onTransient(ev);
        }
      };
      source.connect(this.workletNode);
      this.setStatus("running");
    } catch {
      this.stop();
      this.setStatus("error");
      throw new Error("Failed to initialize audio analysis.");
    }
  }

  /** Reset the transient detector (e.g. between strum windows). */
  resetDetector() {
    this.detector.reset();
  }

  stop() {
    try {
      this.workletNode?.disconnect();
      this.workletNode = null;
    } catch {
      /* ignore */
    }
    try {
      this.stream?.getTracks().forEach((track) => track.stop());
      this.stream = null;
    } catch {
      /* ignore */
    }
    try {
      if (this.context && this.context.state !== "closed") {
        void this.context.close();
      }
    } catch {
      /* ignore */
    }
    this.context = null;
    this.setStatus("idle");
  }
}
