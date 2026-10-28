import { StatStrip } from "@/components/stat-strip"
import { NumberTicker } from "@/components/ui/number-ticker"
import { Skeleton } from "@/components/ui/skeleton"
import type { BenchmarkReport } from "@/lib/api"
import { cn } from "@/lib/utils"

interface Kpi {
  label: string
  value: number
  decimals: number
  prefix?: string
  suffix?: string
  /** change vs the first held-out run, in display units; null when there is no earlier run */
  delta: number | null
  /** true when a larger value is better (AUC, accuracy, points); false for error rates */
  higherIsBetter: boolean
  insight: string
}

function kpis(
  latest: BenchmarkReport,
  first: BenchmarkReport | undefined
): Kpi[] {
  const d = (a: number | null, b: number | null | undefined, scale = 1) =>
    first && a != null && b != null ? (a - b) * scale : null
  return [
    {
      label: "Held-out AUC",
      value: latest.auc ?? 0,
      decimals: 3,
      delta: d(latest.auc, first?.auc),
      higherIsBetter: true,
      insight: "Separates real from fake",
    },
    {
      label: "Accuracy",
      value: latest.accuracy * 100,
      decimals: 0,
      suffix: "%",
      delta: d(latest.accuracy, first?.accuracy, 100),
      higherIsBetter: true,
      insight: "Correct at the 0.5 threshold",
    },
    {
      label: "False alarms on reals",
      value: (latest.false_alarm_rate ?? 0) * 100,
      decimals: 0,
      suffix: "%",
      delta: d(latest.false_alarm_rate, first?.false_alarm_rate, 100),
      higherIsBetter: false,
      insight: "Reals called fake, −5 each",
    },
    {
      label: "Arena points / 100 items",
      value: latest.game_points,
      decimals: 0,
      prefix: "+",
      delta: d(latest.game_points, first?.game_points),
      higherIsBetter: true,
      insight: "Arena scoring on the sample",
    },
  ]
}

/** "reddit_100_v2" → "v2"; the first run has no suffix → "v1". */
const runLabel = (name: string) =>
  name.replace(/^reddit_100_?/, "").replace(/_/g, " ") || "v1"

function Delta({ k }: { k: Kpi }) {
  if (k.delta == null || Math.abs(k.delta) < 10 ** -k.decimals / 2) {
    return <span className="font-mono">→ steady</span>
  }
  const up = k.delta > 0
  const good = up === k.higherIsBetter
  return (
    <span className={cn("font-mono", good ? "text-real" : "text-fake")}>
      {up ? "▲ +" : "▼ −"}
      {Math.abs(k.delta).toFixed(k.decimals)}
      {k.suffix === "%" ? " pts" : ""}
    </span>
  )
}

/**
 * Headline numbers from the latest held-out image run (never tuning or smoke runs, never another media type), with
 * the change since the first held-out image run, as a StatStrip (hairline cells under a heavy rule).
 */
export function KpiCards({
  reports,
}: {
  reports: BenchmarkReport[] | null | undefined
}) {
  const heldOut =
    reports?.filter((r) => r.role === "held-out" && r.media === "image") ?? []
  const latest = heldOut.at(-1)
  const first = heldOut.length > 1 ? heldOut[0] : undefined

  if (reports === undefined) {
    return <Skeleton className="h-32" />
  }
  if (!latest) {
    return (
      <p className="border-t-2 border-t-rule pt-4 text-sm text-muted-foreground">
        No held-out evaluation yet. Run <code>uv run corncam eval</code> to
        measure the Detective.
      </p>
    )
  }

  return (
    <StatStrip
      stats={kpis(latest, first).map((k) => ({
        label: k.label,
        value: (
          <>
            {k.prefix}
            <NumberTicker value={k.value} decimalPlaces={k.decimals} />
          </>
        ),
        unit: k.suffix,
        hint: (
          <>
            <Delta k={k} /> {first ? `vs ${runLabel(first.name)}` : "first run"}{" "}
            · {k.insight}
          </>
        ),
      }))}
    />
  )
}
