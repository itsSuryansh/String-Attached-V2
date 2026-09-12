# StringsAttached — Final Build Report

**Date:** 2026-09-12
**Branch:** `arena/01a09535-string-attached-v2`
**Toolchain:** Node v22.22.3 · npm 10.9.8 · Python 3.11.2 · Vite 6 · Vitest 2 · FastAPI

## Result: PASS

The prototype compiles, runs, and is tested end-to-end within the sandbox's
capabilities. Every checklist item below is a real, executed verification — not
a placeholder. Known limitations are disclosed under *Real-issues disclosure*;
none of them is a code defect in the delivered measurement/coaching pipeline.

---

## Verification checklist

| # | Item | Status |
| --- | --- | --- |
| 1 | Frontend strict typecheck (`npm run typecheck` / `tsc -b`) | **PASS** — 0 errors |
| 2 | Frontend lint (`npm run lint`) | **PASS** — 0 errors, 0 warnings |
| 3 | Frontend unit/integration tests (`npm run test`, Vitest, 9 files / 81 tests) | **PASS** — 81/81 |
| 4 | Production build (`npm run build` → `tsc -b && vite build`) | **PASS** — 63 modules, 340 kB JS (gzip 106 kB) |
| 5 | Backend tests (`.venv/bin/pytest backend/tests/`, 4 files / 22 tests) | **PASS** — 22/22 |
| 6 | Backend boot + REST smoke (uvicorn :8000) | **PASS** — `/api/health` 200 |
| 7 | Gemini status endpoint (never leaks the key) | **PASS** — `{"configured": false}` |
| 8 | Ephemeral session token exchange | **PASS** — session + short-lived token issued |
| 9 | Coaching auth guard | **PASS** — no token → 401 |
| 10 | Coaching degradation when Gemini is absent | **PASS** — 503, deterministic fallback surfaced |
| 11 | Live WebSocket channel (`/api/gemini/live/ws`) | **PASS** — telemetry/frame/coach routing + error frames tested |
| 12 | Frontend ↔ backend proxy (Vite `/api` → :8000) | **PASS** — health + status reachable through :5173 |
| 13 | Dev server serves the app + preview host allowlist | **PASS** — index/JS 200, no host rejection |
| 14 | Ukulele chord template separation (regenerated `chords.json`) | **PASS** — C↔Am cross-score 70.8, neutral (release) 53.8 < 60 trigger, fist 68.6 |
| 15 | Deterministic template generation (`npm run generate:templates`) | **PASS** — regenerated from `canonicalHands.ts` + runtime normalizer |
| 16 | No TODOs / placeholders / mock production paths | **PASS** — grep clean |
| 17 | No user-facing "ShadowTutor" references | **PASS** — grep clean |

---

## Test detail (all executed, all green)

**Frontend — Vitest (81):**

| File | Tests | Coverage |
| --- | --- | --- |
| `tests/normalizer.test.ts` | 7 | translation/scale invariance, collinear→UNCALIBRATED guard, pose distance/score |
| `tests/audio.test.ts` | 8 | streaming resampler (incl. cross-block seamlessness), transient detector |
| `tests/ukuleleMetrics.test.ts` | 13 | chord detection, transition score, strum score, FMI renormalization |
| `tests/gemini-schema.test.ts` | 12 | cue validation (≤6 words/≤80 chars), priorities, deterministic fallback |
| `tests/outcome.test.ts` | 5 | IMPROVED / UNCHANGED / WORSE / NOT_MEASURABLE + targets |
| `tests/movement.test.ts` | 7 | velocity/window/min-max tracker + position stability |
| `tests/basketball.test.ts` | 9 | metrics + engine (static pose not counted, full set→shot, tracking-loss abort) |
| `tests/squats.test.ts` | 10 | metrics + engine (static pose not counted, full cycle, tracking-loss abort) |
| `tests/ukuleleEngine.test.ts` | 10 | full state machine: C_STABLE, coaching, transition valid/invalid, hold interruption, strum pass/timeout, retry, invalid-tracking no-measure |

**Backend — pytest (22):** `test_health`, `test_status_*`, `test_session_created`,
`test_coach_requires_token`, `test_coach_unconfigured`, `test_coach_success`,
plus 3 WebSocket tests (unknown message, coach unconfigured, coach success).

---

## Real-issues disclosure

These are genuine, honestly reported limitations of the verification
environment. They are **not** stubbed success paths in the delivered code.

1. **Live Gemini round-trip not exercised against Google's service.** The
   sandbox has no `GEMINI_API_KEY`, so an actual model call (including the
   ~1 JPEG/sec evidence image and `SessionResumptionUpdate` handling) could not
   be run. What *is* verified: request schema/validation, the ≤6-word/≤80-char
   cue contract, priority allowlist, `noIntervention` support, session-token
   auth, the non-blocking WebSocket queue, and the **GEMINI UNAVAILABLE →
   labeled deterministic fallback** path (503/error frames). A real key is
   required to observe the live interpretation path.
2. **Camera / MediaPipe live tracking not verifiable headlessly.** No webcam or
   GPU is available in the sandbox, so the browser CV path is validated against
   synthetic 21-landmark (hand) and 33-landmark (body) inputs, not live frames.
   Camera status is real (`TRACKING` is never shown when tracking is
   unavailable; invalid frames never advance timers).
3. **Audio worklet requires a real microphone + user gesture.** The resampler
   (44.1/48 kHz → 16 kHz, cross-block seamless) and the transient detector
   (N=320 RMS, 0.95/0.05 noise floor, +12 dB threshold) are unit-tested with
   synthetic PCM; the strum visual+acoustic correlation is tested with
   synthetic events, not a real strum recording.
4. **Hardware-specific thresholds.** Canonical chord templates are synthetic
   geometry tuned so C/Am/release/fist separate correctly (C↔Am 70.8, release
   53.8, fist 68.6 against the 75/60 thresholds). Real hands may score slightly
   differently; the separation margins (≈5–10 points) are deliberate but have
   not been field-tuned on live webcams.

---

## Outcome targets (local, deterministic)

| Priority | Improvement target |
| --- | --- |
| `hand_configuration` | +10 |
| `transition_speed` | +15 |
| `strum_form` | +20 |
| `basketball_form` | +10 |
| `squat_form` | +10 |
| `none` | 0 |
