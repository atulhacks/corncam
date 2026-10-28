import * as React from "react"

import { PageHeader } from "@/components/page-header"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { api, type BenchmarkReport } from "@/lib/api"

import { KpiCards } from "./kpi-cards"
import { RunsChart } from "./runs-chart"

const pct = (x: number | null) => (x == null ? "—" : `${(x * 100).toFixed(1)}%`)

export function BenchmarkPage() {
  const [reports, setReports] = React.useState<BenchmarkReport[] | undefined>(
    undefined
  )
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    api
      .benchmark()
      .then(setReports)
      .catch((e: Error) => setError(e.message))
  }, [])

  return (
    <div className="@container/main mx-auto grid w-full max-w-[1600px] grid-cols-1 gap-8 px-4 pt-10 md:px-6 xl:px-10 pb-16">
      <PageHeader
        eyebrow="Held-out evaluation"
        title="Measured, not claimed"
        description={
          <>
            Held-out evaluation on real-world Reddit images and
            current-generation fakes (OpenFake). Scored with the arena's own
            points: +5 catch, +3 real cleared, −5 false alarm, −3 miss.
          </>
        }
      />

      {error && (
        <p className="text-sm text-fake">Could not load reports: {error}</p>
      )}

      <KpiCards reports={reports} />

      {reports && <RunsChart reports={reports} />}

      <Card className="bg-card/80">
        <CardHeader>
          <CardTitle>Evaluation runs</CardTitle>
          <CardDescription>
            Each row is a run of the full Detective pipeline on a labelled
            sample. Headline numbers come from the latest held-out run; tuning
            runs were used to fit calibration and are shown for transparency
            only. Stress runs re-score the same held-out images after an attack
            (WhatsApp-style re-compression) to show where the Detective is
            weaker.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Run</TableHead>
                <TableHead className="text-right">Items</TableHead>
                <TableHead className="text-right">AUC</TableHead>
                <TableHead className="text-right">Accuracy</TableHead>
                <TableHead className="text-right">False alarms</TableHead>
                <TableHead className="text-right">Misses</TableHead>
                <TableHead className="text-right">Brier</TableHead>
                <TableHead className="text-right">Points</TableHead>
                <TableHead className="text-right">s / item</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(reports ?? []).map((r) => (
                <TableRow key={r.name}>
                  <TableCell className="font-medium">
                    {r.name}
                    <Badge
                      variant={r.role === "held-out" ? "secondary" : "outline"}
                      className="ml-2 rounded-full text-[10px]"
                    >
                      {r.role}
                    </Badge>
                    <Badge
                      variant="outline"
                      className="ml-1 rounded-full text-[10px] capitalize"
                    >
                      {r.media}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.n}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.auc?.toFixed(3) ?? "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {pct(r.accuracy)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {pct(r.false_alarm_rate)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {pct(r.miss_rate)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.brier.toFixed(3)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.game_points}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.seconds_median.toFixed(2)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
