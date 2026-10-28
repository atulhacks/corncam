import * as React from "react"
import {
  ArrowRightIcon,
  CheckCircle2Icon,
  CircleDashedIcon,
} from "lucide-react"

import { VerdictPill } from "@/components/verdict-pill"
import { PageHeader } from "@/components/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import { KpiCards } from "@/features/benchmark/kpi-cards"
import { useQueryHealth } from "@/hooks/use-health"
import { usePool } from "@/hooks/use-pool"
import { api, type BenchmarkReport } from "@/lib/api"
import type { RouteId } from "@/lib/routes"
import { toneFor } from "@/lib/verdict-style"

const MODALITIES = ["image", "video", "audio", "text"] as const

export function OverviewPage({
  onNavigate,
}: {
  onNavigate: (r: RouteId) => void
}) {
  const pool = usePool()
  const health = useQueryHealth()
  const [reports, setReports] = React.useState<
    BenchmarkReport[] | null | undefined
  >(undefined)

  React.useEffect(() => {
    api
      .benchmark()
      .then(setReports)
      .catch(() => setReports(null))
  }, [])

  const s = pool.data?.summary
  const recent = (pool.data?.items ?? [])
    .filter((i) => i.status === "done")
    .slice(-6)
    .reverse()
  const covered = new Set(health.data?.covered_media ?? [])

  return (
    <div className="@container/main mx-auto grid w-full max-w-6xl grid-cols-1 gap-8 px-4 pt-10 pb-16">
      <PageHeader
        eyebrow="Arena status"
        title="Arena overview"
        description={
          <>
            How sure the Detective is, how much of the Evidence Pool is done,
            and what it found.
          </>
        }
      />

      <KpiCards reports={reports} />

      <div className="grid gap-4 @4xl/main:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card className="bg-card/80">
          <CardHeader>
            <CardTitle>Evidence Pool</CardTitle>
            <CardDescription>
              Arena items analysed on this machine.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5">
            {!s ? (
              <Skeleton className="h-24" />
            ) : s.total === 0 ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground">
                  No pool loaded yet. Import the organisers' Evidence Pool to
                  start.
                </p>
                <Button size="sm" onClick={() => onNavigate("pool")}>
                  Import pool <ArrowRightIcon aria-hidden />
                </Button>
              </div>
            ) : (
              <>
                <div className="grid gap-2">
                  <div className="flex justify-between text-sm">
                    <span>
                      {s.done} of {s.total} analysed
                    </span>
                    <span className="text-muted-foreground tabular-nums">
                      {Math.round((s.done / s.total) * 100)}%
                    </span>
                  </div>
                  <Progress
                    value={(s.done / s.total) * 100}
                    aria-label="Pool analysis progress"
                  />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  {(
                    [
                      ["Fake", s.fake, "var(--fake)"],
                      ["Real", s.real, "var(--real)"],
                      ["Uncertain", s.uncertain, "var(--unsure)"],
                    ] as const
                  ).map(([label, n, color]) => (
                    <div key={label} className="rounded-xl border p-3">
                      <p className="text-xs tracking-wider text-muted-foreground uppercase">
                        {label}
                      </p>
                      <p
                        className="text-2xl font-semibold tabular-nums"
                        style={{ color }}
                      >
                        {n}
                      </p>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card/80">
          <CardHeader>
            <CardTitle>Coverage</CardTitle>
            <CardDescription>
              Media types the Detective can judge today.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {MODALITIES.map((m) => (
              <div
                key={m}
                className="flex items-center justify-between text-sm"
              >
                <span className="flex items-center gap-2 capitalize">
                  {covered.has(m) ? (
                    <CheckCircle2Icon
                      className="size-4 text-real"
                      aria-hidden
                    />
                  ) : (
                    <CircleDashedIcon
                      className="size-4 text-muted-foreground"
                      aria-hidden
                    />
                  )}
                  {m}
                </span>
                <Badge
                  variant={covered.has(m) ? "secondary" : "outline"}
                  className="rounded-full"
                >
                  {covered.has(m) ? "covered" : "provenance only"}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card className="bg-card/80">
        <CardHeader>
          <CardTitle>Recent verdicts</CardTitle>
          <CardDescription>
            The latest pool items the Detective finished.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {recent.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing analysed yet.
            </p>
          ) : (
            <ul className="grid gap-2">
              {recent.map((i) => (
                <li
                  key={i.sha}
                  className="flex items-center gap-3 rounded-lg border p-2 text-sm"
                >
                  {i.media_kind === "image" ? (
                    <img
                      src={i.media_url}
                      alt=""
                      className="size-10 rounded-md object-cover"
                    />
                  ) : (
                    <span className="grid size-10 place-items-center rounded-md bg-muted text-[10px] uppercase">
                      {i.media_kind}
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate">{i.filename}</span>
                  <code className="hidden text-xs text-muted-foreground sm:inline">
                    {i.reason_code}
                  </code>
                  <VerdictPill
                    tone={toneFor({
                      label: i.label ?? "real",
                      tier: i.tier ?? "low",
                    })}
                  >
                    {i.label} · {Math.round((i.confidence ?? 0) * 100)}%
                  </VerdictPill>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
