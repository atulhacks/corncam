import {
  AudioLinesIcon,
  BinaryIcon,
  BlocksIcon,
  FileInputIcon,
  FilmIcon,
  FingerprintIcon,
  FlameIcon,
  GavelIcon,
  LayersIcon,
  ScanFaceIcon,
  ScanIcon,
  Share2Icon,
  ShieldCheckIcon,
  SparklesIcon,
  type LucideIcon,
} from "lucide-react"

import type { InvestigationEvent, Signal } from "@/lib/api"

/** Display name and icon for every Studio node (tool names match corncam.investigate). */
export const TOOL_META: Record<string, { label: string; icon: LucideIcon }> = {
  input: { label: "Input", icon: FileInputIcon },
  planner: { label: "AI planner", icon: SparklesIcon },
  verdict: { label: "Fusion and calibration", icon: GavelIcon },
  unknown: { label: "Check", icon: BlocksIcon },
  check_provenance: { label: "Provenance", icon: ShieldCheckIcon },
  scan_whole_image: { label: "Whole-image AI scan", icon: ScanIcon },
  check_faces: { label: "Face-forgery check", icon: ScanFaceIcon },
  scan_video_frames: { label: "Video frame scan", icon: FilmIcon },
  check_voice: { label: "Synthetic-voice check", icon: AudioLinesIcon },
  origin_metadata: { label: "Origin metadata", icon: FingerprintIcon },
  jpeg_forensics: { label: "Compression history", icon: LayersIcon },
  error_level: { label: "Error level analysis", icon: FlameIcon },
  hidden_data: { label: "Hidden-data decoders", icon: BinaryIcon },
  whatif_whatsapp: { label: "What-if: WhatsApp forward", icon: Share2Icon },
}

export interface ToolRun {
  tool: string
  /** who put this node on the canvas */
  by: "ai" | "you" | "core"
  status: "queued" | "running" | "done"
  advisory: boolean
  why: string
  signals: Signal[]
  seconds?: number
  cached?: boolean
}

const WHY_CORE = "Required check for this media type."
const WHY_YOU = "Requested by you on the canvas."

/**
 * Canvas state from the event stream. Nodes the person picked show as queued before the run starts; each tool keeps
 * its first author (so a node you added stays "You added" even if the AI also asks for it), and a deeper rerun
 * (e.g. 16 video frames) replaces the earlier result on the same node.
 */
export function deriveRuns(
  picked: string[],
  events: InvestigationEvent[],
  advisory: Set<string>
): ToolRun[] {
  const runs = new Map<string, ToolRun>()
  for (const tool of picked)
    runs.set(tool, {
      tool,
      by: "you",
      status: "queued",
      advisory: advisory.has(tool),
      why: "",
      signals: [],
    })
  for (const e of events) {
    if (e.type === "tool") {
      const prev = runs.get(e.tool)
      const by: ToolRun["by"] =
        prev?.by ??
        (e.why === WHY_CORE ? "core" : e.why === WHY_YOU ? "you" : "ai")
      runs.set(e.tool, {
        tool: e.tool,
        by,
        status: "running",
        advisory: advisory.has(e.tool),
        why: e.why,
        signals: prev?.signals ?? [],
      })
    } else if (e.type === "tool_result") {
      const prev = runs.get(e.tool)
      if (prev)
        runs.set(e.tool, {
          ...prev,
          status: "done",
          signals: e.signals,
          seconds: e.seconds,
          cached: e.cached,
        })
    }
  }
  return [...runs.values()]
}
