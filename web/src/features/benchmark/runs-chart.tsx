import * as React from "react"
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts"

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useIsMobile } from "@/hooks/use-mobile"
import type { BenchmarkReport } from "@/lib/api"

type Metric = "quality" | "errors"

const config = {
  auc: { label: "AUC", color: "var(--brand)" },
  accuracy: { label: "Accuracy", color: "var(--real)" },
  false_alarm: { label: "False alarms", color: "var(--fake)" },
  miss: { label: "Misses", color: "var(--unsure)" },
} satisfies ChartConfig

const SERIES: Record<Metric, (keyof typeof config)[]> = {
  quality: ["auc", "accuracy"],
  errors: ["false_alarm", "miss"],
}

/** How the Detective changed across held-out runs (pattern: shadcn dashboard-01 ChartAreaInteractive). */
export function RunsChart({ reports }: { reports: BenchmarkReport[] }) {
  const isMobile = useIsMobile()
  const [metric, setMetric] = React.useState<Metric>("quality")

  const data = reports
    .filter((r) => r.role === "held-out" && r.media === "image")
    .map((r) => ({
      run: r.name.replace(/^reddit_100_?/, "").replace(/_/g, " ") || "v1",
      auc: r.auc != null ? +(r.auc * 100).toFixed(1) : null,
      accuracy: +(r.accuracy * 100).toFixed(1),
      false_alarm:
        r.false_alarm_rate != null
          ? +(r.false_alarm_rate * 100).toFixed(1)
          : null,
      miss: r.miss_rate != null ? +(r.miss_rate * 100).toFixed(1) : null,
    }))

  return (
    <Card className="@container/card bg-card/80">
      <CardHeader>
        <CardTitle>Held-out runs</CardTitle>
        <CardDescription>
          Each point is the full pipeline on the same 100 held-out images
          (percent).
        </CardDescription>
        <CardAction>
          {isMobile ? (
            <Select
              value={metric}
              onValueChange={(v) => setMetric(v as Metric)}
            >
              <SelectTrigger size="sm" aria-label="Metric">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="quality">Quality</SelectItem>
                <SelectItem value="errors">Errors</SelectItem>
              </SelectContent>
            </Select>
          ) : (
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={metric}
              onValueChange={(v) => v && setMetric(v as Metric)}
            >
              <ToggleGroupItem value="quality">Quality</ToggleGroupItem>
              <ToggleGroupItem value="errors">Errors</ToggleGroupItem>
            </ToggleGroup>
          )}
        </CardAction>
      </CardHeader>
      <CardContent className="px-2 sm:px-6">
        {data.length < 2 ? (
          <p className="text-sm text-muted-foreground">
            Needs at least two held-out runs to show a trend.
          </p>
        ) : (
          <ChartContainer
            config={config}
            className="aspect-auto h-[240px] w-full"
          >
            <LineChart data={data} margin={{ left: 4, right: 12, top: 8 }}>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="run"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                width={36}
                domain={metric === "quality" ? [80, 100] : [0, 30]}
                tickFormatter={(v: number) => `${v}%`}
              />
              <ChartTooltip
                cursor={false}
                content={<ChartTooltipContent indicator="line" />}
              />
              {SERIES[metric].map((key) => (
                <Line
                  key={key}
                  dataKey={key}
                  type="monotone"
                  stroke={`var(--color-${key})`}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  connectNulls
                />
              ))}
            </LineChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  )
}
