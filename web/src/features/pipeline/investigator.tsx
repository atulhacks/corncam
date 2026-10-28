import * as React from "react"
import {
  CheckIcon,
  CpuIcon,
  FileInputIcon,
  GavelIcon,
  LoaderIcon,
  RotateCcwIcon,
  SparklesIcon,
  TriangleAlertIcon,
  type LucideIcon,
} from "lucide-react"

import { VerdictPill } from "@/components/verdict-pill"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Dropzone } from "@/features/detective/dropzone"
import { MediaPreview } from "@/features/detective/media-preview"
import { useAIStatus } from "@/hooks/use-ai-status"
import {
  api,
  type InvestigationEvent,
  type MediaKind,
  type Pipeline,
  type Signal,
  type Verdict,
} from "@/lib/api"
import { cn } from "@/lib/utils"
import { TONE_VAR, toneFor } from "@/lib/verdict-style"

import { PipelineCanvas, type LiveRun } from "./pipeline-canvas"

const TOOL_NAME: Record<string, string> = {
  check_provenance: "Provenance check",
  scan_whole_image: "Whole-image AI scan",
  check_faces: "Face-forgery check",
  scan_video_frames: "Video frame scan",
  check_voice: "Synthetic-voice check",
}
const pct = (x: number) => `${Math.round(x * 100)}%`

function kindOf(f: File): MediaKind {
  const major = f.type.split("/")[0]
  if (major === "image" || major === "video" || major === "audio") return major
  return f.name.match(/\.(txt|md|json)$/i) ? "text" : "unknown"
}

function argsText(tool: string, args: Record<string, unknown>) {
  if (tool === "scan_whole_image" && args.crops) return `${args.crops} crops`
  if (tool === "scan_video_frames" && args.frames)
    return `${args.frames} frames`
  if (tool === "check_faces" && args.include_advisory) return "+ advisory DF40"
  return ""
}

function LogRow({
  icon: Icon,
  tone,
  children,
  spinning,
}: {
  icon: LucideIcon
  tone?: string
  children: React.ReactNode
  spinning?: boolean
}) {
  return (
    <li className="grid enter grid-cols-[1.75rem_minmax(0,1fr)] gap-3">
      <span
        className="grid size-7 place-items-center rounded-full border bg-card"
        style={tone ? { color: tone, borderColor: tone } : undefined}
      >
        <Icon
          className={cn("size-3.5", spinning && "animate-spin")}
          aria-hidden
        />
      </span>
      <div className="min-w-0 pt-1 text-sm text-pretty">{children}</div>
    </li>
  )
}

/**
 * "Investigate with AI": DeepSeek plans which of our local detectors to run and reacts to their results; the canvas
 * lights up as each check runs. The verdict still comes from fusion and calibration, exactly as in the Detective.
 */
export function Investigator({ pipeline }: { pipeline: Pipeline }) {
  const ai = useAIStatus()
  const [file, setFile] = React.useState<{
    url: string
    kind: MediaKind
    name: string
  } | null>(null)
  const [events, setEvents] = React.useState<InvestigationEvent[]>([])
  const [status, setStatus] = React.useState<
    "idle" | "running" | "done" | "error"
  >("idle")
  const abort = React.useRef<AbortController | null>(null)

  React.useEffect(() => () => abort.current?.abort(), [])

  const start = async (f: File) => {
    abort.current?.abort()
    const ctrl = new AbortController()
    abort.current = ctrl
    if (file) URL.revokeObjectURL(file.url)
    setFile({ url: URL.createObjectURL(f), kind: kindOf(f), name: f.name })
    setEvents([])
    setStatus("running")
    try {
      await api.investigate(
        f,
        (e) => setEvents((prev) => [...prev, e]),
        ctrl.signal
      )
      setStatus("done")
    } catch (e) {
      if (ctrl.signal.aborted) return
      setEvents((prev) => [
        ...prev,
        { type: "error", text: (e as Error).message },
      ])
      setStatus("error")
    }
  }

  const reset = () => {
    abort.current?.abort()
    if (file) URL.revokeObjectURL(file.url)
    setFile(null)
    setEvents([])
    setStatus("idle")
  }

  // Derived live state for the canvas.
  const startEv = events.find((e) => e.type === "start")
  const media =
    (startEv?.type === "start" ? startEv.media_type : file?.kind) ?? "image"
  const spec =
    pipeline.media[media as keyof Pipeline["media"]] ?? pipeline.media.image
  const verdictEv = events.find((e) => e.type === "verdict")
  const verdict: Verdict | undefined =
    verdictEv?.type === "verdict" ? verdictEv.verdict : undefined
  const explanation = events.find((e) => e.type === "explanation")
  const live: LiveRun = React.useMemo(() => {
    const signals = new Map<string, Signal>()
    let running: string[] = []
    for (const e of events) {
      if (e.type === "tool") running = e.lanes
      if (e.type === "tool_result") {
        running = []
        for (const s of e.signals) signals.set(s.name, s)
      }
    }
    return { signals: [...signals.values()], running, filename: file?.name }
  }, [events, file?.name])

  if (status === "idle") {
    return (
      <div className="grid gap-4">
        <Dropzone onFile={(f) => void start(f)} />
        <p className="text-sm text-pretty text-muted-foreground">
          {ai?.configured
            ? `${ai.provider} (${ai.model}) plans the investigation and decides which checks to deepen. It never sees the media: our detectors run on this Mac and only their scores go to the AI. The verdict still comes from fusion and calibration.`
            : "AI is not configured, so the standard checks run in a fixed order. Add DEEPSEEK_API_KEY to .env to let the AI plan the investigation."}
        </p>
      </div>
    )
  }

  let openTool: string | null = null
  return (
    <div className="grid gap-4">
      <PipelineCanvas
        spec={spec}
        steps={pipeline.steps}
        verdict={verdict}
        live={verdict ? undefined : live}
        height={480}
      />
      <div className="grid gap-4 @4xl/main:grid-cols-[minmax(0,1fr)_22rem]">
        <Card className="gap-4 bg-card/80 p-5">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold">Investigation log</h3>
            <Button variant="outline" size="sm" onClick={reset}>
              <RotateCcwIcon aria-hidden /> Investigate another
            </Button>
          </div>
          <ol className="grid gap-3" aria-live="polite">
            {events.map((e, i) => {
              if (e.type === "start") {
                const facts = Object.entries(e.facts)
                  .filter(([k]) => k !== "media_type")
                  .map(([k, v]) => `${k.replace(/_/g, " ")} ${String(v)}`)
                  .join(" · ")
                return (
                  <LogRow key={i} icon={FileInputIcon}>
                    <span className="font-medium capitalize">
                      {e.media_type}
                    </span>{" "}
                    <span className="text-muted-foreground">{facts}</span>
                  </LogRow>
                )
              }
              if (e.type === "thought")
                return (
                  <LogRow key={i} icon={SparklesIcon} tone="var(--brand)">
                    <span className="text-muted-foreground">{e.text}</span>
                  </LogRow>
                )
              if (e.type === "tool") {
                openTool = e.tool
                const done = events
                  .slice(i + 1)
                  .some((x) => x.type === "tool_result" && x.tool === e.tool)
                return (
                  <LogRow
                    key={i}
                    icon={done ? CpuIcon : LoaderIcon}
                    spinning={!done}
                  >
                    <span className="font-medium">
                      {TOOL_NAME[e.tool] ?? e.tool}
                    </span>{" "}
                    <span className="text-muted-foreground">
                      {argsText(e.tool, e.args)}
                    </span>
                  </LogRow>
                )
              }
              if (e.type === "tool_result") {
                openTool = null
                return (
                  <li key={i} className="ml-10 flex enter flex-wrap gap-1.5">
                    {e.signals.map((s) => (
                      <span
                        key={s.name}
                        className="rounded-full border px-2 py-0.5 text-xs tabular-nums"
                        style={
                          s.score != null
                            ? {
                                borderColor:
                                  TONE_VAR[
                                    s.score > 0.5
                                      ? "fake"
                                      : s.score > 0.33
                                        ? "unsure"
                                        : "real"
                                  ],
                              }
                            : undefined
                        }
                      >
                        {s.name.replace(" detector", "")}{" "}
                        <span className="font-semibold">
                          {s.score == null ? "n/a" : pct(s.score)}
                        </span>
                      </span>
                    ))}
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {e.seconds.toFixed(1)}s
                    </span>
                  </li>
                )
              }
              if (e.type === "verdict")
                return (
                  <LogRow
                    key={i}
                    icon={GavelIcon}
                    tone={TONE_VAR[toneFor(e.verdict)]}
                  >
                    Fusion and calibration decided{" "}
                    <VerdictPill tone={toneFor(e.verdict)}>
                      {e.verdict.label}
                    </VerdictPill>{" "}
                    <span className="tabular-nums">
                      {pct(e.verdict.confidence)}
                    </span>{" "}
                    <code className="text-xs text-muted-foreground">
                      {e.verdict.reason_code}
                    </code>
                  </LogRow>
                )
              if (e.type === "error")
                return (
                  <LogRow key={i} icon={TriangleAlertIcon} tone="var(--fake)">
                    <span className="text-fake">{e.text}</span>
                  </LogRow>
                )
              if (e.type === "done")
                return (
                  <LogRow key={i} icon={CheckIcon}>
                    <span className="text-muted-foreground">
                      Investigation complete.
                    </span>
                  </LogRow>
                )
              return null
            })}
            {status === "running" && !openTool && !verdict && (
              <LogRow icon={LoaderIcon} spinning>
                <span className="text-muted-foreground">Thinking…</span>
              </LogRow>
            )}
          </ol>
        </Card>
        <div className="grid content-start gap-4">
          {file && (
            <MediaPreview
              url={file.url}
              kind={file.kind}
              name={file.name}
              signals={verdict?.signals}
            />
          )}
          {explanation?.type === "explanation" && (
            <Card className="gap-2 bg-card/80 p-5 text-sm">
              <h3 className="flex items-center gap-2 font-semibold">
                <SparklesIcon className="size-4 text-brand" aria-hidden />
                {explanation.headline ?? "Why"}
              </h3>
              <p className="leading-relaxed text-pretty text-muted-foreground">
                {explanation.explanation}
              </p>
              {explanation.caveat && (
                <p className="text-xs text-pretty text-muted-foreground">
                  <span className="font-medium text-foreground">
                    Could be wrong if:{" "}
                  </span>
                  {explanation.caveat}
                </p>
              )}
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
