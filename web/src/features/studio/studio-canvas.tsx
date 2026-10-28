import "@xyflow/react/dist/style.css"

import * as React from "react"
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Panel,
  Position,
  ReactFlow,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react"
import { XIcon, type LucideIcon } from "lucide-react"

import { useTheme } from "@/components/theme-provider"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import type { MediaKind, Signal, Verdict } from "@/lib/api"
import { cn } from "@/lib/utils"
import { TONE_VAR, toneFor } from "@/lib/verdict-style"

import { TOOL_META, type ToolRun } from "./studio-model"

type Tone = "fake" | "real" | "unsure"
type StudioNodeData = {
  icon: LucideIcon
  title: string
  subtitle: string
  tone?: Tone
  running?: boolean
  queued?: boolean
  advisory?: boolean
  by?: ToolRun["by"]
  body?: string
  first?: boolean
  last?: boolean
  run?: ToolRun
}
type StudioNode = Node<StudioNodeData, "studio">

const HANDLE = "!size-2.5 !border-2 !border-background !bg-muted-foreground"
const BY_LABEL: Record<ToolRun["by"], string> = {
  ai: "AI added",
  you: "You added",
  core: "Always runs",
}
const pct = (x: number) => `${Math.round(x * 100)}%`

/** Tone of a finished tool: detector scores by the 0.5 call line; advisory checks only ever flag (unsure). */
function toneOf(run: ToolRun): Tone | undefined {
  if (run.status !== "done") return undefined
  if (run.advisory)
    return run.signals.some((s) => s.rank === "uncertain")
      ? "unsure"
      : undefined
  const scores = run.signals
    .map((s) => s.score)
    .filter((x): x is number => x != null)
  if (!scores.length) return undefined
  const top = Math.max(...scores)
  return top > 0.5 ? "fake" : top > 0.33 ? "unsure" : "real"
}

function summary(run: ToolRun): string {
  if (run.status === "queued") return "Waiting to run"
  if (run.status === "running") return "Running…"
  if (run.advisory) return run.signals[0]?.evidence ?? "Done"
  return run.signals
    .map(
      (s) =>
        `${s.name.replace(/ detector$/, "")} ${s.score == null ? "n/a" : pct(s.score)}`
    )
    .join(" · ")
}

function StudioNodeView({ data, selected }: NodeProps<StudioNode>) {
  const Icon = data.icon
  return (
    <div
      className={cn(
        "w-64 rounded-xl border-2 bg-card p-3 shadow-sm transition-[border-color,box-shadow,opacity] duration-150",
        data.advisory && "border-dashed",
        data.queued && "opacity-60",
        selected && "ring-2 ring-ring",
        data.running && "node-running"
      )}
      style={{
        borderColor: data.running
          ? "var(--brand)"
          : data.tone
            ? TONE_VAR[data.tone]
            : "var(--border)",
      }}
    >
      {!data.first && (
        <Handle type="target" position={Position.Left} className={HANDLE} />
      )}
      <div className="flex items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand/15 text-brand">
          <Icon className="size-4" aria-hidden />
        </span>
        <div className="grid min-w-0 gap-0.5">
          <span className="truncate text-sm font-semibold">{data.title}</span>
          <span className="truncate text-xs text-muted-foreground">
            {data.subtitle}
          </span>
        </div>
      </div>
      {(data.by || data.advisory) && (
        <div className="mt-2.5 flex flex-wrap gap-1">
          {data.by && (
            <Badge
              variant={data.by === "you" ? "default" : "secondary"}
              className="rounded-full text-[10px]"
            >
              {BY_LABEL[data.by]}
            </Badge>
          )}
          {data.advisory && (
            <Badge variant="outline" className="rounded-full text-[10px]">
              Advisory · never votes
            </Badge>
          )}
        </div>
      )}
      {data.body && (
        <p className="mt-2 line-clamp-2 text-xs text-pretty text-muted-foreground tabular-nums">
          {data.body}
        </p>
      )}
      {!data.last && (
        <Handle type="source" position={Position.Right} className={HANDLE} />
      )}
    </div>
  )
}

const nodeTypes = { studio: StudioNodeView }

/** Keep the whole graph framed as the AI adds nodes (a short, interruptible move, skipped for reduced motion). */
function FitOnGrow({ count }: { count: number }) {
  const { fitView } = useReactFlow()
  React.useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    const id = requestAnimationFrame(
      () => void fitView({ padding: 0.12, duration: reduce ? 0 : 200 })
    )
    return () => cancelAnimationFrame(id)
  }, [count, fitView])
  return null
}
const ROW = 150

/** Payloads only the page shows (they never go to the AI). Rendered as text, never as links. */
function Details({ signal }: { signal: Signal }) {
  const d = signal.details ?? {}
  const artifact = typeof d.artifact === "string" ? d.artifact : null
  const rows = Object.entries(d).filter(
    ([k, v]) => k !== "artifact" && v !== null && v !== "" && v !== false
  )
  return (
    <div className="grid gap-2">
      <p className="text-xs text-pretty text-muted-foreground">
        {signal.evidence}
      </p>
      {artifact && (
        <img
          src={artifact}
          alt={`${signal.name} map`}
          className="w-full rounded-md border bg-black"
        />
      )}
      {rows.length > 0 && (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
          {rows.map(([k, v]) => (
            <React.Fragment key={k}>
              <dt className="text-muted-foreground">{k.replace(/_/g, " ")}</dt>
              <dd className="font-mono break-words">
                {Array.isArray(v) ? v.join(" · ") : String(v)}
              </dd>
            </React.Fragment>
          ))}
        </dl>
      )}
    </div>
  )
}

export function StudioCanvas({
  fileName,
  media,
  runs,
  planner,
  verdict,
  height = 560,
}: {
  fileName?: string
  media?: MediaKind
  runs: ToolRun[]
  planner: { title: string; subtitle: string; running: boolean }
  verdict?: Verdict
  height?: number
}) {
  const { theme } = useTheme()
  const [selectedId, setSelectedId] = React.useState<string | null>(null)

  const { nodes, edges } = React.useMemo(() => {
    const mid = (Math.max(runs.length, 1) - 1) * (ROW / 2)
    const ns: StudioNode[] = [
      {
        id: "input",
        type: "studio",
        position: { x: 0, y: mid },
        data: {
          icon: TOOL_META.input.icon,
          title: "Input",
          subtitle: fileName
            ? `${fileName} · ${media}`
            : "Drop a file to start",
          first: true,
        },
      },
      {
        id: "planner",
        type: "studio",
        position: { x: 330, y: mid },
        data: {
          icon: TOOL_META.planner.icon,
          title: planner.title,
          subtitle: planner.subtitle,
          running: planner.running,
        },
      },
      ...runs.map((r, i): StudioNode => ({
        id: r.tool,
        type: "studio",
        position: { x: 660, y: i * ROW },
        data: {
          icon: (TOOL_META[r.tool] ?? TOOL_META.unknown).icon,
          title: (TOOL_META[r.tool] ?? TOOL_META.unknown).label,
          subtitle:
            r.status === "done" && r.seconds != null
              ? `${r.seconds.toFixed(1)} s`
              : r.why || "",
          tone: toneOf(r),
          running: r.status === "running",
          queued: r.status === "queued",
          advisory: r.advisory,
          by: r.by,
          body: summary(r),
          run: r,
        },
      })),
      {
        id: "verdict",
        type: "studio",
        position: { x: 990, y: mid },
        data: {
          icon: TOOL_META.verdict.icon,
          title: "Fusion and calibration",
          subtitle: verdict
            ? `${verdict.label.toUpperCase()} · ${pct(verdict.confidence)}`
            : "Decides the verdict",
          tone: verdict ? toneFor(verdict) : undefined,
          body: verdict
            ? `${verdict.votes} detector votes · ${verdict.reason_code}`
            : "Only detector results vote; advisory checks are shown, never fused.",
          last: true,
        },
      },
    ]
    const es: Edge[] = [
      {
        id: "e-in",
        source: "input",
        target: "planner",
        animated: planner.running,
      },
      ...runs.flatMap((r): Edge[] => [
        {
          id: `e-p-${r.tool}`,
          source: "planner",
          target: r.tool,
          animated: r.status === "running",
        },
        {
          id: `e-${r.tool}-v`,
          source: r.tool,
          target: "verdict",
          style: r.advisory
            ? { strokeDasharray: "5 5", opacity: 0.6 }
            : undefined,
          label: r.advisory ? "shown only" : undefined,
          labelStyle: { fontSize: 10 },
        },
      ]),
    ]
    return { nodes: ns, edges: es }
  }, [runs, planner, verdict, fileName, media])

  const selected = nodes.find((n) => n.id === selectedId)?.data.run

  return (
    <div
      className="overflow-hidden rounded-xl border bg-background/40"
      style={{ height }}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={(_, n) => setSelectedId(n.id)}
        onPaneClick={() => setSelectedId(null)}
        nodesConnectable={false}
        deleteKeyCode={null}
        colorMode={theme}
        fitView
        fitViewOptions={{ padding: 0.12 }}
        minZoom={0.2}
        aria-label="Studio investigation graph"
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} />
        <Controls showInteractive={false} />
        <FitOnGrow count={nodes.length} />
        {selected && selected.signals.length > 0 && (
          <Panel position="top-right">
            <Card className="max-h-[calc(var(--studio-h,560px)-2rem)] w-80 gap-3 overflow-y-auto bg-card/95 p-4 shadow-lg backdrop-blur">
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-sm font-semibold">
                  {(TOOL_META[selected.tool] ?? TOOL_META.unknown).label}
                </h3>
                <Button
                  variant="ghost"
                  size="icon"
                  className="-mt-1 -mr-2 size-7"
                  onClick={() => setSelectedId(null)}
                  aria-label="Close node details"
                >
                  <XIcon aria-hidden />
                </Button>
              </div>
              {selected.why && (
                <p className="text-xs text-pretty text-muted-foreground">
                  <span className="font-medium text-foreground">Why: </span>
                  {selected.why}
                </p>
              )}
              {selected.signals.map((s) => (
                <Details key={s.name} signal={s} />
              ))}
            </Card>
          </Panel>
        )}
      </ReactFlow>
    </div>
  )
}
