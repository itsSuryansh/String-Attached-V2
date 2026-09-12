# StringsAttached

An AI motor-skill coaching web app with three camera-based training modes:
**Ukulele** (C chord → Am → C→Am transition → downstroke), **Basketball**
(shooting form), and **Squats** (full-depth squat cycle).

> **Architectural principle (never reversed):** local computer vision owns **all
> measurement** — every number, timer, state transition, and outcome is computed
> deterministically in the browser. **Gemini** (via server-side credentials and
> ephemeral auth) owns **only coaching interpretation** — a single, concise HUD
> cue. Gemini can never invent a measurement, change a state, or declare an
> outcome.

## Stack

| Layer | Tech |
| --- | --- |
| Frontend | React 18 + TypeScript (strict) + Vite |
| Computer vision | MediaPipe Tasks Vision (browser) — 21 hand / 33 body landmarks |
| Audio | Web Audio API + AudioWorklet (16 kHz mono transient detection) |
| Backend | FastAPI (Python) — Gemini proxy with ephemeral session tokens |
| Tests | Vitest (frontend) + pytest (backend) |

## Run it

```bash
# 1. Backend (serves /api, proxies Gemini coaching)
python3 -m venv .venv && .venv/bin/pip install -r backend/requirements.txt
.venv/bin/uvicorn backend.main:app --host 0.0.0.0 --port 8000

# 2. Frontend (dev server proxies /api to :8000)
npm install
npm run dev        # http://localhost:5173
```

Gemini coaching is optional: without a `GEMINI_API_KEY` the app still runs end
to end (local tracking + measurement) and the coaching panel shows
**GEMINI UNAVAILABLE** plus a clearly labeled deterministic cue. To enable it:

```bash
# backend/.env  (server-side only — never shipped to the browser)
GEMINI_API_KEY=...
```

## Verification

```bash
npm run typecheck      # tsc -b --noEmit (clean)
npm run lint           # eslint (clean)
npm run test           # vitest — 81 tests
npm run build          # tsc -b && vite build
.venv/bin/pytest backend/tests/ -q   # 22 tests
npm run generate:templates           # deterministic chords.json from canonical geometry
```

## How it works

- **Measurement (browser, deterministic).** Hand/body landmarks are normalized
  with an exact, tested formula (translate by wrist P0, scale by max pairwise
  distance, rotate onto the `[u, v, w]` basis derived from P5/P9). Pose score is
  `100·clamp(1 − D/0.80)`. Each mode has a fixed state machine — invalid or
  uncalibrated frames never advance timers and never produce measurements.
- **Coaching (Gemini, interpreted).** The browser collects a baseline over the
  valid preceding 500 ms, then asks Gemini for **one** cue (≤ 6 words) with a
  priority (`hand_configuration`, `transition_speed`, `strum_form`,
  `basketball_form`, `squat_form`, or `none` = no intervention). Every response
  is validated; failures fall back to labeled deterministic cues.
- **Outcome (browser, deterministic).** After a human retry, the post
  measurement is compared to the baseline locally:
  `IMPROVED / UNCHANGED / WORSE / NOT_MEASURABLE`, using mode-specific targets.
- **Live channel.** A non-blocking WebSocket feeds ~1 JPEG frame/sec and
  20–100 ms audio evidence to the backend so Gemini latency never freezes
  tracking; the UI keeps rendering from local state at all times.

## Modes

- **Ukulele** — `IDLE → CALIBRATING → C_CHORD → C_STABLE → TRANSITIONING →
  AM_CANDIDATE → AM_STABLE → STRUM_DYNAMICS → LESSON_PASS`. C stable requires
  Form Match ≥ 80; the transition starts when the C pose drops below 60 and is
  invalidated after 5 s or 250 ms of tracking dropout; Am must hold ≥ 300 ms;
  the lesson needs 2 correlated downstrokes (visual + acoustic) within 10 s.
- **Basketball** — stance stability, knee flexion, elbow alignment, arm
  extension, and vertical motion. A static pose never counts as an attempt.
- **Squats** — a full stand → descend → bottom → ascend → stand cycle is
  required (knee/hip/torso angles, depth, symmetry). No static pose counted.

See `FINAL_REPORT.md` for the build verification report and real-issues
disclosure.
