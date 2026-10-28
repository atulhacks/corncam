import * as React from "react"
import { ChevronRightIcon, EyeIcon, RotateCcwIcon } from "lucide-react"

import { VerdictPill } from "@/components/verdict-pill"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { NumberTicker } from "@/components/ui/number-ticker"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import { MediaPreview } from "@/features/detective/media-preview"
import { api, type Outcome, type Report } from "@/lib/api"
import type { RouteId } from "@/lib/routes"
import { TONE_VAR } from "@/lib/verdict-style"

const OUTCOME: Record<Outcome, { text: string; tone: keyof typeof TONE_VAR }> =
  {
    caught: { text: "Caught the fake", tone: "real" },
    cleared: { text: "Cleared a real item", tone: "real" },
    false_alarm: { text: "False alarm", tone: "fake" },
    missed: { text: "Missed a fake", tone: "fake" },
  }
const pct = (x: number) => `${Math.round(x * 100)}%`

function Pill({
  tone,
  children,
}: {
  tone: keyof typeof TONE_VAR
  children: React.ReactNode
}) {
  return <VerdictPill tone={tone}>{children}</VerdictPill>
}

/**
 * The brief's final act: "Organizers reveal the truth live, item by item, and the scoreboard updates."
 * Uses the answer key imported on the Post-game Report page; nothing here changes any verdict.
 */
export function RevealPage({
  onNavigate,
}: {
  onNavigate: (r: RouteId) => void
}) {
  const [report, setReport] = React.useState<Report | null | undefined>(
    undefined
  )
  const [error, setError] = React.useState<string | null>(null)
  const [index, setIndex] = React.useState(0)
  const [revealed, setRevealed] = React.useState(false)

  React.useEffect(() => {
    api
      .report()
      .then(setReport)
      .catch((e: Error) => setError(e.message))
  }, [])

  const rows = report?.rows ?? []
  const row = rows[index]
  // Points count only for items whose truth has been revealed.
  const done = rows.slice(0, revealed ? index + 1 : index)
  const score = done.reduce((t, r) => t + r.points, 0)
  const finished = rows.length > 0 && index === rows.length - 1 && revealed

  const advance = React.useCallback(() => {
    if (!rows.length) return
    if (!revealed) setRevealed(true)
    else if (index < rows.length - 1) {
      setIndex((i) => i + 1)
      setRevealed(false)
    }
  }, [rows.length, revealed, index])

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLElement &&
        e.target.closest("input, textarea, select, button")
      )
        return
      if (e.key === " " || e.key === "ArrowRight") {
        e.preventDefault()
        advance()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [advance])

  const restart = () => {
    setIndex(0)
    setRevealed(false)
  }

  return (
    <div className="@container/main mx-auto grid w-full max-w-6xl grid-cols-1 gap-8 px-4 pt-10 pb-16">
      <PageHeader
        eyebrow="Arena · live"
        title="Reveal & Scoreboard"
        description={
          <>
            Step through the arena item by item: our verdict first, then the
            truth, and the points land on the scoreboard. Space or → to advance.
          </>
        }
        actions={
          <>
            {rows.length > 0 && (
              <Button variant="outline" size="sm" onClick={restart}>
                <RotateCcwIcon aria-hidden /> Restart
              </Button>
            )}
          </>
        }
      />

      {error && (
        <p className="text-sm text-fake">Could not load the reveal: {error}</p>
      )}

      {report === undefined ? (
        <Skeleton className="h-96" />
      ) : !report || rows.length === 0 ? (
        <Card className="bg-card/80">
          <CardContent className="grid gap-3 text-sm text-muted-foreground">
            <p>
              The reveal needs the organisers' answer key. Import it on the
              Post-game Report page; it scores every analysed Pool item.
            </p>
            <div>
              <Button size="sm" onClick={() => onNavigate("report")}>
                Go to Post-game Report
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 @4xl/main:grid-cols-[minmax(0,1fr)_20rem]">
          <Card className="bg-card/80">
            <CardHeader>
              <CardDescription className="tabular-nums">
                Item {index + 1} of {rows.length}
              </CardDescription>
              <CardTitle className="truncate">{row.filename}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <MediaPreview
                url={`/api/pool/${row.sha}/media`}
                kind={row.media_type}
                name={row.filename}
              />
              <div className="grid gap-2">
                <p className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-muted-foreground">
                    Our Detective said
                  </span>
                  <Pill tone={row.call === "fake" ? "fake" : "real"}>
                    {row.call}
                  </Pill>
                  <span className="tabular-nums">
                    {pct(row.confidence)} confidence
                  </span>
                  <code className="text-xs text-muted-foreground">
                    {row.reason_code}
                  </code>
                </p>
                <p className="text-sm text-pretty text-muted-foreground">
                  {row.reason_text}
                </p>
              </div>
              {revealed ? (
                <div
                  className="grid enter gap-1 rounded-xl border-2 p-4"
                  style={{ borderColor: TONE_VAR[OUTCOME[row.outcome].tone] }}
                  role="status"
                >
                  <p className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="text-muted-foreground">The truth:</span>
                    <Pill tone={row.truth === "fake" ? "fake" : "real"}>
                      {row.truth}
                    </Pill>
                  </p>
                  <p className="text-lg font-semibold">
                    {OUTCOME[row.outcome].text}{" "}
                    <span className="tabular-nums">
                      {row.points > 0 ? `+${row.points}` : row.points}
                    </span>
                  </p>
                  {row.why && (
                    <p className="text-sm text-pretty text-muted-foreground">
                      {row.why}
                    </p>
                  )}
                </div>
              ) : null}
              <div className="flex justify-end">
                <Button onClick={advance} disabled={finished}>
                  {revealed ? (
                    <>
                      Next item <ChevronRightIcon aria-hidden />
                    </>
                  ) : (
                    <>
                      <EyeIcon aria-hidden /> Reveal truth
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>

          <div className="grid content-start gap-4">
            <Card className="bg-card/80">
              <CardHeader className="gap-1">
                <CardDescription>Our points so far</CardDescription>
                <CardTitle className="text-5xl font-semibold tabular-nums">
                  {score > 0 && "+"}
                  <NumberTicker value={score} />
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  Detection points only; reason points (+3 each) and points from
                  our fakes fooling other teams are added by the organisers.
                </p>
              </CardHeader>
              <CardContent className="grid gap-2">
                <Progress
                  value={(done.length / rows.length) * 100}
                  aria-label="Reveal progress"
                />
                <p className="text-xs text-muted-foreground tabular-nums">
                  {done.length} of {rows.length} revealed
                </p>
              </CardContent>
            </Card>
            <Card className="bg-card/80">
              <CardHeader>
                <CardTitle className="text-sm">Revealed</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2">
                {done.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nothing yet.</p>
                ) : (
                  done
                    .slice()
                    .reverse()
                    .map((r) => (
                      <p
                        key={r.sha}
                        className="flex items-center justify-between gap-2 text-sm"
                      >
                        <span className="truncate">{r.filename}</span>
                        <span
                          className="shrink-0 font-semibold tabular-nums"
                          style={{ color: TONE_VAR[OUTCOME[r.outcome].tone] }}
                        >
                          {r.points > 0 ? `+${r.points}` : r.points}
                        </span>
                      </p>
                    ))
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  )
}
