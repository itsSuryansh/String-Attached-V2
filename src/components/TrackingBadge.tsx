import type { TrackingStatus } from "@/types";

const LABELS: Record<TrackingStatus, string> = {
  uninitialized: "STARTING",
  loading: "LOADING",
  calibrating: "CALIBRATING",
  tracking: "TRACKING",
  lost: "TRACKING LOST",
  insufficient: "INSUFFICIENT TRACKING",
  unavailable: "UNAVAILABLE",
};

const COLORS: Record<TrackingStatus, string> = {
  uninitialized: "#8a8799",
  loading: "#ffe600",
  calibrating: "#ffe600",
  tracking: "#00ff66",
  lost: "#ff007f",
  insufficient: "#ffe600",
  unavailable: "#ff007f",
};

export function TrackingBadge({ status }: { status: TrackingStatus }) {
  const color = COLORS[status];
  return (
    <span className="tracking-badge" style={{ color }}>
      <span className="tracking-dot" style={{ background: color }} />
      {LABELS[status]}
    </span>
  );
}
