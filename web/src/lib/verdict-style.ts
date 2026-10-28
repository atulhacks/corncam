import {
  AudioLinesIcon,
  BrainCircuitIcon,
  ScanFaceIcon,
  ShieldCheckIcon,
  SparklesIcon,
  WavesIcon,
  type LucideIcon,
} from "lucide-react"

import type { Category, Rank, Verdict } from "@/lib/api"

export const TIER_COPY: Record<Verdict["tier"], string> = {
  high: "Substantial evidence of manipulation",
  uncertain: "Uncertain — could be authentic or manipulated",
  low: "Little evidence of manipulation",
}

export const CATEGORY_COPY: Record<Category, string> = {
  provenance: "Provenance",
  generative_ai: "Generative AI",
  faces: "Faces",
  visual_noise: "Visual noise",
  voice: "Voice",
  semantic: "Semantic",
}

export const CATEGORY_ICON: Record<Category, LucideIcon> = {
  provenance: ShieldCheckIcon,
  generative_ai: SparklesIcon,
  faces: ScanFaceIcon,
  visual_noise: WavesIcon,
  voice: AudioLinesIcon,
  semantic: BrainCircuitIcon,
}

/** How much a detector counts in the fused verdict (mirrors fusion._weight). */
export const POLICY_COPY: Record<"trust" | "include" | "ignore", string> = {
  trust: "2 votes",
  include: "1 vote",
  ignore: "Shown only",
}

/** Semantic colour per verdict state; text + colour, never colour alone. */
export function toneFor(
  v: Pick<Verdict, "label" | "tier">
): "fake" | "real" | "unsure" {
  if (v.tier === "uncertain") return "unsure"
  return v.label === "fake" ? "fake" : "real"
}

export const TONE_VAR = {
  fake: "var(--fake)",
  real: "var(--real)",
  unsure: "var(--unsure)",
} as const

export function rankTone(rank: Rank): "fake" | "real" | "unsure" | "muted" {
  if (rank === "high") return "fake"
  if (rank === "uncertain") return "unsure"
  if (rank === "low") return "real"
  return "muted"
}

export function confidenceWords(p: number): string {
  const c = Math.max(p, 1 - p)
  if (c >= 0.9) return "strong evidence"
  if (c >= 0.7) return "likely"
  return "leaning, not certain"
}
