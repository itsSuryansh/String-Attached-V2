import { forwardRef } from "react";

/**
 * Transparent canvas layered over the live camera. Landmarks are drawn here
 * every frame by the tracking loop (no React re-renders per frame).
 */
export const ARCanvas = forwardRef<HTMLCanvasElement, { className?: string }>(
  function ARCanvas({ className }, ref) {
    return <canvas ref={ref} className={className} />;
  }
);
