import type { InterventionRecord } from "@/types";

const PRIORITY_LABELS: Record<string, string> = {
  hand_configuration: "Hand configuration",
  transition_speed: "Transition speed",
  strum_form: "Strum form",
  basketball_form: "Basketball form",
  squat_form: "Squat form",
  none: "No intervention",
};

const OUTCOME_COLORS: Record<string, string> = {
  IMPROVED: "#00ff66",
  UNCHANGED: "#8a8799",
  WORSE: "#ff007f",
  NOT_MEASURABLE: "#ffe600",
};

export function SessionHistory({
  history,
  compact = true,
}: {
  history: InterventionRecord[];
  compact?: boolean;
}) {
  if (history.length === 0) {
    return (
      <div className="history-empty">
        No interventions yet. Complete a coached attempt to build history.
      </div>
    );
  }

  const rows = compact ? history.slice(-4) : history;

  return (
    <div className="history-list">
      {rows.map((h, i) => {
        const color = OUTCOME_COLORS[h.outcome ?? ""] ?? "#8a8799";
        return (
          <div key={h.id} className="history-row">
            <div className="history-index">{history.length - (rows.length - i) + 0}</div>
            <div className="history-main">
              <div className="history-priority">
                {PRIORITY_LABELS[h.priority] ?? h.priority}
              </div>
              {h.correction && <div className="history-correction">“{h.correction}”</div>}
            </div>
            <div className="history-outcome" style={{ color }}>
              {h.outcome ?? "PENDING"}
              {h.delta !== null && h.delta !== undefined && h.outcome !== "NOT_MEASURABLE" && (
                <span className="history-delta">
                  {h.delta >= 0 ? "+" : ""}
                  {h.delta}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
