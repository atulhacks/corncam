import * as React from "react"
import { RotateCcwIcon } from "lucide-react"
import { toast } from "sonner"

import { PageHeader } from "@/components/page-header"
import { BorderBeam } from "@/components/ui/border-beam"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { AIExplainCard } from "@/features/ai/ai-explain-card"
import { PipelineTrace } from "@/features/pipeline/pipeline-trace"
import { api, type Verdict } from "@/lib/api"
import { toneFor, TONE_VAR } from "@/lib/verdict-style"
import { cn } from "@/lib/utils"

import { Dropzone } from "./dropzone"
import { EvidenceList } from "./evidence-list"
import { MediaPreview } from "./media-preview"
import { VerdictDock } from "./verdict-dock"

type Pending = { name: string; localUrl: string; kind: Verdict["media_kind"] }

function kindOf(file: File): Verdict["media_kind"] {
  const major = file.type.split("/")[0]
  if (major === "image" || major === "video" || major === "audio") return major
  if (major === "text" || /\.(txt|md)$/i.test(file.name)) return "text"
  return "unknown"
}

export function DetectivePage() {
  const [pending, setPending] = React.useState<Pending | null>(null)
  const [current, setCurrent] = React.useState<Verdict | null>(null)
  const [history, setHistory] = React.useState<Verdict[]>([])
  const abort = React.useRef<AbortController | null>(null)

  const analyse = async (file: File) => {
    abort.current?.abort()
    const ctrl = new AbortController()
    abort.current = ctrl
    setCurrent(null)
    setPending({
      name: file.name,
      localUrl: URL.createObjectURL(file),
      kind: kindOf(file),
    })
    try {
      const v = await api.detect(file, ctrl.signal)
      setCurrent(v)
      setHistory((h) =>
        [v, ...h.filter((x) => x.item_id !== v.item_id)].slice(0, 12)
      )
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        toast.error("Analysis failed", { description: (err as Error).message })
      }
    } finally {
      setPending(null)
    }
  }

  const reset = () => {
    abort.current?.abort()
    setPending(null)
    setCurrent(null)
  }

  const preview = current
    ? {
        url: current.media_url,
        kind: current.media_kind,
        name: current.filename,
      }
    : pending
      ? { url: pending.localUrl, kind: pending.kind, name: pending.name }
      : null

  return (
    <div className="@container/main mx-auto grid w-full max-w-[1600px] grid-cols-1 gap-8 px-4 pt-10 md:px-6 xl:px-10 pb-16">
      <PageHeader
        eyebrow="Forensics desk"
        title="Is it real?"
        description={
          <>
            Every verdict comes with its evidence, a calibrated confidence and
            the innocent explanation to rule out.
          </>
        }
      />

      <div className="grid items-start gap-6 @4xl/main:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
        <Card className="relative gap-4 overflow-hidden bg-card/80 p-4">
          {preview ? (
            <>
              <MediaPreview
                url={preview.url}
                kind={preview.kind}
                name={preview.name}
                signals={current?.signals}
              />
              <div className="flex items-center justify-between gap-3 px-1">
                <span className="truncate text-sm text-muted-foreground">
                  {preview.name}
                </span>
                <Button variant="outline" size="sm" onClick={reset}>
                  <RotateCcwIcon /> Analyse another
                </Button>
              </div>
            </>
          ) : (
            <Dropzone onFile={analyse} />
          )}
          {pending && (
            <BorderBeam
              size={120}
              duration={6}
              colorFrom="var(--brand)"
              colorTo="var(--fake)"
            />
          )}
        </Card>

        <div className="grid gap-4">
          {pending && <AnalysingState />}
          {current && (
            <>
              <VerdictDock v={current} />
              <Card className="bg-card/80 p-5">
                <h2 className="mb-2 text-sm font-semibold">Why</h2>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {current.reason_text}
                </p>
              </Card>
              <AIExplainCard verdict={current} />
              <EvidenceList signals={current.signals} />
              <PipelineTrace verdict={current} />
            </>
          )}
          {!pending && !current && <IdleState />}
        </div>
      </div>

      {history.length > 0 && (
        <section aria-label="This session" className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground">
            This session
          </h2>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {history.map((v) => (
              <button
                key={v.item_id}
                type="button"
                onClick={() => setCurrent(v)}
                className={cn(
                  "group relative size-24 shrink-0 overflow-hidden rounded-xl border bg-card focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                  current?.item_id === v.item_id && "ring-2 ring-brand"
                )}
                aria-label={`${v.filename}: ${v.label}, ${Math.round(v.confidence * 100)}% confidence`}
              >
                {v.media_kind === "image" ? (
                  <img
                    src={v.media_url}
                    alt=""
                    className="size-full object-cover"
                  />
                ) : (
                  <span className="grid size-full place-items-center p-2 text-xs text-muted-foreground">
                    {v.filename}
                  </span>
                )}
                <span
                  className="absolute inset-x-1 bottom-1 rounded-md px-1.5 py-0.5 text-center text-[10px] font-semibold text-background uppercase"
                  style={{ background: TONE_VAR[toneFor(v)] }}
                >
                  {v.label}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function AnalysingState() {
  return (
    <Card className="gap-4 bg-card/80 p-6" aria-busy="true">
      <div className="flex items-center gap-4">
        <Skeleton className="size-32 rounded-full" />
        <div className="grid flex-1 gap-2">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        Checking provenance · running detectors · fusing evidence…
      </p>
    </Card>
  )
}

function IdleState() {
  const steps = [
    [
      "Provenance",
      "Content Credentials, AI-tool metadata, generator watermark markers",
    ],
    [
      "Detectors",
      "Whole-image AI, face-swap and synthetic-voice detectors; video frame by frame",
    ],
    [
      "Fusion",
      "Detectors vote; weak or out-of-scope evidence can't convict alone",
    ],
    [
      "Explanation",
      "What was found, why it is unusual, and the innocent explanation",
    ],
  ]
  return (
    <Card className="bg-card/60 p-6">
      <CardContent className="grid gap-4 p-0">
        {steps.map(([title, body], i) => (
          <div key={title} className="flex gap-3">
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-brand/15 text-xs font-semibold text-brand">
              {i + 1}
            </span>
            <div>
              <p className="text-sm font-medium">{title}</p>
              <p className="text-sm text-muted-foreground">{body}</p>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
