import { Card } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { usePipeline } from "@/hooks/use-pipeline"
import type { Pipeline, Verdict } from "@/lib/api"

import { PipelineCanvas } from "./pipeline-canvas"

/** "How this was decided": one verdict traced through every step of the pipeline. */
export function PipelineTrace({ verdict }: { verdict: Verdict }) {
  const { pipeline } = usePipeline()
  const spec = pipeline?.media[verdict.media_type as keyof Pipeline["media"]]
  return (
    <Card className="bg-card/80 p-5">
      <h3 className="text-sm font-semibold">How this was decided</h3>
      {!pipeline ? (
        <Skeleton className="h-48" />
      ) : spec ? (
        <PipelineCanvas
          spec={spec}
          steps={pipeline.steps}
          verdict={verdict}
          height={460}
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          No pipeline map for this media type.
        </p>
      )}
    </Card>
  )
}
