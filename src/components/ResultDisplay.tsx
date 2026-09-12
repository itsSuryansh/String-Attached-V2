import type { Outcome } from "@/types";

export interface ResultView {
  before: number | null;
  after: number;
  delta: number;
  outcome: Outcome;
}

const OUTCOME_COLORS: Record<Outcome, string> = {
  IMPROVED: "#00ff66",
  UNCHANGED: "#8a8799",
  WORSE: "#ff007f",
  NOT_MEASURABLE: "#ffe600",
};

export function ResultDisplay({ result }: { result: ResultView | null }) {
  if (!result) return null;
  const color = OUTCOME_COLORS[result.outcome];
  return (
    <div className="result-card" style={{ borderColor: color }}>
      <div className="result-row">
        <div className="result-cell">
          <div className="result-label">BEFORE</div>
          <div className="result-value">{result.before ?? "—"}</div>
        </div>
        <div className="result-arrow">→</div>
        <div className="result-cell">
          <div className="result-label">AFTER</div>
          <div className="result-value">{result.after}</div>
        </div>
      </div>
      <div className="result-outcome" style={{ color }}>
        {result.outcome}
        {result.outcome !== "NOT_MEASURABLE" && (
          <span className="result-delta">
            {result.delta >= 0 ? "+" : ""}
            {result.delta}
          </span>
        )}
      </div>
    </div>
  );
}
