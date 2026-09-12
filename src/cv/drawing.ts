// Canvas drawing helpers for landmark overlays.

import type { Vec2 } from "@/types";

export const HAND_CONNECTIONS: Array<[number, number]> = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  [5, 9],
  [9, 10],
  [10, 11],
  [11, 12],
  [9, 13],
  [13, 14],
  [14, 15],
  [15, 16],
  [13, 17],
  [17, 18],
  [18, 19],
  [19, 20],
  [0, 17],
];

export const POSE_CONNECTIONS: Array<[number, number]> = [
  [11, 12],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
  [11, 23],
  [12, 24],
  [23, 24],
  [23, 25],
  [24, 26],
  [25, 27],
  [26, 28],
];

export interface DrawOptions {
  color: string;
  pointRadius: number;
  lineWidth: number;
  glow?: boolean;
}

export const DEFAULT_DRAW_OPTIONS: DrawOptions = {
  color: "#00f0ff",
  pointRadius: 4,
  lineWidth: 2.5,
  glow: true,
};

export function drawLandmarks(
  ctx: CanvasRenderingContext2D,
  points: Array<Vec2 | null>,
  connections: Array<[number, number]>,
  width: number,
  height: number,
  options: DrawOptions = DEFAULT_DRAW_OPTIONS
) {
  const px = (i: number): Vec2 | null => {
    const p = points[i];
    if (!p) return null;
    return { x: p.x * width, y: p.y * height };
  };

  ctx.save();
  ctx.lineWidth = options.lineWidth;
  ctx.strokeStyle = options.color;
  ctx.fillStyle = options.color;
  if (options.glow) {
    ctx.shadowColor = options.color;
    ctx.shadowBlur = 8;
  }

  ctx.beginPath();
  for (const [a, b] of connections) {
    const pa = px(a);
    const pb = px(b);
    if (!pa || !pb) continue;
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
  }
  ctx.stroke();

  for (let i = 0; i < points.length; i++) {
    const p = px(i);
    if (!p) continue;
    ctx.beginPath();
    ctx.arc(p.x, p.y, options.pointRadius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
