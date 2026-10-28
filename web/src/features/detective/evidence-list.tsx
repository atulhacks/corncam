import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { Category, Signal } from "@/lib/api"
import { CATEGORY_COPY, CATEGORY_ICON, rankTone } from "@/lib/verdict-style"
import { cn } from "@/lib/utils"

const TONE_CLASS = {
  fake: "bg-fake",
  real: "bg-real",
  unsure: "bg-unsure",
  muted: "bg-muted-foreground/40",
} as const

/** A detector's fake probability as a thin bar, coloured by its rank. */
export function ScoreMeter({ signal: s }: { signal: Signal }) {
  return (
    <div
      className="h-1.5 overflow-hidden rounded-full bg-foreground/10"
      role="meter"
      aria-label={`${s.name} fake probability`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={s.score == null ? undefined : Math.round(s.score * 100)}
    >
      <div
        className={cn(
          // scaleX on the GPU instead of width (no re-layout per frame); grows from the left like a fill
          "h-full w-full origin-left rounded-full transition-transform duration-300 ease-snappy",
          TONE_CLASS[rankTone(s.rank)]
        )}
        style={{
          transform: `scaleX(${s.score == null ? 0 : Math.max(0.03, s.score)})`,
        }}
      />
    </div>
  )
}

/** Evidence cards grouped by category (content layer: solid). */
export function EvidenceList({ signals }: { signals: Signal[] }) {
  const groups = Object.entries(
    signals.reduce<Partial<Record<Category, Signal[]>>>((acc, s) => {
      ;(acc[s.category] ??= []).push(s)
      return acc
    }, {})
  ) as [Category, Signal[]][]

  return (
    <div className="grid gap-4">
      {groups.map(([category, items]) => {
        const Icon = CATEGORY_ICON[category]
        return (
          <Card key={category} className="gap-3 bg-card/80 py-4">
            <CardHeader className="px-5">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Icon className="size-4 text-brand" aria-hidden />{" "}
                {CATEGORY_COPY[category]}
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 px-5">
              {items.map((s) => {
                return (
                  <div key={s.name} className="grid gap-1.5">
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm">
                      <span className="min-w-0 font-medium break-words">
                        {s.name}
                      </span>
                      <span className="flex items-center gap-2">
                        {s.seconds != null && (
                          <span className="text-xs text-muted-foreground tabular-nums">
                            {s.seconds.toFixed(2)}s
                          </span>
                        )}
                        <Badge
                          variant="outline"
                          className="rounded-full capitalize"
                        >
                          {s.rank}
                          {s.policy === "trust" && " · trusted"}
                          {s.decisive && " · decisive"}
                        </Badge>
                      </span>
                    </div>
                    <ScoreMeter signal={s} />
                    <p className="text-sm leading-relaxed break-words text-muted-foreground">
                      {s.evidence}
                    </p>
                  </div>
                )
              })}
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
