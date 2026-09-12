import type { Mode } from "@/types";

const MODES: Array<{
  id: Mode;
  emoji: string;
  title: string;
  subtitle: string;
  measures: string;
  accent: string;
}> = [
  {
    id: "ukulele",
    emoji: "🎸",
    title: "Ukulele",
    subtitle: "C → Am → Downstroke",
    measures: "Measures hand form, chord transitions, and strum timing with your camera and mic.",
    accent: "#ff007f",
  },
  {
    id: "basketball",
    emoji: "🏀",
    title: "Basketball",
    subtitle: "Shooting Form",
    measures: "Measures stance, knee bend, elbow alignment, and shooting-arm extension.",
    accent: "#00f0ff",
  },
  {
    id: "squats",
    emoji: "🏋️",
    title: "Squats",
    subtitle: "Squat Form",
    measures: "Measures depth, knee alignment, torso angle, and ascent control.",
    accent: "#00ff66",
  },
];

export function ModeSelector({ onSelect }: { onSelect: (mode: Mode) => void }) {
  return (
    <div className="mode-selector">
      <header className="brand">
        <h1 className="brand-title">StringsAttached</h1>
        <p className="brand-tagline">AI coaching that watches, measures, and adapts.</p>
      </header>

      <div className="mode-grid">
        {MODES.map((mode) => (
          <button
            key={mode.id}
            className="mode-card"
            style={{ ["--accent" as string]: mode.accent }}
            onClick={() => onSelect(mode.id)}
          >
            <div className="mode-card-emoji">{mode.emoji}</div>
            <div className="mode-card-title">{mode.title}</div>
            <div className="mode-card-subtitle">{mode.subtitle}</div>
            <div className="mode-card-measures">{mode.measures}</div>
            <div className="mode-card-cta">Train →</div>
          </button>
        ))}
      </div>

      <footer className="brand-foot">
        Camera-based · Measurement-driven · Gemini-coached
      </footer>
    </div>
  );
}
