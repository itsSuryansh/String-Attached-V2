// Typed loader for the static ukulele chord templates.
// The JSON is generated at build time by scripts/generate-chord-templates.ts
// and lives in the same normalized coordinate space as runtime landmarks.

import raw from "./chords.json";
import type { NormalizedLandmark } from "@/types";

interface TemplatePayload {
  meta: {
    name: string;
    space: string;
    landmarkCount: number;
    generatedBy: string;
    note: string;
  };
  chords: {
    C: NormalizedLandmark[];
    Am: NormalizedLandmark[];
  };
}

const payload = raw as unknown as TemplatePayload;

export type ChordName = "C" | "Am";

export const CHORD_TEMPLATES: Record<ChordName, NormalizedLandmark[]> = {
  C: payload.chords.C,
  Am: payload.chords.Am,
};

export function getChordTemplate(name: ChordName): NormalizedLandmark[] {
  return CHORD_TEMPLATES[name];
}
