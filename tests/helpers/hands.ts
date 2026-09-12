// Test helpers: synthetic raw hand landmarks (re-exported from the shared
// canonical geometry so tests never diverge from the templates).

import type { Landmark3D } from "../../src/types";
import {
  buildRawAm,
  buildRawC,
  buildRawFist,
  buildRawNeutral,
  buildRawOpen,
} from "../../src/assets/templates/canonicalHands";

export const rawC = (): Landmark3D[] => buildRawC();
export const rawAm = (): Landmark3D[] => buildRawAm();
export const rawFist = (): Landmark3D[] => buildRawFist();
/** A "release" hand between chords (all fingers curled forward). */
export const rawNeutral = (): Landmark3D[] => buildRawNeutral();
/** An open, flat hand (all fingers extended). */
export const rawOpen = (): Landmark3D[] => buildRawOpen();
