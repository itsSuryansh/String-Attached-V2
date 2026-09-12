import { useCallback, useState } from "react";
import type { Mode } from "@/types";
import { ModeSelector } from "@/components/ModeSelector";
import { TrainingScreen } from "@/components/TrainingScreen";

export default function App() {
  const [mode, setMode] = useState<Mode | null>(null);
  const [sessionKey, setSessionKey] = useState(0);

  const selectMode = useCallback((m: Mode) => {
    setMode(m);
    setSessionKey((k) => k + 1);
  }, []);

  const exit = useCallback(() => {
    setMode(null);
  }, []);

  const resetSession = useCallback(() => {
    setSessionKey((k) => k + 1);
  }, []);

  if (mode === null) {
    return <ModeSelector onSelect={selectMode} />;
  }

  return (
    <TrainingScreen
      key={`${mode}-${sessionKey}`}
      mode={mode}
      onExit={exit}
      onReset={resetSession}
    />
  );
}
