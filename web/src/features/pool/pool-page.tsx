import * as React from "react"
import {
  DownloadIcon,
  FolderUpIcon,
  PlayIcon,
  RotateCcwIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react"
import { toast } from "sonner"

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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { usePool } from "@/hooks/use-pool"
import { api, type PoolItem } from "@/lib/api"
import { toneFor } from "@/lib/verdict-style"

import { ItemSheet } from "./item-sheet"

type VerdictFilter = "all" | "fake" | "real" | "uncertain" | "pending"

function matches(i: PoolItem, f: VerdictFilter) {
  if (f === "all") return true
  if (f === "pending") return i.status !== "done"
  if (f === "uncertain") return i.tier === "uncertain"
  return i.label === f && i.tier !== "uncertain"
}

export function PoolPage() {
  const pool = usePool()
  const [filter, setFilter] = React.useState<VerdictFilter>("all")
  const [open, setOpen] = React.useState<string | null>(null)
  const [uploading, setUploading] = React.useState(false)
  const fileRef = React.useRef<HTMLInputElement>(null)
  const dirRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    // Folder picker: non-standard attribute, set imperatively so TS/React accept it.
    dirRef.current?.setAttribute("webkitdirectory", "")
  }, [])

  const upload = async (list: FileList | null) => {
    const files = Array.from(list ?? []).filter((f) => !f.name.startsWith("."))
    if (!files.length) return
    setUploading(true)
    try {
      const r = await api.poolUpload(files)
      toast.success(`Imported ${r.added} item${r.added === 1 ? "" : "s"}`, {
        description: "Run Analyse all to judge them.",
      })
      await pool.refresh()
    } catch (e) {
      toast.error("Import failed", { description: (e as Error).message })
    } finally {
      setUploading(false)
    }
  }

  const analyse = async (force = false) => {
    try {
      const r = await api.poolAnalyse(force)
      toast.info(
        `Analysing ${r.queued} item${r.queued === 1 ? "" : "s"} in the background`
      )
      await pool.refresh()
    } catch (e) {
      toast.error("Could not start analysis", {
        description: (e as Error).message,
      })
    }
  }

  const clear = async () => {
    if (
      !window.confirm(
        "Remove every item and verdict from the local pool? This cannot be undone."
      )
    )
      return
    await api.poolClear()
    await pool.refresh()
  }

  const s = pool.data?.summary
  const items = (pool.data?.items ?? []).filter((i) => matches(i, filter))

  return (
    <div className="@container/main mx-auto grid w-full max-w-6xl gap-8 px-4 pt-10 pb-16">
      <PageHeader
        eyebrow="Blue team · arena items"
        title="Evidence Pool"
        description={
          <>
            Import the arena's items, judge them all, and export the submission:
            a verdict, a confidence and a reason for each.
          </>
        }
        actions={
          <>
            <input
              ref={fileRef}
              type="file"
              multiple
              className="sr-only"
              onChange={(e) => void upload(e.target.files)}
              aria-label="Import files"
            />
            <input
              ref={dirRef}
              type="file"
              multiple
              className="sr-only"
              onChange={(e) => void upload(e.target.files)}
              aria-label="Import a folder"
            />
            <Button
              variant="outline"
              size="sm"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
            >
              <UploadIcon aria-hidden /> Files
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={uploading}
              onClick={() => dirRef.current?.click()}
            >
              <FolderUpIcon aria-hidden /> Folder
            </Button>
            <Button
              size="sm"
              disabled={!s || s.total === 0 || pool.busy}
              onClick={() => void analyse(false)}
            >
              <PlayIcon aria-hidden />{" "}
              {pool.busy ? "Analysing…" : "Analyse all"}
            </Button>
          </>
        }
      />

      {s && s.total > 0 && (
        <Card className="bg-card/80">
          <CardContent className="grid gap-3 pt-6">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span>
                {s.done} of {s.total} analysed
                {s.failed > 0 && ` · ${s.failed} failed`}
              </span>
              <span className="flex gap-2">
                <Button
                  asChild
                  variant="outline"
                  size="sm"
                  aria-disabled={s.done === 0}
                >
                  <a href={api.poolExportUrl("csv")} download>
                    <DownloadIcon aria-hidden /> Submission CSV
                  </a>
                </Button>
                <Button
                  asChild
                  variant="outline"
                  size="sm"
                  aria-disabled={s.done === 0}
                >
                  <a href={api.poolExportUrl("json")} download>
                    <DownloadIcon aria-hidden /> JSON
                  </a>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pool.busy || s.done === 0}
                  onClick={() => void analyse(true)}
                >
                  <RotateCcwIcon aria-hidden /> Re-analyse all
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void clear()}
                  aria-label="Clear the pool"
                >
                  <Trash2Icon aria-hidden />
                </Button>
              </span>
            </div>
            <Progress
              value={(s.done / s.total) * 100}
              aria-label="Pool analysis progress"
            />
          </CardContent>
        </Card>
      )}

      <Card className="bg-card/80">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>Items</CardTitle>
            <CardDescription>
              Select a row to see the full evidence.
            </CardDescription>
          </div>
          <ToggleGroup
            type="single"
            value={filter}
            onValueChange={(v) => v && setFilter(v as VerdictFilter)}
            variant="outline"
            size="sm"
          >
            {(["all", "fake", "real", "uncertain", "pending"] as const).map(
              (f) => (
                <ToggleGroupItem key={f} value={f} className="capitalize">
                  {f}
                </ToggleGroupItem>
              )
            )}
          </ToggleGroup>
        </CardHeader>
        <CardContent>
          {pool.status === "loading" ? (
            <Skeleton className="h-40" />
          ) : pool.status === "error" ? (
            <p className="text-sm text-fake">
              Could not load the pool: {pool.error}
            </p>
          ) : (pool.data?.items.length ?? 0) === 0 ? (
            <div className="grid gap-3 py-6 text-sm text-muted-foreground">
              {[
                "Import the Evidence Pool — files or a whole folder. Nothing leaves this machine.",
                "Analyse all — the Detective judges each item in the background.",
                "Export the submission — verdict, confidence and reason per item.",
              ].map((t, i) => (
                <p key={t} className="flex gap-3">
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-brand/15 text-xs font-semibold text-brand">
                    {i + 1}
                  </span>
                  {t}
                </p>
              ))}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-14" />
                  <TableHead>Item</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Verdict</TableHead>
                  <TableHead className="text-right">Confidence</TableHead>
                  <TableHead className="hidden md:table-cell">Reason</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((i) => (
                  <TableRow
                    key={i.sha}
                    className="cursor-pointer"
                    tabIndex={0}
                    onClick={() => setOpen(i.sha)}
                    onKeyDown={(e) =>
                      (e.key === "Enter" || e.key === " ") &&
                      (e.preventDefault(), setOpen(i.sha))
                    }
                    aria-label={`Open ${i.filename}`}
                  >
                    <TableCell>
                      {i.media_kind === "image" ? (
                        <img
                          src={i.media_url}
                          alt=""
                          className="size-10 rounded-md object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <span className="grid size-10 place-items-center rounded-md bg-muted text-[10px] uppercase">
                          {i.media_kind}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="max-w-[220px] truncate font-medium">
                      {i.filename}
                    </TableCell>
                    <TableCell className="capitalize">{i.media_kind}</TableCell>
                    <TableCell>
                      {i.label ? (
                        <VerdictPill
                          tone={toneFor({
                            label: i.label,
                            tier: i.tier ?? "low",
                          })}
                        >
                          {i.tier === "uncertain"
                            ? `${i.label} · unsure`
                            : i.label}
                        </VerdictPill>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {i.confidence != null
                        ? `${Math.round(i.confidence * 100)}%`
                        : "—"}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <code className="text-xs text-muted-foreground">
                        {i.reason_code ?? "—"}
                      </code>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          i.status === "failed" ? "destructive" : "outline"
                        }
                        className="rounded-full capitalize"
                      >
                        {i.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <ItemSheet sha={open} onOpenChange={(o) => !o && setOpen(null)} />
    </div>
  )
}
