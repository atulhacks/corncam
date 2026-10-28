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
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react"
import {
  CpuIcon,
  FileInputIcon,
  GavelIcon,
  ScaleIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { useTheme } from "@/components/theme-provider"
import { ScoreMeter } from "@/features/detective/evidence-list"
import type {
  Pipeline,
  PipelineLane,
  PipelineMedia,
  Signal,
  Verdict,
} from "@/lib/api"
import { cn } from "@/lib/utils"
import {
  CATEGORY_ICON,
  POLICY_COPY,
  rankTone,
  TONE_VAR,
  toneFor,
} from "@/lib/verdict-style"

type Tone = "fake" | "real" | "unsure" | "muted"
type Detail = { label: string; value: string }

type Common = {
  title: string
  subtitle: string
  icon: LucideIcon
  traced: boolean
  tone?: Tone
  /** a detector in this node is running right now (live investigation) */
  running?: boolean
  details: Detail[]
}
type StepData = Common & { result?: string; first?: boolean; last?: boolean }
type LaneData = Common & {
  rows: { name: string; policy: Signal["policy"]; signal?: Signal }[]
}
type StepNode = Node<StepData, "step">
type LaneNode = Node<LaneData, "lane">
type FlowNode = StepNode | LaneNode

const pct = (x: number) => `${Math.round(x * 100)}%`
/** A detector that produced a score for this item (not n/a, not skipped). */
const ran = (s?: Signal): boolean => s != null && s.score != null
const toneColor = (t?: Tone) =>
  t && t !== "muted" ? TONE_VAR[t] : "var(--muted-foreground)"
const HANDLE = "!size-2.5 !border-2 !border-background !bg-muted-foreground"

/** Node frame shared by both node kinds: n8n-style card, border coloured by the traced result. */
function Frame({
  data,
  selected,
  width,
  first,
  last,
  children,
}: {
  data: Common
  selected: boolean
  width: string
  first?: boolean
  last?: boolean
  children?: React.ReactNode
}) {
  const Icon = data.icon
  return (
    <div
      className={cn(
        "rounded-xl border-2 bg-card p-3 shadow-sm transition-[border-color,box-shadow]",
        width,
        selected && "ring-2 ring-ring",
        data.running && "node-running"
      )}
      style={{
        borderColor: data.running
          ? "var(--brand)"
          : data.traced && data.tone && data.tone !== "muted"
            ? TONE_VAR[data.tone]
            : "var(--border)",
      }}
    >
      {!first && (
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
      {children}
      {!last && (
        <Handle type="source" position={Position.Right} className={HANDLE} />
      )}
    </div>
  )
}

function StepNodeView({ data, selected }: NodeProps<StepNode>) {
  return (
    <Frame
      data={data}
      selected={selected}
      width="w-52"
      first={data.first}
      last={data.last}
    >
      {data.traced && data.result && (
        <p className="mt-2.5 truncate text-xs font-medium tabular-nums">
          {data.result}
        </p>
      )}
    </Frame>
  )
}

/** A lane: one category of evidence, its detectors as rows (n8n node with sub-items). */
function LaneNodeView({ data, selected }: NodeProps<LaneNode>) {
  return (
    <Frame data={data} selected={selected} width="w-72">
      <div className="mt-3 grid gap-2.5">
        {data.rows.map((r) => (
          <div
            key={r.name}
            className={cn(
              "grid gap-1",
              data.traced && !ran(r.signal) && "opacity-50"
            )}
          >
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="min-w-0 truncate font-medium">{r.name}</span>
              <span className="flex shrink-0 items-center gap-1.5">
                {data.traced && (
                  <span className="text-muted-foreground tabular-nums">
                    {ran(r.signal) ? (
                      <span className="font-semibold text-foreground">
                        {pct(r.signal!.score!)}
                      </span>
                    ) : r.signal ? (
                      "n/a"
                    ) : (
                      "not run"
                    )}
                  </span>
                )}
                <Badge
                  variant="outline"
                  className="rounded-full px-1.5 text-[10px]"
                >
                  {POLICY_COPY[r.policy]}
                </Badge>
              </span>
            </div>
            {data.traced && r.signal && ran(r.signal) && (
              <ScoreMeter signal={r.signal} />
            )}
          </div>
        ))}
      </div>
    </Frame>
  )
}

const nodeTypes = { step: StepNodeView, lane: LaneNodeView }

// Columns (x) and the vertical gap between lane nodes; lane height grows with its rows.
const X = { input: 0, lanes: 290, fusion: 660, calibration: 930, verdict: 1200 }
const LANE_HEADER = 64
const LANE_ROW = 30
const LANE_ROW_TRACED = 40
const LANE_GAP = 28

/** The lane's strongest voting result decides its colour; shown-only detectors never colour a lane. */
function laneTone(lane: PipelineLane, byName: Map<string, Signal>): Tone {
  const voting = lane.detectors
    .filter((d) => d.policy !== "ignore")
    .map((d) => byName.get(d.name))
    .filter((s): s is Signal => ran(s))
  if (voting.length === 0) return "muted"
  const top = voting.reduce((a, b) => (b.score! > a.score! ? b : a))
  return rankTone(top.rank)
}

/** A live investigation in progress: detectors finished so far and the lanes running now. */
export type LiveRun = {
  signals: Signal[]
  running: string[]
  filename?: string
}

function buildGraph(
  spec: PipelineMedia,
  steps: Pipeline["steps"],
  verdict: Verdict | undefined,
  live?: LiveRun
): { nodes: FlowNode[]; edges: Edge[] } {
  const traced = verdict != null || live != null
  const waiting =
    live != null && verdict == null ? "waiting for detectors…" : undefined
  const byName = new Map(
    (verdict?.signals ?? live?.signals ?? []).map((s) => [s.name, s])
  )
  const rowH = traced ? LANE_ROW_TRACED : LANE_ROW

  let y = 0
  const laneNodes: LaneNode[] = spec.lanes.map((lane) => {
    const node: LaneNode = {
      id: `lane-${lane.category}`,
      type: "lane",
      position: { x: X.lanes, y },
      data: {
        title: lane.title,
        subtitle: lane.question,
        icon: CATEGORY_ICON[lane.category],
        traced,
        running:
          verdict == null && (live?.running ?? []).includes(lane.category),
        tone: traced ? laneTone(lane, byName) : undefined,
        rows: lane.detectors.map((d) => ({
          name: d.name,
          policy: d.policy,
          signal: byName.get(d.name),
        })),
        details: lane.detectors.map((d) => {
          const s = byName.get(d.name)
          const found = !traced
            ? ""
            : s && ran(s)
              ? ` This item: ${pct(s.score!)} (${s.rank}). ${s.evidence}`
              : s
                ? ` This item: did not apply. ${s.evidence}`
                : " This item: did not run."
          return {
            label: `${d.name} · ${POLICY_COPY[d.policy]}`,
            value: `${d.looks_for}. Model: ${d.model}${d.measured ? ` (${d.measured})` : ""}.${found}`,
          }
        }),
      },
    }
    y += LANE_HEADER + lane.detectors.length * rowH + LANE_GAP
    return node
  })
  const mid = Math.max(0, (y - LANE_GAP) / 2 - 40)
  const verdictTone: Tone | undefined = verdict ? toneFor(verdict) : undefined

  const step = (
    id: string,
    x: number,
    data: Omit<StepData, "traced">
  ): StepNode => ({
    id,
    type: "step",
    position: { x, y: mid },
    data: { ...data, traced },
  })

  const nodes: FlowNode[] = [
    step("input", X.input, {
      title: "Input",
      subtitle: verdict?.filename ?? live?.filename ?? "File, hashed and typed",
      icon: FileInputIcon,
      first: true,
      result: verdict
        ? `${verdict.media_type} · ${verdict.item_id.slice(0, 10)}…`
        : live
          ? "hashed and typed"
          : undefined,
      details: [
        { label: "Ingest", value: steps.ingest },
        ...(verdict
          ? [
              { label: "File", value: verdict.filename },
              { label: "sha256", value: verdict.item_id },
            ]
          : []),
      ],
    }),
    ...laneNodes,
    step("fusion", X.fusion, {
      title: "Fusion",
      subtitle: "Votes + logit-mean score",
      icon: CpuIcon,
      result: verdict
        ? `${verdict.votes} vote${verdict.votes === 1 ? "" : "s"} · ${pct(verdict.p_raw)} fused`
        : waiting,
      details: [
        { label: "How", value: steps.fusion },
        ...(verdict?.experimental
          ? [
              {
                label: "Note",
                value: "Experimental media type: the tier is kept cautious.",
              },
            ]
          : []),
      ],
    }),
    step("calibration", X.calibration, {
      title: "Calibration",
      subtitle: spec.calibrated
        ? "Platt fit, held-out checked"
        : "Pass-through",
      icon: ScaleIcon,
      result: verdict
        ? spec.calibrated
          ? `${pct(verdict.p_raw)} → ${pct(verdict.p_fake)}`
          : `${pct(verdict.p_fake)} unchanged`
        : waiting,
      details: [
        {
          label: "How",
          value: spec.calibrated
            ? steps.calibration
            : "Not calibrated for this media type yet: the fused score is used as-is.",
        },
      ],
    }),
    step("verdict", X.verdict, {
      title: "Verdict",
      subtitle: verdict
        ? `${verdict.label.toUpperCase()}${verdict.tier === "uncertain" ? " · unsure" : ""}`
        : "Fake / real + reason",
      icon: GavelIcon,
      last: true,
      tone: verdictTone,
      result: verdict
        ? `${pct(verdict.confidence)} · ${verdict.reason_code}`
        : waiting,
      details: [
        { label: "Rule", value: steps.verdict },
        ...(verdict ? [{ label: "Reason", value: verdict.reason_text }] : []),
      ],
    }),
  ]

  const edge = (
    id: string,
    source: string,
    target: string,
    tone?: Tone,
    active = traced
  ): Edge => ({
    id,
    source,
    target,
    animated: active,
    style: traced
      ? { stroke: toneColor(tone), strokeWidth: 2, opacity: active ? 1 : 0.35 }
      : { strokeWidth: 1.5 },
  })
  const edges: Edge[] = [
    ...laneNodes.flatMap((n) => {
      const active = n.data.rows.some((r) => ran(r.signal)) || !!n.data.running
      return [
        edge(`e-in-${n.id}`, "input", n.id, "muted", traced && active),
        edge(`e-out-${n.id}`, n.id, "fusion", n.data.tone, traced && active),
      ]
    }),
    edge("e-fusion-cal", "fusion", "calibration", "muted"),
    edge("e-cal-verdict", "calibration", "verdict", verdictTone),
  ]
  return { nodes, edges }
}

/**
 * The Detective as an n8n-style node graph. Without a verdict it is the map of what runs for this media type;
 * with one, every node shows what actually happened to that item.
 */
export function PipelineCanvas({
  spec,
  steps,
  verdict,
  live,
  height = 560,
}: {
  spec: PipelineMedia
  steps: Pipeline["steps"]
  verdict?: Verdict
  live?: LiveRun
  height?: number
}) {
  const { theme } = useTheme()
  const graph = React.useMemo(
    () => buildGraph(spec, steps, verdict, live),
    [spec, steps, verdict, live]
  )
  // Nodes stay draggable like an editor; reset whenever the graph itself changes.
  const [nodes, setNodes] = React.useState(graph.nodes)
  const [prevGraph, setPrevGraph] = React.useState(graph)
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  if (prevGraph !== graph) {
    setPrevGraph(graph)
    setNodes(graph.nodes)
    setSelectedId(null)
  }
  const selected = nodes.find((n) => n.id === selectedId)

  return (
    <div
      className="overflow-hidden rounded-xl border bg-background/40"
      style={{ height, ["--panel-h" as string]: `${height}px` }}
    >
      <ReactFlow
        key={`${verdict?.item_id ?? "map"}-${spec.lanes.length}`}
        nodes={nodes}
        edges={graph.edges}
        nodeTypes={nodeTypes}
        onNodesChange={(changes) =>
          setNodes(
            (ns) =>
              ns.map((n) => {
                const c = changes.find(
                  (x) => x.type === "position" && x.id === n.id
                )
                return c && c.type === "position" && c.position
                  ? { ...n, position: c.position }
                  : n
              }) as FlowNode[]
          )
        }
        onNodeClick={(_, n) => setSelectedId(n.id)}
        onPaneClick={() => setSelectedId(null)}
        nodesConnectable={false}
        deleteKeyCode={null}
        colorMode={theme}
        fitView
        fitViewOptions={{ padding: 0.06 }}
        minZoom={0.2}
        aria-label="Detective pipeline graph"
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} />
        <Controls showInteractive={false} />
        <Panel position="top-right">
          {selected ? (
            <Card className="max-h-[calc(var(--panel-h)-2rem)] w-72 gap-3 overflow-y-auto bg-card/95 p-4 shadow-lg backdrop-blur">
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-sm font-semibold">{selected.data.title}</h3>
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
              <dl className="grid gap-3 text-sm">
                {selected.data.details.map((d) => (
                  <div key={d.label} className="grid gap-0.5">
                    <dt className="text-xs text-muted-foreground">{d.label}</dt>
                    <dd className="text-pretty break-words">{d.value}</dd>
                  </div>
                ))}
              </dl>
            </Card>
          ) : (
            <p className="rounded-full border bg-card/90 px-3 py-1 text-xs text-muted-foreground shadow-sm">
              Select a node for details · drag to rearrange
            </p>
          )}
        </Panel>
      </ReactFlow>
    </div>
  )
}
