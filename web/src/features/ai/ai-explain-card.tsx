import * as React from "react"
import { SendIcon, SparklesIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { useAIStatus } from "@/hooks/use-ai-status"
import { api, type AIExplanation, type ChatTurn, type Verdict } from "@/lib/api"

/**
 * The AI layer on one verdict: a plain-language explanation and a grounded Q&A. The AI only sees our detectors'
 * scores and findings (no media, no file name) and never changes the verdict.
 */
export function AIExplainCard({ verdict }: { verdict: Verdict }) {
  const status = useAIStatus()
  const [explanation, setExplanation] = React.useState<{
    id: string
    value: AIExplanation
  } | null>(null)
  const [chat, setChat] = React.useState<{ id: string; turns: ChatTurn[] }>({
    id: verdict.item_id,
    turns: [],
  })
  const [loading, setLoading] = React.useState(false)
  const [asking, setAsking] = React.useState(false)
  const [question, setQuestion] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)

  // Everything here belongs to one verdict; a new verdict starts fresh.
  const ex = explanation?.id === verdict.item_id ? explanation.value : null
  const turns = chat.id === verdict.item_id ? chat.turns : []

  const explain = async () => {
    setLoading(true)
    setError(null)
    try {
      setExplanation({
        id: verdict.item_id,
        value: await api.aiExplain(verdict),
      })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const ask = async (e: React.FormEvent) => {
    e.preventDefault()
    const q = question.trim()
    if (!q) return
    setAsking(true)
    setError(null)
    const history = turns
    setChat({
      id: verdict.item_id,
      turns: [...history, { role: "user", content: q }],
    })
    setQuestion("")
    try {
      const { answer } = await api.aiAsk(verdict, q, history)
      setChat({
        id: verdict.item_id,
        turns: [
          ...history,
          { role: "user", content: q },
          { role: "assistant", content: answer },
        ],
      })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setAsking(false)
    }
  }

  return (
    <Card className="gap-4 bg-card/80 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <SparklesIcon className="size-4 text-brand" aria-hidden /> AI
          explanation
        </h3>
        {status?.configured && !ex && (
          <Button size="sm" onClick={() => void explain()} disabled={loading}>
            <SparklesIcon aria-hidden />{" "}
            {loading ? "Explaining…" : "Explain with AI"}
          </Button>
        )}
      </div>

      {status && !status.configured ? (
        <p className="text-sm text-pretty text-muted-foreground">
          Add <code className="text-foreground">DEEPSEEK_API_KEY</code> to the
          project's <code className="text-foreground">.env</code> and restart
          the API to turn on AI explanations.
        </p>
      ) : loading ? (
        <Skeleton className="h-28" />
      ) : ex ? (
        <div className="grid gap-3 text-sm">
          <p className="font-semibold text-pretty">{ex.headline}</p>
          <p className="leading-relaxed text-pretty text-muted-foreground">
            {ex.explanation}
          </p>
          {ex.triggers?.length > 0 && (
            <div className="grid gap-1">
              <p className="text-xs font-medium">What the detectors noticed</p>
              <ul className="grid list-disc gap-1 pl-5 text-pretty text-muted-foreground">
                {ex.triggers.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </div>
          )}
          {ex.check_yourself?.length > 0 && (
            <div className="grid gap-1">
              <p className="text-xs font-medium">Check it yourself</p>
              <ul className="grid list-disc gap-1 pl-5 text-pretty text-muted-foreground">
                {ex.check_yourself.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </div>
          )}
          {ex.caveat && (
            <p className="text-xs text-pretty text-muted-foreground">
              <span className="font-medium text-foreground">
                Could be wrong if:{" "}
              </span>
              {ex.caveat}
            </p>
          )}
        </div>
      ) : (
        <p className="text-sm text-pretty text-muted-foreground">
          Get a plain-language explanation of this verdict, then ask follow-up
          questions.
        </p>
      )}

      {turns.length > 0 && (
        <div className="grid gap-2 border-t pt-3 text-sm" aria-live="polite">
          {turns.map((t, i) => (
            <p
              key={i}
              className={
                t.role === "user"
                  ? "font-medium text-pretty"
                  : "leading-relaxed text-pretty text-muted-foreground"
              }
            >
              {t.content}
            </p>
          ))}
          {asking && <Skeleton className="h-10" />}
        </div>
      )}

      {status?.configured && (
        <form onSubmit={(e) => void ask(e)} className="flex gap-2">
          <Input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask about this verdict, e.g. why not 100%?"
            aria-label="Ask the Detective about this verdict"
            maxLength={500}
          />
          <Button
            type="submit"
            size="icon"
            disabled={asking || !question.trim()}
            aria-label="Send question"
          >
            <SendIcon aria-hidden />
          </Button>
        </form>
      )}

      {error && <p className="text-sm text-fake">{error}</p>}
      {status?.configured && (
        <p className="text-xs text-muted-foreground">
          Written by {status.provider} ({status.model}) from our detectors'
          findings only. It explains the verdict; it never changes it.
        </p>
      )}
    </Card>
  )
}
