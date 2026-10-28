import * as React from "react"
import { CheckIcon, LoaderIcon, SparklesIcon } from "lucide-react"
import { toast } from "sonner"

import { VerdictPill } from "@/components/verdict-pill"
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

const SUGGESTIONS: { label: string; goal: string }[] = [
  { label: "Where's it from?", goal: "Where did this come from?" },
  { label: "Face edited?", goal: "Was a face swapped or edited?" },
  {
    label: "Survives WhatsApp?",
    goal: "Would the verdict survive a WhatsApp forward?",
  },
  { label: "Hidden data?", goal: "Is anything hidden in it?" },
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
    model: usingAI ? (ai?.provider ?? "DeepSeek") : "Fixed plan",
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
    // Full-bleed workspace (n8n): the canvas takes all the space under the top bar; the side panel scrolls itself.
    <div className="@container/main flex w-full flex-col gap-3 px-4 py-4 md:px-6 lg:h-[calc(100svh-4rem)] xl:px-10">
      <header className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <div className="flex items-baseline gap-3">
          <h1 className="font-heading text-2xl font-medium tracking-tight">
            Studio
          </h1>
          <span className="eyebrow">AI investigation canvas</span>
        </div>
        <p className="text-xs text-pretty text-muted-foreground">
          The AI plans the checks; calibrated fusion decides the verdict.
        </p>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[20rem_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col gap-4 lg:overflow-y-auto lg:pr-1 [&>*]:shrink-0">
          <Card className="gap-6 bg-card/80 p-5">
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
                <Dropzone onFile={choose} compact />
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
                    key={s.label}
                    type="button"
                    onClick={() => setGoal(s.goal)}
                    aria-pressed={goal === s.goal}
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-xs whitespace-nowrap transition-colors",
                      goal === s.goal
                        ? "border-brand/60 bg-brand/10 text-foreground"
                        : "text-muted-foreground hover:border-brand/60 hover:text-foreground"
                    )}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </section>

            <section className="grid gap-2">
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="eyebrow">3 · Nodes</h2>
                <span className="text-xs text-muted-foreground">
                  {picked.length ? `${picked.length} added by you` : "optional"}
                </span>
              </div>
              <p className="text-xs text-pretty text-muted-foreground">
                Add checks with{" "}
                <span className="font-medium text-foreground">+</span> on the
                canvas; the AI adds the rest while it investigates.
              </p>
            </section>

            <p className="text-xs text-pretty text-muted-foreground">
              {usingAI
                ? `${ai?.provider} reads only detector scores and our findings, never the file. Decoded payloads stay on this page.`
                : "AI is not configured, so the standard checks and your nodes run in a fixed order."}
            </p>
          </Card>
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
                            (x) => x.type === "tool_result" && x.tool === e.tool
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
        </aside>

        <div className="order-first h-[420px] min-w-0 lg:order-none lg:h-auto lg:min-h-0">
          <StudioCanvas
            fileName={file?.file.name}
            media={media}
            runs={runs}
            planner={planner}
            verdict={verdict}
            tools={tools}
            picked={picked}
            onToggle={toggle}
            action={{
              label:
                status === "running"
                  ? "Stop"
                  : finished
                    ? "Run again"
                    : usingAI
                      ? "Investigate with AI"
                      : "Run checks",
              onClick: status === "running" ? stop : () => void run(),
              disabled: !file && status !== "running",
              running: status === "running",
            }}
          />
        </div>
      </div>
    </div>
  )
}
