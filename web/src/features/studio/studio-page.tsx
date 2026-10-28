import * as React from "react"
import {
  CheckIcon,
  LoaderIcon,
  PlayIcon,
  PlusIcon,
  RotateCcwIcon,
  SparklesIcon,
  SquareIcon,
} from "lucide-react"
import { toast } from "sonner"

import { PageHeader } from "@/components/page-header"
import { VerdictPill } from "@/components/verdict-pill"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { Dropzone } from "@/features/detective/dropzone"
import { useAIStatus } from "@/hooks/use-ai-status"
import {
  api,
  type InvestigationEvent,
  type MediaKind,
  type StudioTool,
  type Verdict,
} from "@/lib/api"
import { cn } from "@/lib/utils"
import { toneFor } from "@/lib/verdict-style"

import { StudioCanvas } from "./studio-canvas"
import { TOOL_META, deriveRuns } from "./studio-model"

const SUGGESTIONS = [
  "Where did this come from?",
  "Was a face swapped or edited?",
  "Would the verdict survive a WhatsApp forward?",
  "Is anything hidden in it?",
]

function kindOf(f: File): MediaKind {
  const major = f.type.split("/")[0]
  if (major === "image" || major === "video" || major === "audio") return major
  return /\.(txt|md|json)$/i.test(f.name) ? "text" : "unknown"
}

/**
 * Studio: describe what you want to know, place your own nodes, and let DeepSeek build the rest of the investigation
 * on a live canvas. Detectors decide the verdict through fusion and calibration; Studio's forensic nodes are advisory.
 */
export function StudioPage() {
  const ai = useAIStatus()
  const [tools, setTools] = React.useState<StudioTool[]>([])
  const [file, setFile] = React.useState<{
    file: File
    url: string
    kind: MediaKind
  } | null>(null)
  const [goal, setGoal] = React.useState("")
  const [picked, setPicked] = React.useState<string[]>([])
  const [events, setEvents] = React.useState<InvestigationEvent[]>([])
  const [status, setStatus] = React.useState<
    "idle" | "running" | "done" | "error"
  >("idle")
  const abort = React.useRef<AbortController | null>(null)

  React.useEffect(() => {
    api
      .studioTools()
      .then(setTools)
      .catch(() => toast.error("Could not load the Studio nodes"))
    return () => abort.current?.abort()
  }, [])

  const media = file?.kind
  const available = tools.filter((t) => !media || t.media.includes(media))
  const advisory = React.useMemo(
    () => new Set(tools.filter((t) => t.advisory).map((t) => t.name)),
    [tools]
  )

  const choose = (f: File) => {
    if (file) URL.revokeObjectURL(file.url)
    const kind = kindOf(f)
    setFile({ file: f, url: URL.createObjectURL(f), kind })
    setPicked((p) =>
      p.filter((n) => tools.find((t) => t.name === n)?.media.includes(kind))
    )
    setEvents([])
    setStatus("idle")
  }

  const toggle = (name: string) =>
    setPicked((p) =>
      p.includes(name) ? p.filter((n) => n !== name) : [...p, name]
    )

  const run = async () => {
    if (!file) return
    abort.current?.abort()
    const ctrl = new AbortController()
    abort.current = ctrl
    setEvents([])
    setStatus("running")
    try {
      await api.studioInvestigate(
        file.file,
        goal,
        picked,
        (e) => setEvents((prev) => [...prev, e]),
        ctrl.signal
      )
      setStatus("done")
    } catch (e) {
      if (ctrl.signal.aborted) {
        setStatus("idle")
        return
      }
      setEvents((prev) => [
        ...prev,
        { type: "error", text: (e as Error).message },
      ])
      setStatus("error")
    }
  }

  const stop = () => {
    abort.current?.abort()
    setStatus("idle")
  }

  const finished = status === "done" || status === "error"
  const runs = deriveRuns(picked, events, advisory).filter(
    (r) => !(finished && r.status === "queued") // picked nodes that did not apply were skipped
  )
  const verdictEv = events.find((e) => e.type === "verdict")
  const verdict: Verdict | undefined =
    verdictEv?.type === "verdict" ? verdictEv.verdict : undefined
  const explanation = events.find((e) => e.type === "explanation")
  const thoughts = events.filter((e) => e.type === "thought")
  const lastThought = thoughts.at(-1)
  const usingAI = Boolean(ai?.configured)
  const planner = {
    title: usingAI
      ? `AI planner · ${ai?.provider ?? "DeepSeek"}`
      : "Fixed plan",
    subtitle:
      status === "running" && !verdict
        ? lastThought?.type === "thought"
          ? lastThought.text
          : "Planning the investigation…"
        : thoughts.length
          ? `${thoughts.length} planning step${thoughts.length === 1 ? "" : "s"}`
          : usingAI
            ? "Plans around your question"
            : "AI not configured: standard checks",
    running: status === "running" && !verdict,
  }

  return (
    <div className="@container/main mx-auto grid w-full max-w-6xl grid-cols-1 gap-8 px-4 pt-10 pb-16">
      <PageHeader
        eyebrow="Insights · AI studio"
        title="Studio"
        description="Ask a question about any image, video, audio clip or text. The AI builds the investigation as nodes from our detectors and forensic tools; add your own nodes too. The verdict always comes from calibrated fusion, never from the AI."
      />

      <div className="grid items-start gap-6 @5xl/main:grid-cols-[19rem_minmax(0,1fr)]">
        <Card className="gap-5 bg-card/80 p-5">
          <section className="grid gap-2">
            <h2 className="eyebrow">1 · Evidence</h2>
            {file ? (
              <div className="flex items-center gap-3 rounded-lg border p-2">
                {file.kind === "image" ? (
                  <img
                    src={file.url}
                    alt=""
                    className="size-12 shrink-0 rounded-md object-cover outline outline-1 -outline-offset-1 outline-white/10"
                  />
                ) : (
                  <span className="grid size-12 shrink-0 place-items-center rounded-md bg-muted text-xs text-muted-foreground capitalize">
                    {file.kind}
                  </span>
                )}
                <div className="grid min-w-0 gap-0.5">
                  <span className="truncate text-sm font-medium">
                    {file.file.name}
                  </span>
                  <span className="text-xs text-muted-foreground capitalize">
                    {file.kind}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto"
                  disabled={status === "running"}
                  onClick={() => {
                    URL.revokeObjectURL(file.url)
                    setFile(null)
                    setEvents([])
                    setStatus("idle")
                  }}
                >
                  Change
                </Button>
              </div>
            ) : (
              <Dropzone onFile={choose} />
            )}
          </section>

          <section className="grid gap-2">
            <h2 className="eyebrow">2 · Your question</h2>
            <Textarea
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="e.g. Where did this photo come from, and was the face edited?"
              maxLength={500}
              rows={3}
              aria-label="What do you want to know about this file?"
            />
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setGoal(s)}
                  className="rounded-full border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-brand/60 hover:text-foreground"
                >
                  {s}
                </button>
              ))}
            </div>
          </section>

          <section className="grid gap-2">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="eyebrow">3 · Your nodes</h2>
              <span className="text-xs text-muted-foreground">
                {picked.length ? `${picked.length} added` : "optional"}
              </span>
            </div>
            <ul className="grid grid-cols-1 gap-1">
              {available.map((t) => {
                const meta = TOOL_META[t.name] ?? TOOL_META.unknown
                const core = media ? t.core.includes(media) : false
                const on = core || picked.includes(t.name)
                const Icon = meta.icon
                return (
                  <li key={t.name}>
                    <button
                      type="button"
                      disabled={core || status === "running"}
                      onClick={() => toggle(t.name)}
                      aria-pressed={on}
                      title={t.description}
                      className={cn(
                        "flex w-full items-center gap-2.5 rounded-md border px-2.5 py-2 text-left text-sm transition-colors",
                        on
                          ? "border-brand/50 bg-brand/10"
                          : "hover:bg-foreground/[0.04]",
                        core && "cursor-default opacity-70"
                      )}
                    >
                      <Icon
                        className="size-4 shrink-0 text-brand"
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {meta.label}
                      </span>
                      {t.advisory && (
                        <Badge
                          variant="outline"
                          className="rounded-full text-[10px]"
                        >
                          advisory
                        </Badge>
                      )}
                      {core ? (
                        <span className="text-[10px] text-muted-foreground">
                          always
                        </span>
                      ) : on ? (
                        <CheckIcon className="size-4 text-brand" aria-hidden />
                      ) : (
                        <PlusIcon
                          className="size-4 text-muted-foreground"
                          aria-hidden
                        />
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>

          {status === "running" ? (
            <Button variant="outline" onClick={stop}>
              <SquareIcon aria-hidden /> Stop
            </Button>
          ) : (
            <Button disabled={!file} onClick={() => void run()}>
              {finished ? (
                <RotateCcwIcon aria-hidden />
              ) : (
                <PlayIcon aria-hidden />
              )}
              {finished
                ? "Run again"
                : usingAI
                  ? "Investigate with AI"
                  : "Run checks"}
            </Button>
          )}
          <p className="text-xs text-pretty text-muted-foreground">
            {usingAI
              ? `${ai?.provider} reads only detector scores and our findings, never the file. Decoded payloads stay on this page.`
              : "AI is not configured, so the standard checks and your nodes run in a fixed order."}
          </p>
        </Card>

        <div className="grid min-w-0 gap-4">
          <StudioCanvas
            fileName={file?.file.name}
            media={media}
            runs={runs}
            planner={planner}
            verdict={verdict}
          />

          <div className="grid gap-4 @4xl/main:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <Card className="gap-3 bg-card/80 p-5">
              <h3 className="text-sm font-semibold">Investigation log</h3>
              {events.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {file
                    ? "Ready. Ask a question or add nodes, then run."
                    : "Drop a file to begin."}
                </p>
              ) : (
                <ol className="grid gap-2 text-sm" aria-live="polite">
                  {events.map((e, i) => {
                    if (e.type === "thought")
                      return (
                        <li
                          key={i}
                          className="flex enter gap-2 text-muted-foreground"
                        >
                          <SparklesIcon
                            className="mt-0.5 size-3.5 shrink-0 text-brand"
                            aria-hidden
                          />
                          <span className="text-pretty">{e.text}</span>
                        </li>
                      )
                    if (e.type === "tool")
                      return (
                        <li key={i} className="flex enter gap-2">
                          {events
                            .slice(i + 1)
                            .some(
                              (x) =>
                                x.type === "tool_result" && x.tool === e.tool
                            ) ? (
                            <CheckIcon
                              className="mt-0.5 size-3.5 shrink-0"
                              aria-hidden
                            />
                          ) : (
                            <LoaderIcon
                              className="mt-0.5 size-3.5 shrink-0 animate-spin"
                              aria-hidden
                            />
                          )}
                          <span>
                            {(TOOL_META[e.tool] ?? TOOL_META.unknown).label}
                          </span>
                        </li>
                      )
                    if (e.type === "verdict")
                      return (
                        <li
                          key={i}
                          className="flex enter flex-wrap items-center gap-2"
                        >
                          Fusion decided{" "}
                          <VerdictPill tone={toneFor(e.verdict)}>
                            {e.verdict.label}
                          </VerdictPill>
                          <span className="tabular-nums">
                            {Math.round(e.verdict.confidence * 100)}%
                          </span>
                        </li>
                      )
                    if (e.type === "error")
                      return (
                        <li key={i} className="text-fake">
                          {e.text}
                        </li>
                      )
                    return null
                  })}
                </ol>
              )}
            </Card>

            <Card className="gap-2 bg-card/80 p-5 text-sm">
              <h3 className="flex items-center gap-2 font-semibold">
                <SparklesIcon className="size-4 text-brand" aria-hidden />
                {explanation?.type === "explanation" && explanation.headline
                  ? explanation.headline
                  : "What the AI concluded"}
              </h3>
              {explanation?.type === "explanation" ? (
                <>
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
                </>
              ) : (
                <p className="text-muted-foreground">
                  The plain-language explanation appears here when the run
                  finishes. Click any node on the canvas for its evidence, maps
                  and decoded data.
                </p>
              )}
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}
