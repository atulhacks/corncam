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
  useStore,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react"
import {
  BotIcon,
  CheckIcon,
  LoaderIcon,
  PlayIcon,
  PlusIcon,
  ScaleIcon,
  SearchIcon,
  SquareIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react"

import { useTheme } from "@/components/theme-provider"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import type { MediaKind, Signal, StudioTool, Verdict } from "@/lib/api"
import { cn } from "@/lib/utils"
import { TONE_VAR, toneFor } from "@/lib/verdict-style"

import { TOOL_META, type ToolRun } from "./studio-model"

/*
 * n8n-style canvas. Main flow left to right: trigger (D-shaped) -> AI agent (wide) -> fusion -> verdict.
 * The agent's tools hang below it as round sub-nodes on dashed links, n8n's "AI Agent" pattern: the chat model and
 * the detectors on the first row, the advisory forensics (shown only, never vote) on the second.
 */

type Tone = "fake" | "real" | "unsure"
type Status = "idle" | "queued" | "running" | "done"
type Shape = "trigger" | "square" | "agent" | "circle"
type FlowData = {
  shape: Shape
  icon: LucideIcon
  label: string
  sub?: string
  tag?: string
  status: Status
  tone?: Tone
  dashed?: boolean
  last?: boolean
  run?: ToolRun
}
type FlowNode = Node<FlowData, "flow">

const SQ = 96 // square node
const CIRCLE = 72
const AGENT_W = 288
const AGENT_H = 112
const SUB_PITCH = 136
const TAG: Record<ToolRun["by"], string> = {
  ai: "AI",
  you: "You",
  core: "Core",
}
const pct = (x: number) => `${Math.round(x * 100)}%`
const HANDLE = "!size-2.5 !border-2 !border-background !bg-muted-foreground"
const SUB_HANDLE =
  "!size-2 !rotate-45 !rounded-none !border-0 !bg-muted-foreground"
// Phones get a shorter frame: the graph is wide, so a tall canvas only adds empty space.
const CANVAS_H = "h-full"
const PANEL_MAX_H = "max-h-[min(calc(100svh-10rem),40rem)]"

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

function subOf(run: ToolRun): string {
  if (run.status === "queued") return "Queued"
  if (run.status === "running") return "Running…"
  if (run.advisory) {
    const s = run.signals[0]
    return s ? (s.rank === "uncertain" ? "Flagged" : "Nothing found") : "Done"
  }
  const head =
    run.signals.find((s) => s.score != null && s.policy !== "ignore") ??
    run.signals.find((s) => s.score != null)
  return head?.score != null ? `${pct(head.score)} fake` : "n/a"
}

/** One node in n8n's visual language: a tile with a centred icon, label and status underneath. */
function FlowNodeView({ data, selected }: NodeProps<FlowNode>) {
  const Icon = data.icon
  const round = data.shape === "circle"
  const agent = data.shape === "agent"
  const size = agent
    ? { width: AGENT_W, height: AGENT_H }
    : round
      ? { width: CIRCLE, height: CIRCLE }
      : { width: SQ, height: SQ }
  const border =
    data.status === "running"
      ? "var(--brand)"
      : selected
        ? "var(--ring)"
        : data.tone
          ? TONE_VAR[data.tone]
          : "color-mix(in oklab, var(--muted-foreground) 40%, transparent)"
  return (
    <div className="flex flex-col items-center" style={{ width: size.width }}>
      <div
        className={cn(
          "relative grid place-items-center border-2 bg-card shadow-sm transition-[border-color,opacity] duration-150",
          round ? "rounded-full" : "rounded-lg",
          data.shape === "trigger" && "rounded-l-[48px]",
          data.dashed && "border-dashed",
          data.status === "queued" && "opacity-60",
          data.status === "idle" && "opacity-80",
          data.status === "running" && "node-running"
        )}
        style={{ ...size, borderColor: border }}
      >
        {(data.shape === "square" || agent) && (
          <Handle type="target" position={Position.Left} className={HANDLE} />
        )}
        {round && (
          <Handle
            type="target"
            position={Position.Top}
            className={SUB_HANDLE}
          />
        )}
        {agent ? (
          <div className="grid size-full grid-rows-[1fr_auto]">
            <div className="flex items-center gap-3 px-4">
              <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-brand/15 text-brand">
                <Icon className="size-5" aria-hidden />
              </span>
              <div className="grid min-w-0 gap-0.5 text-left">
                <span className="truncate text-sm font-semibold">
                  {data.label}
                </span>
                <span className="line-clamp-2 text-[11px] leading-snug text-muted-foreground">
                  {data.sub}
                </span>
              </div>
            </div>
            <div className="grid grid-cols-3 border-t border-border/60 py-1 text-center text-[10px] text-muted-foreground">
              <span>Chat model</span>
              <span>Detectors</span>
              <span>Forensics</span>
            </div>
          </div>
        ) : (
          <Icon
            className={cn("text-brand", round ? "size-6" : "size-9")}
            aria-hidden
          />
        )}
        {data.status === "running" && (
          <LoaderIcon
            className={cn(
              "absolute size-3.5 animate-spin text-brand",
              agent ? "top-2 right-2" : "right-1.5 bottom-1.5"
            )}
            aria-hidden
          />
        )}
        {data.status === "done" && (
          <span
            className={cn(
              "absolute grid size-4 place-items-center rounded-full bg-real text-background",
              round
                ? "-right-0.5 -bottom-0.5"
                : agent
                  ? "top-2 right-2"
                  : "right-1.5 bottom-1.5"
            )}
            aria-label="Done"
          >
            <CheckIcon className="size-3" strokeWidth={3} aria-hidden />
          </span>
        )}
        {(data.shape === "trigger" ||
          agent ||
          (data.shape === "square" && !data.last)) && (
          <Handle type="source" position={Position.Right} className={HANDLE} />
        )}
        {agent &&
          (["model", "detectors", "forensics"] as const).map((id, i) => (
            <Handle
              key={id}
              id={id}
              type="source"
              position={Position.Bottom}
              className={SUB_HANDLE}
              style={{ left: `${(100 / 6) * (2 * i + 1)}%` }}
            />
          ))}
      </div>
      {agent ? null : (
        <div className="mt-2 grid w-[150px] justify-items-center gap-0.5 text-center">
          <span className="line-clamp-2 text-[13px] leading-tight font-medium">
            {data.label}
          </span>
          {data.sub && (
            <span
              className="text-[11px] text-muted-foreground tabular-nums"
              style={data.tone ? { color: TONE_VAR[data.tone] } : undefined}
            >
              {data.sub}
            </span>
          )}
          {data.tag && (
            <span className="font-mono text-[9px] tracking-wider text-muted-foreground/80 uppercase">
              {data.tag}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

const nodeTypes = { flow: FlowNodeView }

/** Keep the graph framed when nodes arrive or the canvas changes size (rotation, sidebar, window resize). */
function FitOnGrow({ count }: { count: number }) {
  const { fitView } = useReactFlow()
  const width = useStore((st) => st.width)
  const height = useStore((st) => st.height)
  React.useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    const id = requestAnimationFrame(
      () => void fitView({ padding: 0.12, duration: reduce ? 0 : 200 })
    )
    return () => cancelAnimationFrame(id)
  }, [count, width, height, fitView])
  return null
}

/** Payloads only the page shows (they never go to the AI). Rendered as text, never as links. */
function Details({ signal }: { signal: Signal }) {
  const d = signal.details ?? {}
  const artifact = typeof d.artifact === "string" ? d.artifact : null
  const rows = Object.entries(d).filter(
    ([k, v]) =>
      k !== "artifact" &&
      v !== null &&
      v !== "" &&
      v !== false &&
      (typeof v !== "object" || Array.isArray(v))
  )
  return (
    <section className="grid gap-2 border-t pt-3 first:border-t-0 first:pt-0">
      <h4 className="text-xs font-medium">{signal.name}</h4>
      <p className="text-xs leading-relaxed text-pretty text-muted-foreground">
        {signal.evidence}
      </p>
      {artifact && (
        <img
          src={artifact}
          alt={`${signal.name} map`}
          className="w-full rounded-md bg-black outline outline-1 -outline-offset-1 outline-white/10"
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
    </section>
  )
}

/** n8n's node creator: a searchable list of every node that applies to this file. */
function NodeCreator({
  tools,
  picked,
  media,
  onToggle,
  onClose,
  disabled,
}: {
  tools: StudioTool[]
  picked: string[]
  media?: MediaKind
  onToggle: (name: string) => void
  onClose: () => void
  disabled: boolean
}) {
  const [q, setQ] = React.useState("")
  const list = tools.filter(
    (t) =>
      (!media || t.media.includes(media)) &&
      (TOOL_META[t.name]?.label ?? t.name)
        .toLowerCase()
        .includes(q.toLowerCase())
  )
  const groups = [
    ["Detectors · vote", list.filter((t) => !t.advisory)],
    ["Forensics · shown only", list.filter((t) => t.advisory)],
  ] as const
  return (
    <Card
      className={cn(
        "flex w-[min(19rem,calc(100vw-4rem))] flex-col gap-0 overflow-hidden bg-card/95 p-0 shadow-lg backdrop-blur",
        PANEL_MAX_H
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <h3 className="text-sm font-semibold">Add a node</h3>
        <Button
          variant="ghost"
          size="icon"
          className="-mr-2 size-7"
          onClick={onClose}
          aria-label="Close"
        >
          <XIcon aria-hidden />
        </Button>
      </div>
      <div className="relative border-b px-3 py-2">
        <SearchIcon
          className="absolute top-1/2 left-5 size-3.5 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search nodes…"
          className="h-8 pl-7 text-sm"
          aria-label="Search nodes"
        />
      </div>
      <div className="grid gap-3 overflow-y-auto p-2">
        {groups.map(([label, group]) =>
          group.length === 0 ? null : (
            <div key={label} className="grid gap-0.5">
              <p className="px-2 pt-1 text-[11px] text-muted-foreground">
                {label}
              </p>
              {group.map((t) => {
                const meta = TOOL_META[t.name] ?? TOOL_META.unknown
                const core = media ? t.core.includes(media) : false
                const on = core || picked.includes(t.name)
                const Icon = meta.icon
                return (
                  <button
                    key={t.name}
                    type="button"
                    disabled={core || disabled}
                    onClick={() => onToggle(t.name)}
                    aria-pressed={on}
                    className={cn(
                      "grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-md px-2 py-2 text-left transition-colors",
                      on && !core
                        ? "bg-brand/10"
                        : "hover:bg-foreground/[0.05]",
                      core && "cursor-default"
                    )}
                  >
                    <span className="grid size-8 place-items-center rounded-md border bg-background text-brand">
                      <Icon className="size-4" aria-hidden />
                    </span>
                    <span className="grid min-w-0 gap-0.5">
                      <span className="truncate text-sm">{meta.label}</span>
                      <span className="line-clamp-2 text-[11px] leading-snug text-muted-foreground">
                        {t.description}
                      </span>
                    </span>
                    {core ? (
                      <span className="font-mono text-[9px] tracking-wider text-muted-foreground">
                        ALWAYS
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
                )
              })}
            </div>
          )
        )}
        {list.length === 0 && (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground">
            No nodes match.
          </p>
        )}
      </div>
    </Card>
  )
}

export function StudioCanvas({
  fileName,
  media,
  runs,
  planner,
  verdict,
  tools,
  picked,
  onToggle,
  action,
}: {
  fileName?: string
  media?: MediaKind
  runs: ToolRun[]
  planner: { subtitle: string; running: boolean; model: string }
  verdict?: Verdict
  tools: StudioTool[]
  picked: string[]
  onToggle: (name: string) => void
  action: {
    label: string
    onClick: () => void
    disabled: boolean
    running: boolean
  }
}) {
  const { theme } = useTheme()
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [creator, setCreator] = React.useState(false)

  const { nodes, edges } = React.useMemo(() => {
    const detectors = runs.filter((r) => !r.advisory)
    const forensics = runs.filter((r) => r.advisory)
    const rowWidth = (n: number) => (Math.max(n, 1) - 1) * SUB_PITCH + CIRCLE
    // Row A hangs under the chat-model/detector connectors; row B (forensics) starts under its own connector on
    // the right, so its dashed links do not cut across row A.
    // Each group hangs under its own connector: chat model under the left sixth of the agent, detectors centred
    // under the middle, forensics starting under the right sixth (never overlapping the groups before it).
    const agentX = 0
    const modelX = agentX + AGENT_W / 6 - CIRCLE / 2
    const startA = Math.max(
      agentX + AGENT_W / 2 - rowWidth(detectors.length) / 2,
      modelX + SUB_PITCH
    )
    const startB = Math.max(
      agentX + (AGENT_W * 5) / 6 - CIRCLE / 2,
      modelX + SUB_PITCH / 2
    )
    const ROW_A = AGENT_H + 96
    const ROW_B = ROW_A + CIRCLE + 104
    const fusionX = agentX + AGENT_W + 128
    const working = planner.running
    const anyDone = runs.some((r) => r.status === "done")

    const sub = (r: ToolRun, x: number, y: number): FlowNode => {
      const meta = TOOL_META[r.tool] ?? TOOL_META.unknown
      return {
        id: r.tool,
        type: "flow",
        position: { x, y },
        data: {
          shape: "circle",
          icon: meta.icon,
          label: meta.label,
          sub: subOf(r),
          tag: r.cached ? `${TAG[r.by]} · cached` : TAG[r.by],
          status: r.status,
          tone: toneOf(r),
          dashed: r.advisory,
          run: r,
        },
      }
    }

    const ns: FlowNode[] = [
      {
        id: "trigger",
        type: "flow",
        position: { x: agentX - SQ - 128, y: 0 },
        data: {
          shape: "trigger",
          icon: TOOL_META.input.icon,
          label: fileName ? "File dropped" : "Drop a file",
          sub: fileName ? String(media) : "Waiting for evidence",
          status: fileName ? "done" : "idle",
        },
      },
      {
        id: "agent",
        type: "flow",
        position: { x: agentX, y: 0 },
        data: {
          shape: "agent",
          icon: BotIcon,
          label: "AI Investigator",
          sub: planner.subtitle,
          status: working ? "running" : anyDone ? "done" : "idle",
        },
      },
      {
        id: "model",
        type: "flow",
        position: { x: modelX, y: ROW_A },
        data: {
          shape: "circle",
          icon: TOOL_META.planner.icon,
          label: planner.model,
          sub: "Chat model",
          status: working ? "running" : anyDone ? "done" : "idle",
        },
      },
      ...detectors.map((r, i) => sub(r, startA + i * SUB_PITCH, ROW_A)),
      ...forensics.map((r, i) => sub(r, startB + i * SUB_PITCH, ROW_B)),
      {
        id: "fusion",
        type: "flow",
        position: { x: fusionX, y: 0 },
        data: {
          shape: "square",
          icon: ScaleIcon,
          label: "Fusion & calibration",
          sub: verdict ? `${verdict.votes} votes` : "Detectors vote",
          status: verdict ? "done" : "idle",
        },
      },
      {
        id: "verdict",
        type: "flow",
        position: { x: fusionX + SQ + 128, y: 0 },
        data: {
          shape: "square",
          icon: TOOL_META.verdict.icon,
          label: "Verdict",
          sub: verdict
            ? `${verdict.label.toUpperCase()} · ${pct(verdict.confidence)}`
            : "Not decided yet",
          status: verdict ? "done" : "idle",
          tone: verdict ? toneFor(verdict) : undefined,
          last: true,
        },
      },
    ]

    const main = {
      stroke: "var(--muted-foreground)",
      strokeWidth: 2,
      opacity: 0.75,
    }
    const subLink = {
      stroke: "var(--muted-foreground)",
      strokeWidth: 1.5,
      strokeDasharray: "5 5",
      opacity: 0.6,
    }
    const label = (text?: string): Partial<Edge> =>
      text
        ? {
            label: text,
            labelStyle: { fontSize: 11, fill: "var(--muted-foreground)" },
            labelBgStyle: { fill: "var(--background)" },
            labelBgPadding: [4, 2],
          }
        : {}
    const results = detectors.filter((r) => r.status === "done").length
    const es: Edge[] = [
      {
        id: "t-a",
        source: "trigger",
        target: "agent",
        style: main,
        animated: working,
        ...label(fileName ? "1 file" : undefined),
      },
      {
        id: "a-f",
        source: "agent",
        target: "fusion",
        style: main,
        ...label(
          results ? `${results} result${results > 1 ? "s" : ""}` : undefined
        ),
      },
      {
        id: "f-v",
        source: "fusion",
        target: "verdict",
        style: main,
        ...label(verdict ? `${pct(verdict.p_fake)} fake` : undefined),
      },
      {
        id: "a-m",
        source: "agent",
        sourceHandle: "model",
        target: "model",
        style: subLink,
      },
      ...runs.map((r): Edge => ({
        id: `a-${r.tool}`,
        source: "agent",
        sourceHandle: r.advisory ? "forensics" : "detectors",
        target: r.tool,
        style: subLink,
        animated: r.status === "running",
      })),
    ]
    return { nodes: ns, edges: es }
  }, [runs, planner, verdict, fileName, media])

  const selected = nodes.find((n) => n.id === selectedId)?.data.run

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border bg-background",
        CANVAS_H
      )}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={(_, n) => {
          setCreator(false)
          setSelectedId(n.id)
        }}
        onPaneClick={() => setSelectedId(null)}
        nodesDraggable={false}
        nodesConnectable={false}
        deleteKeyCode={null}
        colorMode={theme}
        fitView
        fitViewOptions={{ padding: 0.12 }}
        minZoom={0.15}
        maxZoom={1.2}
        proOptions={{ hideAttribution: true }}
        aria-label="Studio investigation graph"
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1.4} />
        <Controls showInteractive={false} position="bottom-left" />
        <FitOnGrow count={nodes.length} />

        <Panel position="top-right" className="!m-3">
          {creator ? (
            <NodeCreator
              tools={tools}
              picked={picked}
              media={media}
              onToggle={onToggle}
              onClose={() => setCreator(false)}
              disabled={action.running}
            />
          ) : selected && selected.signals.length > 0 ? (
            <Card
              className={cn(
                "w-[min(20rem,calc(100vw-4rem))] gap-3 overflow-y-auto bg-card/95 p-4 shadow-lg backdrop-blur",
                PANEL_MAX_H
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="grid gap-0.5">
                  <h3 className="text-sm font-semibold">
                    {(TOOL_META[selected.tool] ?? TOOL_META.unknown).label}
                  </h3>
                  <span className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
                    {TAG[selected.by]} ·{" "}
                    {selected.advisory ? "shown only" : "votes"}
                  </span>
                </div>
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
                <p className="text-xs leading-relaxed text-pretty text-muted-foreground">
                  <span className="font-medium text-foreground">Why: </span>
                  {selected.why}
                </p>
              )}
              {selected.signals.map((s) => (
                <Details key={s.name} signal={s} />
              ))}
            </Card>
          ) : (
            <Button
              variant="outline"
              size="icon"
              className="size-10 rounded-lg bg-card shadow-sm"
              onClick={() => {
                setSelectedId(null)
                setCreator(true)
              }}
              aria-label="Add a node"
              title="Add a node"
            >
              <PlusIcon className="size-5" aria-hidden />
            </Button>
          )}
        </Panel>

        <Panel position="bottom-center" className="!mb-4">
          <Button
            variant={action.running ? "outline" : "default"}
            disabled={action.disabled}
            onClick={action.onClick}
            className="h-10 rounded-lg bg-clip-padding px-5 shadow-md"
          >
            {action.running ? (
              <SquareIcon aria-hidden />
            ) : (
              <PlayIcon aria-hidden />
            )}
            {action.label}
          </Button>
        </Panel>
      </ReactFlow>
    </div>
  )
}
