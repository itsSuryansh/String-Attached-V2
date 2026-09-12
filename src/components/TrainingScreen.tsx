import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CoachingHUD,
  Mode,
  ModeSnapshot,
  TrackingStatus,
} from "@/types";
import { CameraManager, type CameraStatus } from "@/camera/cameraManager";
import { HandTracker, type HandFrame } from "@/cv/handTracker";
import { BodyTracker, type BodyFrame } from "@/cv/bodyTracker";
import { UkuleleEngine, type UkuleleFrame } from "@/modes/ukulele/ukuleleEngine";
import { BasketballEngine } from "@/modes/basketball/basketballEngine";
import { SquatEngine } from "@/modes/squats/squatEngine";
import { AudioManager, type AudioStatus } from "@/audio/audioManager";
import { CoachingClient, type GeminiStatus } from "@/gemini/coachingClient";
import {
  CoachingController,
  type ResultDisplay as CoachingResult,
} from "@/gemini/coachingController";
import { LiveClient } from "@/gemini/live-client";
import { SessionStore } from "@/state/sessionStore";
import { drawLandmarks, HAND_CONNECTIONS, POSE_CONNECTIONS } from "@/cv/drawing";
import { CameraView } from "./CameraView";
import { FormMatchDisplay } from "./FormMatchDisplay";
import { CoachingPanel } from "./CoachingPanel";
import { ResultDisplay } from "./ResultDisplay";
import { SessionHistory } from "./SessionHistory";

const MODE_LABELS: Record<Mode, string> = {
  ukulele: "UKULELE",
  basketball: "BASKETBALL",
  squats: "SQUATS",
};

const MODE_ACCENT: Record<Mode, string> = {
  ukulele: "#ff007f",
  basketball: "#00f0ff",
  squats: "#00ff66",
};

export function TrainingScreen({
  mode,
  onExit,
  onReset,
}: {
  mode: Mode;
  onExit: () => void;
  onReset: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const engineRef = useRef<UkuleleEngine | BasketballEngine | SquatEngine | null>(null);
  const trackerRef = useRef<HandTracker | BodyTracker | null>(null);
  const audioRef = useRef<AudioManager | null>(null);
  const cameraRef = useRef<CameraManager | null>(null);
  const controllerRef = useRef<CoachingController | null>(null);
  const liveRef = useRef<LiveClient | null>(null);
  const lastLiveFrameRef = useRef(0);

  const [cameraStatus, setCameraStatus] = useState<CameraStatus>("idle");
  const [trackingStatus, setTrackingStatus] = useState<TrackingStatus>("uninitialized");
  const [audioStatus, setAudioStatus] = useState<AudioStatus>("idle");
  const [geminiStatus, setGeminiStatus] = useState<GeminiStatus>("idle");
  const [snapshot, setSnapshot] = useState<ModeSnapshot | null>(null);
  const [hud, setHud] = useState<CoachingHUD | null>(null);
  const [result, setResult] = useState<CoachingResult | null>(null);
  const [history, setHistory] = useState<ReturnType<SessionStore["list"]>>([]);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [attemptCount, setAttemptCount] = useState(0);
  const [debug, setDebug] = useState(false);

  const uiTimerRef = useRef(0);

  const drawFrame = useCallback(
    (points: Array<{ x: number; y: number } | null>, mode: Mode) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const width = canvas.clientWidth || canvas.width;
      const height = canvas.clientHeight || canvas.height;
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, width, height);
      const connections = mode === "ukulele" ? HAND_CONNECTIONS : POSE_CONNECTIONS;
      drawLandmarks(ctx, points, connections, width, height, {
        color: MODE_ACCENT[mode],
        pointRadius: mode === "ukulele" ? 5 : 4,
        lineWidth: 2.5,
        glow: true,
      });
    },
    []
  );

  useEffect(() => {
    let cancelled = false;
    const camera = new CameraManager();
    const client = new CoachingClient();
    const store = new SessionStore();
    cameraRef.current = camera;
    controllerRef.current = new CoachingController(client, store, {
      onHUD: (h) => setHud(h),
      onResult: (r) => setResult(r),
      onGeminiStatus: (s) => setGeminiStatus(s),
      onHistory: (h) => setHistory(h),
    });

    setCameraStatus("idle");
    setTrackingStatus("uninitialized");
    setHud(null);
    setResult(null);
    setHistory([]);
    setCameraError(null);
    setAttemptCount(0);

    camera.setStatusListener((s) => {
      setCameraStatus(s);
      if (s === "running") setCameraError(null);
    });

    void (async () => {
      // Gemini status check is non-blocking.
      void controllerRef.current?.init();

      const video = videoRef.current;
      if (!video) return;
      const camResult = await camera.start(video);
      if (!camResult.ok) {
        setCameraError(camResult.message ?? "Camera unavailable.");
        return;
      }
      if (cancelled) {
        camera.stop();
        return;
      }

      // Build the engine first so tracker callbacks can feed it.
      if (mode === "ukulele") {
        engineRef.current = new UkuleleEngine();
      } else if (mode === "basketball") {
        engineRef.current = new BasketballEngine();
      } else {
        engineRef.current = new SquatEngine();
      }

      const engine = engineRef.current;
      engine.start();
      engine.onEvent((e) => {
        if (e.type === "coaching") setAttemptCount((n) => n + 1);
        if (e.type === "lesson-pass" || e.type === "strum") {
          // refresh snapshot promptly on strum / pass
        }
        controllerRef.current?.handleEvent(e);
        if (mode === "basketball" || mode === "squats") {
          if (e.type === "coaching") {
            const be = engine as BasketballEngine | SquatEngine;
            if ("acknowledgeCoaching" in be) be.acknowledgeCoaching();
          }
        }
      });

      // Tracker wiring.
      const onTrackingStatus = (s: TrackingStatus) => setTrackingStatus(s);
      const onTrackerError = (msg: string) => setCameraError(msg);

      const pushUi = (snap: ModeSnapshot) => {
        const now = performance.now();
        if (now - uiTimerRef.current >= 100) {
          uiTimerRef.current = now;
          setSnapshot(snap);
        }
      };

      if (mode === "ukulele") {
        const handTracker = new HandTracker(
          (frame: HandFrame) => {
            const uk = engine as UkuleleEngine;
            const ukFrame: UkuleleFrame = {
              timestampMs: frame.timestamp,
              landmarks: frame.worldLandmarks,
              imageHandY: frame.imageHandY,
              trackingValid: frame.valid,
            };
            uk.process(ukFrame);
            drawFrame(
              frame.imageLandmarks.map((p) => ({ x: p.x, y: p.y })),
              "ukulele"
            );
            pushUi(uk.getSnapshot());
          },
          onTrackingStatus,
          onTrackerError
        );
        trackerRef.current = handTracker;
        try {
          await handTracker.initialize(video);
        } catch {
          /* error surfaced via onTrackerError */
        }
      } else {
        const bodyTracker = new BodyTracker(
          (frame: BodyFrame) => {
            const be = engine as BasketballEngine | SquatEngine;
            be.process({
              timestampMs: frame.timestamp,
              landmarks: frame.landmarks,
              trackingValid: frame.valid,
            });
            drawFrame(
              frame.landmarks.map((l) => ({ x: l.x, y: l.y })),
              mode
            );
            pushUi(be.getSnapshot());
          },
          onTrackingStatus,
          onTrackerError
        );
        trackerRef.current = bodyTracker;
        try {
          await bodyTracker.initialize(video);
        } catch {
          /* error surfaced via onTrackerError */
        }
      }

      if (!cancelled) {
        startLiveStream(
          video,
          engine,
          lastLiveFrameRef,
          liveRef,
          controllerRef.current,
          mode
        );
      }
    })();

    return () => {
      cancelled = true;
      try {
        liveRef.current?.close();
      } catch {
        /* ignore */
      }
      liveRef.current = null;
      try {
        trackerRef.current?.stop();
      } catch {
        /* ignore */
      }
      trackerRef.current = null;
      try {
        audioRef.current?.stop();
      } catch {
        /* ignore */
      }
      audioRef.current = null;
      try {
        camera.stop();
      } catch {
        /* ignore */
      }
      cameraRef.current = null;
      engineRef.current = null;
    };
  }, [mode, drawFrame]);

  const startMic = useCallback(async () => {
    const engine = engineRef.current;
    if (!(engine instanceof UkuleleEngine)) return;
    const audio = new AudioManager({
      onTransient: (ev) => {
        engine.onAudioTransient({ timeMs: performance.now(), rmsDb: ev.rmsDb });
      },
      onStatus: (s) => setAudioStatus(s),
    });
    audioRef.current = audio;
    try {
      await audio.start();
    } catch {
      /* status updated via onStatus */
    }
  }, []);

  const retryCamera = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !cameraRef.current) return;
    const res = await cameraRef.current.start(video);
    if (!res.ok) setCameraError(res.message ?? "Camera unavailable.");
    else setCameraError(null);
  }, []);

  const snap = snapshot;
  const accent = MODE_ACCENT[mode];

  return (
    <div className="training" style={{ ["--accent" as string]: accent }}>
      <header className="training-header">
        <div className="training-brand" onClick={onExit}>
          StringsAttached
        </div>
        <div className="training-mode" style={{ color: accent }}>
          {MODE_LABELS[mode]}
        </div>
        <div className="training-status">
          <span
            className={`gemini-dot gemini-dot--${geminiStatus}`}
            title={`Gemini: ${geminiStatus}`}
          />
          Gemini {geminiStatus === "ready" ? "ONLINE" : geminiStatus === "unavailable" ? "OFFLINE" : "…"}
        </div>
        <button className="btn btn--ghost" onClick={onReset}>
          Reset
        </button>
        <button className="btn btn--ghost" onClick={onExit}>
          Modes
        </button>
      </header>

      <div className="training-main">
        <div className="camera-col">
          <CameraView
            videoRef={videoRef}
            canvasRef={canvasRef}
            trackingStatus={trackingStatus}
            hint={snap?.stateHint ?? "Starting…"}
            error={cameraError}
            onRetryCamera={retryCamera}
            active={cameraStatus === "running"}
          />

          <div className="lower-bar">
            <div className="lower-item">
              <span className="lower-label">STATE</span>
              <span className="lower-value">{snap?.phase ?? "—"}</span>
            </div>
            <div className="lower-item">
              <span className="lower-label">ATTEMPT</span>
              <span className="lower-value">{attemptCount}</span>
            </div>
            {mode === "ukulele" && (
              <div className="lower-item">
                <span className="lower-label">STRUMS</span>
                <span className="lower-value">
                  {typeof snap?.extras.strumCount === "number" ? snap.extras.strumCount : 0}/2
                </span>
              </div>
            )}
            <div className="lower-item lower-item--right">
              {mode === "ukulele" && (
                <button
                  className={`btn btn--small ${audioStatus === "running" ? "btn--mic-on" : ""}`}
                  onClick={startMic}
                  disabled={audioStatus === "running"}
                >
                  {audioStatus === "running"
                    ? "Mic On"
                    : audioStatus === "denied"
                      ? "Mic Denied — Retry"
                      : "Enable Mic"}
                </button>
              )}
              <button className="btn btn--small btn--ghost" onClick={() => setDebug((d) => !d)}>
                Debug
              </button>
            </div>
          </div>
        </div>

        <aside className="side-col">
          <div className="side-panel">
            <FormMatchDisplay
              value={snap?.formMatch ?? 0}
              valid={snap?.formMatchValid ?? false}
            />
            {snap && snap.formMatchValid === false && trackingStatus === "tracking" && (
              <div className="side-note">Awaiting a valid measurement</div>
            )}
          </div>

          <CoachingPanel hud={hud} />
          <ResultDisplay result={result} />

          {debug && (
            <div className="debug-panel">
              <div className="debug-title">DEBUG</div>
              <div className="debug-row">tracking: {trackingStatus}</div>
              <div className="debug-row">camera: {cameraStatus}</div>
              <div className="debug-row">gemini: {geminiStatus}</div>
              <div className="debug-row">audio: {audioStatus}</div>
              {snap?.metrics.map((m) => (
                <div key={m.key} className="debug-row">
                  {m.label}: {m.valid ? m.value : "—"}
                </div>
              ))}
            </div>
          )}
        </aside>
      </div>

      <footer className="history-section">
        <div className="history-title">SESSION</div>
        <SessionHistory history={history} />
      </footer>
    </div>
  );
}

function startLiveStream(
  video: HTMLVideoElement,
  engine: UkuleleEngine | BasketballEngine | SquatEngine,
  lastFrameRef: { current: number },
  liveRef: { current: LiveClient | null },
  controller: CoachingController | null,
  mode: Mode
) {
  const live = new LiveClient(() => {});
  liveRef.current = live;
  controller?.setLive(live);

  live
    .open()
    .then(() => {
      const sendTelemetry = () => {
        const snap = engine.getSnapshot();
        live.sendTelemetry({
          mode,
          phase: snap.phase,
          formMatch: snap.formMatch,
          metrics: snap.metrics,
        });
        const now = performance.now();
        // One JPEG per second as visual evidence.
        if (now - lastFrameRef.current > 1000) {
          lastFrameRef.current = now;
          try {
            const w = video.videoWidth || 320;
            const h = video.videoHeight || 240;
            const off = document.createElement("canvas");
            off.width = Math.min(w, 480);
            off.height = Math.round((off.width / Math.max(w, 1)) * h);
            const ctx = off.getContext("2d");
            if (ctx) {
              ctx.drawImage(video, 0, 0, off.width, off.height);
              const jpeg = off.toDataURL("image/jpeg", 0.6);
              live.sendFrame(jpeg);
            }
          } catch {
            /* ignore frame capture failures */
          }
        }
      };
      sendTelemetry();
      const id = window.setInterval(sendTelemetry, 1000);
      window.addEventListener("beforeunload", () => window.clearInterval(id));
    })
    .catch(() => {
      /* live channel is best-effort; REST fallback remains available */
    });
}
