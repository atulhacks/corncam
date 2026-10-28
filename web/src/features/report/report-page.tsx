import * as React from "react"
import { DownloadIcon, Trash2Icon, UploadIcon } from "lucide-react"
import { toast } from "sonner"

import { StatStrip } from "@/components/stat-strip"
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
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { api, type Outcome, type Report, type ReportRow } from "@/lib/api"
import { TONE_VAR } from "@/lib/verdict-style"

import { AIReportCard } from "../ai/ai-report-card"
import { ItemSheet } from "../pool/item-sheet"

const OUTCOME_COPY: Record<Outcome, string> = {
  caught: "Caught",
  cleared: "Cleared",
  false_alarm: "False alarm",
  missed: "Missed",
}

// Right calls read as "real" (good), wrong calls as "fake" (bad); text always carries the meaning too.
const OUTCOME_TONE: Record<Outcome, keyof typeof TONE_VAR> = {
  caught: "real",
  cleared: "real",
  false_alarm: "fake",
  missed: "fake",
}

const pct = (x: number | null) => (x == null ? "—" : `${Math.round(x * 100)}%`)

function OutcomeBadge({ outcome }: { outcome: Outcome }) {
  return (
    <VerdictPill tone={OUTCOME_TONE[outcome]}>
      {OUTCOME_COPY[outcome]}
    </VerdictPill>
  )
}

function MistakeList({
  title,
  description,
  rows,
  empty,
  onOpen,
}: {
  title: string
  description: string
  rows: ReportRow[]
  empty: string
  onOpen: (sha: string) => void
}) {
  return (
    <Card className="bg-card/80">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{empty}</p>
        ) : (
          rows.map((r) => (
            <button
              key={r.sha}
              type="button"
              onClick={() => onOpen(r.sha)}
              className="grid gap-1 rounded-lg border p-3 text-left text-sm transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <span className="flex flex-wrap items-center justify-between gap-2">
                <span className="truncate font-medium">{r.filename}</span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  <span className="capitalize">{r.media_type}</span> · called{" "}
                  {r.call} at {pct(r.confidence)} · {r.points} pts
                </span>
              </span>
              <span className="text-pretty">{r.why}</span>
              <span className="text-pretty text-muted-foreground">
                <span className="font-medium text-foreground">Improve: </span>
                {r.improve}
              </span>
            </button>
          ))
        )}
      </CardContent>
    </Card>
  )
}

export function ReportPage() {
  const [report, setReport] = React.useState<Report | null>(null)
  // Bumped on every key import or removal, so an AI summary of an older key is never shown.
  const [keyVersion, setKeyVersion] = React.useState(0)
  const [status, setStatus] = React.useState<"loading" | "ready" | "error">(
    "loading"
  )
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [open, setOpen] = React.useState<string | null>(null)
  const fileRef = React.useRef<HTMLInputElement>(null)

  const load = React.useCallback(async () => {
    try {
      setReport(await api.report())
      setStatus("ready")
    } catch (e) {
      setError((e as Error).message)
      setStatus("error")
    }
  }, [])

  React.useEffect(() => {
    let alive = true
    api
      .report()
      .then((r) => {
        if (!alive) return
        setReport(r)
        setStatus("ready")
      })
      .catch((e: Error) => {
        if (!alive) return
        setError(e.message)
        setStatus("error")
      })
    return () => {
      alive = false
    }
  }, [])

  const importKey = async (list: FileList | null) => {
    const file = list?.[0]
    if (!file) return
    setBusy(true)
    try {
      const r = await api.reportKey(file)
      setReport(r)
      setKeyVersion((v) => v + 1)
      setStatus("ready")
      toast.success(`Scored ${r.n} item${r.n === 1 ? "" : "s"}`, {
        description:
          r.unmatched_key.length > 0
            ? `${r.unmatched_key.length} key entries are not in our pool.`
            : "Every key entry matched an analysed item.",
      })
    } catch (e) {
      toast.error("Could not read the answer key", {
        description: (e as Error).message,
      })
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ""
    }
  }

  const clear = async () => {
    if (!window.confirm("Remove the imported answer key? Pool verdicts stay."))
      return
    await api.reportClear()
    setKeyVersion((v) => v + 1)
    await load()
  }

  return (
    <div className="@container/main mx-auto grid w-full max-w-[1600px] grid-cols-1 gap-8 px-4 pt-10 md:px-6 xl:px-10 pb-16">
      <PageHeader
        eyebrow="Arena · after the game"
        title="Post-game Report"
        description={
          <>
            Import the organisers' answer key to score every Pool verdict with
            the arena's points, and see what slipped through, why, and how to
            improve.
          </>
        }
        actions={
          <>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              onChange={(e) => void importKey(e.target.files)}
              aria-label="Import the answer key"
            />
            <Button
              size="sm"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
            >
              <UploadIcon aria-hidden />{" "}
              {report ? "Replace answer key" : "Import answer key"}
            </Button>
            {report && (
              <>
                <Button asChild variant="outline" size="sm">
                  <a href={api.reportMarkdownUrl} download>
                    <DownloadIcon aria-hidden /> Report (.md)
                  </a>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void clear()}
                  aria-label="Remove the answer key"
                >
                  <Trash2Icon aria-hidden />
                </Button>
              </>
            )}
          </>
        }
      />

      {status === "loading" ? (
        <Skeleton className="h-40" />
      ) : status === "error" ? (
        <p className="text-sm text-fake">Could not load the report: {error}</p>
      ) : !report ? (
        <Card className="bg-card/80">
          <CardContent className="grid gap-3 text-sm text-muted-foreground">
            {[
              "Analyse the arena's items in the Evidence Pool.",
              "After the reveal, import the organisers' answer key: a CSV with a file name or sha256 column and a fake/real label column.",
              "Read what slipped through and why, then download the report for the post-game write-up.",
            ].map((t, i) => (
              <p key={t} className="flex gap-3">
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-brand/15 text-xs font-semibold text-brand">
                  {i + 1}
                </span>
                {t}
              </p>
            ))}
          </CardContent>
        </Card>
      ) : (
        <>
          <StatStrip
            stats={[
              {
                label: "Points",
                value: `${report.points > 0 ? "+" : ""}${report.points}`,
                hint: `Reason points ${report.reason_points}`,
              },
              {
                label: "Accuracy",
                value: pct(report.accuracy),
                hint: `${report.n} judged · ${report.n_fake} fake · ${report.n_real} real`,
              },
              {
                label: "Mistakes",
                value: report.counts.false_alarm + report.counts.missed,
                tone:
                  report.counts.false_alarm + report.counts.missed > 0
                    ? "fake"
                    : "real",
                hint: `${report.counts.false_alarm} false alarm · ${report.counts.missed} missed`,
              },
              {
                label: "Brier score",
                value: report.brier == null ? "—" : report.brier.toFixed(3),
                hint: "Lower means our confidence was honest",
              },
            ]}
          />

          <AIReportCard version={keyVersion} />

          <Card className="bg-card/80">
            <CardHeader>
              <CardTitle>Lessons</CardTitle>
              <CardDescription>
                What to change before the next game.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="grid list-disc gap-2 pl-5 text-sm text-pretty">
                {report.lessons.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <div className="grid gap-6 @4xl/main:grid-cols-2">
            <MistakeList
              title="Fakes that slipped through"
              description="Fakes we called real (−3 each). Select one for the full evidence."
              rows={report.slipped}
              empty="None: every fake was caught."
              onOpen={setOpen}
            />
            <MistakeList
              title="False alarms"
              description="Real items we called fake (−5 each)."
              rows={report.false_alarms}
              empty="None: every real item was cleared."
              onOpen={setOpen}
            />
          </div>

          <Card className="bg-card/80">
            <CardHeader>
              <CardTitle>Every judged item</CardTitle>
              <CardDescription>
                Our call against the truth, with the points it earned.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Truth</TableHead>
                    <TableHead>Our call</TableHead>
                    <TableHead>Outcome</TableHead>
                    <TableHead className="text-right">Points</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.rows.map((r) => (
                    <TableRow
                      key={r.sha}
                      className="cursor-pointer"
                      tabIndex={0}
                      onClick={() => setOpen(r.sha)}
                      onKeyDown={(e) =>
                        (e.key === "Enter" || e.key === " ") &&
                        (e.preventDefault(), setOpen(r.sha))
                      }
                      aria-label={`Open ${r.filename}`}
                    >
                      <TableCell className="max-w-[220px] truncate font-medium">
                        {r.filename}
                      </TableCell>
                      <TableCell className="capitalize">
                        {r.media_type}
                      </TableCell>
                      <TableCell className="capitalize">{r.truth}</TableCell>
                      <TableCell className="capitalize tabular-nums">
                        {r.call} · {pct(r.confidence)}
                      </TableCell>
                      <TableCell>
                        <OutcomeBadge outcome={r.outcome} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.points > 0 ? `+${r.points}` : r.points}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {report.unmatched_key.length > 0 && (
                <p className="mt-4 text-xs text-muted-foreground">
                  Not in our pool:{" "}
                  {report.unmatched_key.slice(0, 10).join(", ")}
                  {report.unmatched_key.length > 10 &&
                    ` and ${report.unmatched_key.length - 10} more`}
                </p>
              )}
            </CardContent>
          </Card>
        </>
      )}

      <ItemSheet sha={open} onOpenChange={(o) => !o && setOpen(null)} />
    </div>
  )
}
