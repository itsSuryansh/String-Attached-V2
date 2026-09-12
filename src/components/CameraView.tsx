import type { RefObject } from "react";
import type { TrackingStatus } from "@/types";
import { ARCanvas } from "./ARCanvas";
import { TrackingBadge } from "./TrackingBadge";

interface CameraViewProps {
  videoRef: RefObject<HTMLVideoElement>;
  canvasRef: RefObject<HTMLCanvasElement>;
  trackingStatus: TrackingStatus;
  hint: string;
  error: string | null;
  onRetryCamera: () => void;
  active: boolean;
}

export function CameraView({
  videoRef,
  canvasRef,
  trackingStatus,
  hint,
  error,
  onRetryCamera,
  active,
}: CameraViewProps) {
  return (
    <div className={`camera ${active ? "camera--active" : ""}`}>
      <video
        ref={videoRef}
        className="camera-video"
        playsInline
        muted
        autoPlay
      />
      <ARCanvas ref={canvasRef} className="camera-canvas" />

      <div className="camera-topbar">
        <TrackingBadge status={trackingStatus} />
      </div>

      {!error && (
        <div className="camera-hint">
          <span>{hint}</span>
        </div>
      )}

      {error && (
        <div className="camera-error">
          <div className="camera-error-title">CAMERA UNAVAILABLE</div>
          <div className="camera-error-body">{error}</div>
          <button className="btn" onClick={onRetryCamera}>
            Retry Camera
          </button>
        </div>
      )}
    </div>
  );
}
