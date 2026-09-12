// Hand tracking built on MediaPipe Hand Landmarker (21 landmarks per hand).

import {
  HandLandmarker,
  FilesetResolver,
  type HandLandmarkerResult,
  type NormalizedLandmark as MpNormalizedLandmark,
} from "@mediapipe/tasks-vision";
import type { Landmark3D, TrackingStatus, Vec2 } from "@/types";

const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
const WASM_PATH =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm";

export interface HandFrame {
  timestamp: number;
  /** 3D WORLD landmarks (meters) — used by the normalizer. */
  worldLandmarks: Landmark3D[];
  /** Normalized image landmarks (0..1) — used for drawing and motion. */
  imageLandmarks: Vec2[];
  /** Mean hand-center y in image space (for downstroke motion). */
  imageHandY: number;
  valid: boolean;
  confidence: number;
}

export type HandFrameCallback = (frame: HandFrame) => void;

export class HandTracker {
  private landmarker: HandLandmarker | null = null;
  private video: HTMLVideoElement | null = null;
  private rafId: number | null = null;
  private running = false;
  private lastVideoTime = -1;
  private onFrame: HandFrameCallback;
  private onStatus: (status: TrackingStatus) => void;
  private onError: (message: string) => void;

  constructor(
    onFrame: HandFrameCallback,
    onStatus: (status: TrackingStatus) => void,
    onError: (message: string) => void
  ) {
    this.onFrame = onFrame;
    this.onStatus = onStatus;
    this.onError = onError;
  }

  async initialize(video: HTMLVideoElement): Promise<void> {
    this.video = video;
    this.onStatus("loading");
    try {
      const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
      this.landmarker = await HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
        runningMode: "VIDEO",
        numHands: 1,
        minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
    } catch (err) {
      this.onError(
        "Failed to load the hand tracking model. Check your connection and retry."
      );
      this.onStatus("unavailable");
      throw err;
    }
    this.running = true;
    this.onStatus("calibrating");
    this.loop();
  }

  private loop = () => {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this.loop);
    this.processFrame();
  };

  private processFrame() {
    const video = this.video;
    const landmarker = this.landmarker;
    if (!video || !landmarker) return;
    if (video.readyState < 2 || video.videoWidth === 0) return;
    if (video.currentTime === this.lastVideoTime) return;
    this.lastVideoTime = video.currentTime;

    let result: HandLandmarkerResult;
    try {
      result = landmarker.detectForVideo(video, performance.now());
    } catch {
      this.onStatus("lost");
      return;
    }

    const now = performance.now();
    if (!result.landmarks || result.landmarks.length === 0) {
      this.onStatus("lost");
      this.onFrame({
        timestamp: now,
        worldLandmarks: [],
        imageLandmarks: [],
        imageHandY: 0,
        valid: false,
        confidence: 0,
      });
      return;
    }

    const rawImage = result.landmarks[0] as MpNormalizedLandmark[];
    const rawWorld = (result.worldLandmarks?.[0] ?? result.landmarks[0]) as
      | MpNormalizedLandmark[]
      | undefined;
    const world = (rawWorld ?? rawImage) as MpNormalizedLandmark[];

    const worldLandmarks: Landmark3D[] = world.map((l) => ({
      x: l.x,
      y: l.y,
      z: l.z,
      visibility: l.visibility,
    }));
    const imageLandmarks: Vec2[] = rawImage.map((l) => ({ x: l.x, y: l.y }));

    let ySum = 0;
    for (const p of imageLandmarks) ySum += p.y;
    const imageHandY = imageLandmarks.length ? ySum / imageLandmarks.length : 0;

    const confidence = meanVisibility(worldLandmarks);
    const valid = confidence >= 0.5 && worldLandmarks.length >= 21;

    this.onStatus(valid ? "tracking" : "insufficient");
    this.onFrame({
      timestamp: now,
      worldLandmarks,
      imageLandmarks,
      imageHandY,
      valid,
      confidence,
    });
  }

  stop() {
    this.running = false;
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    try {
      this.landmarker?.close();
    } catch {
      /* ignore */
    }
    this.landmarker = null;
    this.video = null;
    this.lastVideoTime = -1;
  }
}

function meanVisibility(landmarks: Landmark3D[]): number {
  if (landmarks.length === 0) return 0;
  let sum = 0;
  for (const l of landmarks) {
    sum += typeof l.visibility === "number" ? l.visibility : 0;
  }
  return sum / landmarks.length;
}
