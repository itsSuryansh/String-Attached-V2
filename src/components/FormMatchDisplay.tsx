export function FormMatchDisplay({
  value,
  valid,
}: {
  value: number;
  valid: boolean;
}) {
  const clamped = Math.max(0, Math.min(100, Math.round(value)));
  const circumference = 2 * Math.PI * 30;
  const dash = (clamped / 100) * circumference;
  const color = valid
    ? clamped >= 80
      ? "#00ff66"
      : clamped >= 60
        ? "#ffe600"
        : "#ff007f"
    : "#3a3648";

  return (
    <div className="form-match">
      <div className="form-match-ring">
        <svg width="76" height="76" viewBox="0 0 76 76">
          <circle cx="38" cy="38" r="30" fill="none" stroke="#241f33" strokeWidth="6" />
          <circle
            cx="38"
            cy="38"
            r="30"
            fill="none"
            stroke={color}
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={`${dash} ${circumference}`}
            transform="rotate(-90 38 38)"
            style={{ transition: "stroke-dasharray 200ms linear, stroke 200ms linear" }}
          />
        </svg>
        <div className="form-match-value" style={{ color }}>
          {valid ? clamped : "—"}
        </div>
      </div>
      <div className="form-match-label">FORM MATCH</div>
    </div>
  );
}
