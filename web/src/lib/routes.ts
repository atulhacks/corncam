import {
  BarChart3Icon,
  FileBarChartIcon,
  FlaskConicalIcon,
  LayersIcon,
  LayoutDashboardIcon,
  ScanSearchIcon,
  TrophyIcon,
  WorkflowIcon,
  type LucideIcon,
} from "lucide-react"

export type RouteId =
  | "overview"
  | "detective"
  | "pool"
  | "forger"
  | "scoreboard"
  | "report"
  | "benchmark"
  | "pipeline"

export interface RouteDef {
  id: RouteId
  label: string
  description: string
  icon: LucideIcon
  group: "Home" | "Blue team" | "Red team" | "Arena" | "Insights"
  ready: boolean
}

export const ROUTES: RouteDef[] = [
  {
    id: "overview",
    label: "Overview",
    description: "Arena status at a glance",
    icon: LayoutDashboardIcon,
    group: "Home",
    ready: true,
  },
  {
    id: "detective",
    label: "Detective",
    description: "Analyse one item in depth",
    icon: ScanSearchIcon,
    group: "Blue team",
    ready: true,
  },
  {
    id: "pool",
    label: "Evidence Pool",
    description: "Every arena item, analysed and exported",
    icon: LayersIcon,
    group: "Blue team",
    ready: true,
  },
  {
    id: "forger",
    label: "Forger Studio",
    description: "Make and test our five fakes",
    icon: FlaskConicalIcon,
    group: "Red team",
    ready: true,
  },
  {
    id: "scoreboard",
    label: "Reveal & Scoreboard",
    description: "Live reveal and team points",
    icon: TrophyIcon,
    group: "Arena",
    ready: true,
  },
  {
    id: "report",
    label: "Post-game Report",
    description: "What slipped through and why",
    icon: FileBarChartIcon,
    group: "Arena",
    ready: true,
  },
  {
    id: "benchmark",
    label: "Benchmark",
    description: "Held-out accuracy, measured",
    icon: BarChart3Icon,
    group: "Insights",
    ready: true,
  },
  {
    id: "pipeline",
    label: "Pipeline",
    description: "How each item is processed, step by step",
    icon: WorkflowIcon,
    group: "Insights",
    ready: true,
  },
]

export const GROUPS: RouteDef["group"][] = [
  "Home",
  "Blue team",
  "Red team",
  "Arena",
  "Insights",
]

export const routeById = (id: RouteId) => ROUTES.find((r) => r.id === id)!
