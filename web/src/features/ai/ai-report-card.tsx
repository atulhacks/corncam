import * as React from "react"
import { SparklesIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useAIStatus } from "@/hooks/use-ai-status"
import { api, type AIReport } from "@/lib/api"

/** The post-game narrative, written by the AI from the scored report (items anonymised, numbers kept exact). */
export function AIReportCard({ version }: { version: number }) {
  const status = useAIStatus()
  const [result, setResult] = React.useState<{
    version: number
    value: AIReport
  } | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const r = result?.version === version ? result.value : null

  const write = async () => {
    setLoading(true)
    setError(null)
    try {
      setResult({ version, value: await api.aiReport() })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card className="bg-card/80">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SparklesIcon className="size-4 text-brand" aria-hidden /> AI summary
        </CardTitle>
        <CardDescription>
          {status?.configured
            ? `Written by ${status.provider} (${status.model}) from the scored results; items are anonymised.`
            : "Add DEEPSEEK_API_KEY to .env and restart the API to write the narrative with AI."}
        </CardDescription>
        {status?.configured && (
          <CardAction>
            <Button size="sm" onClick={() => void write()} disabled={loading}>
              <SparklesIcon aria-hidden />{" "}
              {loading ? "Writing…" : r ? "Rewrite" : "Write with AI"}
            </Button>
          </CardAction>
        )}
      </CardHeader>
      {(loading || r || error) && (
        <CardContent className="grid gap-4 text-sm">
          {loading ? (
            <Skeleton className="h-32" />
          ) : r ? (
            <>
              <p className="leading-relaxed text-pretty">{r.summary}</p>
              {r.slipped_through?.length > 0 && (
                <div className="grid gap-1">
                  <p className="text-xs font-medium">What went wrong</p>
                  <ul className="grid list-disc gap-1 pl-5 text-pretty text-muted-foreground">
                    {r.slipped_through.map((t) => (
                      <li key={t}>{t}</li>
                    ))}
                  </ul>
                </div>
              )}
              {r.improvements?.length > 0 && (
                <div className="grid gap-1">
                  <p className="text-xs font-medium">How to improve</p>
                  <ol className="grid list-decimal gap-1 pl-5 text-pretty text-muted-foreground">
                    {r.improvements.map((t) => (
                      <li key={t}>{t}</li>
                    ))}
                  </ol>
                </div>
              )}
            </>
          ) : null}
          {error && <p className="text-fake">{error}</p>}
        </CardContent>
      )}
    </Card>
  )
}
