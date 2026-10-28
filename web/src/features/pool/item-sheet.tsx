import * as React from "react"

import { Card } from "@/components/ui/card"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { AIExplainCard } from "@/features/ai/ai-explain-card"
import { EvidenceList } from "@/features/detective/evidence-list"
import { MediaPreview } from "@/features/detective/media-preview"
import { VerdictDock } from "@/features/detective/verdict-dock"
import { PipelineTrace } from "@/features/pipeline/pipeline-trace"
import { api, type PoolItem } from "@/lib/api"

/** Full Detective view of one pool item, without leaving the table. */
export function ItemSheet({
  sha,
  onOpenChange,
}: {
  sha: string | null
  onOpenChange: (open: boolean) => void
}) {
  // Keep the fetched item with the id it belongs to; a different id reads as loading.
  const [loaded, setLoaded] = React.useState<{
    sha: string
    item: PoolItem | null
  } | null>(null)
  const item = loaded && loaded.sha === sha ? loaded.item : null

  React.useEffect(() => {
    if (!sha) return
    let alive = true
    api
      .poolItem(sha)
      .then((it) => alive && setLoaded({ sha, item: it }))
      .catch(() => alive && setLoaded({ sha, item: null }))
    return () => {
      alive = false
    }
  }, [sha])

  const v = item?.verdict
  return (
    <Sheet open={sha != null} onOpenChange={onOpenChange}>
      <SheetContent className="overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="truncate">
            {item?.filename ?? "Loading…"}
          </SheetTitle>
          <SheetDescription>
            {item
              ? `${item.media_kind} · ${item.status}`
              : "Fetching the item's verdict"}
          </SheetDescription>
        </SheetHeader>
        <div className="grid min-w-0 gap-4 px-4 pb-6">
          {!item ? (
            <Skeleton className="h-64" />
          ) : (
            <>
              <MediaPreview
                url={item.media_url}
                kind={item.media_kind}
                name={item.filename}
                signals={v?.signals}
              />
              {v ? (
                <>
                  <VerdictDock v={{ ...v, media_kind: item.media_kind }} />
                  <Card className="bg-card/80 p-5">
                    <h3 className="mb-2 text-sm font-semibold">Why</h3>
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      {v.reason_text}
                    </p>
                  </Card>
                  <AIExplainCard
                    verdict={{
                      ...v,
                      filename: item.filename,
                      media_kind: item.media_kind,
                    }}
                  />
                  <EvidenceList signals={v.signals} />
                  <PipelineTrace
                    verdict={{
                      ...v,
                      filename: item.filename,
                      media_kind: item.media_kind,
                    }}
                  />
                </>
              ) : item.status === "failed" ? (
                <p className="text-sm text-fake">
                  Analysis failed: {item.error}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Not analysed yet — it is {item.status}.
                </p>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
