import * as React from "react"

import { PageHeader } from "@/components/page-header"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useIsMobile } from "@/hooks/use-mobile"
import { usePipeline } from "@/hooks/use-pipeline"
import { usePool } from "@/hooks/use-pool"
import { api, type Pipeline, type Verdict } from "@/lib/api"

import { Investigator } from "./investigator"
import { PipelineCanvas } from "./pipeline-canvas"

type Media = keyof Pipeline["media"]
type Mode = "investigate" | "map"
const MEDIA: Media[] = ["image", "video", "audio", "text"]
const MAP = "map" // Select value for "no item traced"

export function PipelinePage() {
  const isMobile = useIsMobile()
  const pool = usePool()
  const { pipeline, error } = usePipeline()
  const [mode, setMode] = React.useState<Mode>("investigate")
  const [media, setMedia] = React.useState<Media>("image")
  const [traceSha, setTraceSha] = React.useState<string>(MAP)
  // Keep the fetched verdict with the id it belongs to; a different id reads as not loaded.
  const [trace, setTrace] = React.useState<{
    sha: string
    verdict: Verdict | null
  } | null>(null)

  React.useEffect(() => {
    if (traceSha === MAP) return
    let alive = true
    api
      .poolItem(traceSha)
      .then(
        (it) =>
          alive &&
          setTrace({
            sha: traceSha,
            verdict: it.verdict
              ? {
                  ...it.verdict,
                  filename: it.filename,
                  media_kind: it.media_kind,
                }
              : null,
          })
      )
      .catch(() => alive && setTrace({ sha: traceSha, verdict: null }))
    return () => {
      alive = false
    }
  }, [traceSha])

  const chooseMedia = (m: Media) => {
    setMedia(m)
    setTraceSha(MAP)
  }

  const spec = pipeline?.media[media]
  const traceable = (pool.data?.items ?? []).filter(
    (i) => i.status === "done" && i.media_kind === media
  )
  const verdict =
    traceSha !== MAP && trace?.sha === traceSha
      ? (trace.verdict ?? undefined)
      : undefined

  return (
    <div className="@container/main mx-auto grid w-full max-w-6xl gap-8 px-4 pt-10 pb-16">
      <PageHeader
        eyebrow="How it works"
        title="How Corncam decides"
        description={
          <>
            Every item takes the same path: ingest, independent detectors side
            by side, fusion, calibration, verdict. Investigate a file with AI
            and watch it move through the graph, or explore the map and trace
            analysed Pool items.
          </>
        }
        actions={
          <>
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={mode}
              onValueChange={(v) => v && setMode(v as Mode)}
              aria-label="Pipeline view"
            >
              <ToggleGroupItem value="investigate">
                Investigate with AI
              </ToggleGroupItem>
              <ToggleGroupItem value="map">Map & traces</ToggleGroupItem>
            </ToggleGroup>
          </>
        }
      />

      {error && (
        <p className="text-sm text-fake">
          Could not load the pipeline: {error}
        </p>
      )}

      {mode === "investigate" ? (
        pipeline ? (
          <Investigator pipeline={pipeline} />
        ) : (
          <Skeleton className="h-96" />
        )
      ) : (
        <Card className="bg-card/80">
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2 capitalize">
              {media}
              {spec && (
                <>
                  <Badge
                    variant={spec.covered ? "secondary" : "outline"}
                    className="rounded-full normal-case"
                  >
                    {spec.planned
                      ? "Planned"
                      : spec.covered
                        ? "Measured"
                        : "Experimental"}
                  </Badge>
                  {spec.calibrated && (
                    <Badge
                      variant="outline"
                      className="rounded-full normal-case"
                    >
                      Calibrated
                    </Badge>
                  )}
                </>
              )}
            </CardTitle>
            <CardDescription>
              {traceable.length > 0
                ? `${traceable.length} analysed ${media} item${traceable.length === 1 ? "" : "s"} in the Pool can be traced.`
                : `No analysed ${media} items in the Pool yet; showing the map.`}
            </CardDescription>
            <CardAction className="flex flex-wrap justify-end gap-2">
              {isMobile ? (
                <Select
                  value={media}
                  onValueChange={(v) => chooseMedia(v as Media)}
                >
                  <SelectTrigger size="sm" aria-label="Media type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MEDIA.map((m) => (
                      <SelectItem key={m} value={m} className="capitalize">
                        {m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <ToggleGroup
                  type="single"
                  variant="outline"
                  size="sm"
                  value={media}
                  onValueChange={(v) => v && chooseMedia(v as Media)}
                >
                  {MEDIA.map((m) => (
                    <ToggleGroupItem key={m} value={m} className="capitalize">
                      {m}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              )}
              <Select
                value={traceSha}
                onValueChange={setTraceSha}
                disabled={traceable.length === 0}
              >
                <SelectTrigger
                  size="sm"
                  className="max-w-56"
                  aria-label="Trace an analysed item"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={MAP}>Map only</SelectItem>
                  {traceable.map((i) => (
                    <SelectItem key={i.sha} value={i.sha}>
                      {i.filename}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardAction>
          </CardHeader>
          <CardContent>
            {!pipeline || !spec ? (
              <Skeleton className="h-96" />
            ) : traceSha !== MAP && !verdict ? (
              <Skeleton className="h-96" />
            ) : (
              <PipelineCanvas
                spec={spec}
                steps={pipeline.steps}
                verdict={verdict}
              />
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
