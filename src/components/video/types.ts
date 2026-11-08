import type { Annotation } from "@/lib/annotations/schema";
import type { Rect } from "@/lib/annotations/geometry";

export type RecordingDTO = {
  id: string;
  title: string;
  status: string;
  ownerId: string;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  gameStartOffsetMs: number | null;
  minimapRegion: Rect | null;
  matchId: string | null;
  errorMessage: string | null;
  isDemo: boolean;
  owner: { id: string; displayName: string };
  match: { id: string; gameMode: string | null; durationSec: number; source: string; isDemo: boolean } | null;
};

export type Alternative = { label: string; conditions: string; limits: string };

export type RecommendationDTO = {
  id: string;
  kind: "MISTAKE" | "GOOD_ACTION" | "OBJECTIVE" | "FIGHT" | "MISSED_OPPORTUNITY" | "INTERESTING";
  category: string;
  title: string;
  contextStartMs: number;
  slowdownStartMs: number;
  decisionMs: number;
  endMs: number;
  slowdownRate: number;
  interpretation: string;
  alternatives: Alternative[];
  confidence: "LOW" | "MEDIUM" | "HIGH" | "INCONCLUSIVE";
  confidenceReason: string;
  advice: string;
  provenance: "MANUAL" | "AUTOMATIC";
  analysisVersion: string;
  status: "DRAFT" | "PUBLISHED" | "DISPUTED" | "REJECTED";
  contextSheetKey?: string | null;
  autoEvidence?: Record<string, unknown> | null;
  humanEdited?: boolean;
  clipId: string | null;
  createdAt: string;
  updatedAt: string;
  observations: { id: string; text: string; source: string; provenance: string; timeMs: number | null }[];
};

export type AnnotationDTO = Annotation & { createdAt?: string };
