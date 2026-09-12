// Real webcam lifecycle management.
//
// - requests permission
// - reports denial / unavailability distinctly
// - attaches exactly one MediaStream to a video element
// - stops all tracks and releases the stream on stop()

export type CameraStatus =
  | "idle"
  | "requesting"
  | "running"
  | "denied"
  | "unavailable"
  | "error";

export interface CameraStartResult {
  ok: boolean;
  status: CameraStatus;
  message?: string;
}

export class CameraManager {
  private stream: MediaStream | null = null;
  private status: CameraStatus = "idle";
  private onStatusChange: (status: CameraStatus) => void = () => {};

  setStatusListener(cb: (status: CameraStatus) => void) {
    this.onStatusChange = cb;
    cb(this.status);
  }

  getStatus(): CameraStatus {
    return this.status;
  }

  private setStatus(status: CameraStatus) {
    this.status = status;
    this.onStatusChange(status);
  }

  async start(video: HTMLVideoElement): Promise<CameraStartResult> {
    // Prevent multiple streams.
    this.stop();

    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices ||
      !navigator.mediaDevices.getUserMedia
    ) {
      this.setStatus("unavailable");
      return {
        ok: false,
        status: "unavailable",
        message: "Camera is not available in this browser.",
      };
    }

    this.setStatus("requesting");
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: "user",
        },
        audio: false,
      });
    } catch (err) {
      const name = err instanceof DOMException ? err.name : "";
      if (name === "NotAllowedError" || name === "SecurityError") {
        this.setStatus("denied");
        return {
          ok: false,
          status: "denied",
          message: "Please allow camera access and try again.",
        };
      }
      if (name === "NotFoundError" || name === "OverconstrainedError") {
        this.setStatus("unavailable");
        return {
          ok: false,
          status: "unavailable",
          message: "No usable camera was found.",
        };
      }
      this.setStatus("error");
      return {
        ok: false,
        status: "error",
        message: "The camera failed to start.",
      };
    }

    video.srcObject = this.stream;
    try {
      await video.play();
    } catch {
      // Some browsers require a user gesture; surface as unavailable.
      this.setStatus("unavailable");
      this.stop();
      return {
        ok: false,
        status: "unavailable",
        message: "Video playback was blocked. Tap to try again.",
      };
    }

    this.setStatus("running");
    return { ok: true, status: "running" };
  }

  stop() {
    try {
      this.stream?.getTracks().forEach((track) => track.stop());
    } catch {
      /* ignore */
    }
    this.stream = null;
    if (this.status !== "idle") {
      this.setStatus("idle");
    }
  }
}
