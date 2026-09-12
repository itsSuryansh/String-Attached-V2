import type { CoachingHUD } from "@/types";

export function CoachingPanel({ hud }: { hud: CoachingHUD | null }) {
  if (!hud) {
    return (
      <div className="mission-card mission-card--idle">
        <div className="mission-label">MISSION</div>
        <div className="mission-text mission-text--muted">Waiting for coaching…</div>
      </div>
    );
  }

  if (hud.noIntervention) {
    return (
      <div className="mission-card">
        <div className="mission-label">MISSION</div>
        <div className="mission-text mission-text--muted">NO INTERVENTION</div>
        <div className="mission-sub">Your form looks good — keep going.</div>
      </div>
    );
  }

  const isFallback = hud.source === "deterministic-fallback";
  return (
    <div className="mission-card" data-source={hud.source}>
      <div className="mission-label">
        MISSION
        {isFallback && <span className="mission-fallback-tag">fallback</span>}
      </div>
      <div className="mission-text">{hud.correction}</div>
      {isFallback && <div className="mission-unavailable">GEMINI UNAVAILABLE</div>}
    </div>
  );
}
