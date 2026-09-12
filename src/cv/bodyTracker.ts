// Body pose tracking built on MediaPipe Pose Landmarker.
// MediaPipe body-pose indices used here (0-indexed, Pose Landmarker):
//   11 left shoulder, 12 right shoulder,
//   13 left elbow, 14 right elbow, 15 left wrist, 16 right wrist,
//   23 left hip, 24 right hip, 25 left knee, 26 right knee,
//   27 left ankle, 28 right ankle.

import {
  PoseLandmarker,
  FilesetResolver,
  type PoseLandmarkerResult,
  type NormalizedLandmark as MpNormalizedLandmark,
} from "@mediapipe/tasks-vision";
import type { Landmark3D, TrackingStatus } from "@/types";

const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";
const WASM_PATH =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm";

export interface BodyFrame {
  timestamp: number;
  landmarks: Landmark3D[];
  /** True when landmarks are present and pass the validity filter. */
  valid: boolean;
  /** Mean visibility across tracked joints. */
  confidence: number;
}

export type BodyFrameCallback = (frame: BodyFrame) => void;

/**
 * Tracks body pose from a video element and hands frames to a callback.
 * The tracker is stateless aside from the underlying MediaPipe object.
 */
export class BodyTracker {
  private landmarker: PoseLandmarker | null = null;
  private video: HTMLVideoElement | null = null;
  private rafId: number | null = null;
  private running = false;
  private lastVideoTime = -1;
  private onFrame: BodyFrameCallback;
  private onStatus: (status: TrackingStatus) => void;
  private onError: (message: string) => void;

  constructor(
    onFrame: BodyFrameCallback,
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
      this.landmarker = await PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
        runningMode: "VIDEO",
        numPoses: 1,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
    } catch (err) {
      this.onError(
        "Failed to load the pose tracking model. Check your connection and retry."
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

    let result: PoseLandmarkerResult;
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
        landmarks: [],
        valid: false,
        confidence: 0,
      });
      return;
    }

    const raw = result.landmarks[0] as MpNormalizedLandmark[];
    const landmarks: Landmark3D[] = raw.map((l) => ({
      x: l.x,
      y: l.y,
      z: l.z,
      visibility: l.visibility,
    }));

    const confidence = meanVisibility(landmarks);
    const valid = confidence >= 0.5 && landmarks.length >= 33;

    this.onStatus(valid ? "tracking" : "insufficient");
    this.onFrame({ timestamp: now, landmarks, valid, confidence });
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
