import { AlertTriangleIcon } from "lucide-react"

import type { Verdict } from "@/lib/api"
import {
  confidenceWords,
  TIER_COPY,
  TONE_VAR,
  toneFor,
} from "@/lib/verdict-style"

/** The verdict summary: the page's primary readout, a flat panel with a hairline outline. */
export function VerdictDock({ v }: { v: Verdict }) {
  const tone = toneFor(v)
  const pct = Math.round(v.p_fake * 100)

  return (
    <section className="enter rounded-lg border bg-card" aria-live="polite">
      <div className="grid grid-cols-2 divide-x border-b">
        <div className="grid content-start gap-1.5 p-5">
          <p className="eyebrow">Verdict</p>
          <p
            className="font-mono text-4xl font-medium tracking-tight"
            style={{ color: TONE_VAR[tone] }}
          >
            {v.label.toUpperCase()}
          </p>
          <p className="text-xs text-pretty text-muted-foreground">
            {TIER_COPY[v.tier]}
          </p>
        </div>
        <div className="grid content-start gap-1.5 p-5">
          <p className="eyebrow">P(fake)</p>
          <p className="font-mono text-4xl font-medium tracking-tight tabular-nums">
            {pct}
            <span className="ml-0.5 text-base text-muted-foreground">%</span>
          </p>
          <p className="text-xs text-muted-foreground">
            {Math.round(v.confidence * 100)}% confidence ·{" "}
            {confidenceWords(v.p_fake)}
          </p>
        </div>
      </div>
      <div className="grid gap-3 p-5">
        {/* How close the call was: the fill is P(fake), the tick is the 50% line where it flips to "fake". */}
        <div className="grid gap-1">
          <div
            className="relative h-1.5 rounded-full bg-foreground/10"
            role="meter"
            aria-label="Probability the item is fake"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
          >
            <div
              className="h-full w-full origin-left rounded-full transition-transform duration-300 ease-snappy"
              style={{
                background: TONE_VAR[tone],
                transform: `scaleX(${Math.max(0.02, v.p_fake)})`,
              }}
            />
            <span
              className="absolute -top-1 left-1/2 h-3.5 w-px bg-foreground/60"
              aria-hidden
            />
          </div>
          <div className="flex justify-between font-mono text-[10px] text-muted-foreground uppercase">
            <span>real</span>
            <span>call line 50%</span>
            <span>fake</span>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          {v.votes} detector vote{v.votes === 1 ? "" : "s"} · reason{" "}
          <code className="rounded bg-foreground/10 px-1 py-0.5 break-all">
            {v.reason_code}
          </code>
        </p>
        {v.experimental && (
          <p className="flex items-center gap-1.5 text-xs text-unsure">
            <AlertTriangleIcon className="size-3.5" aria-hidden /> Media type
            not fully covered yet — treat with caution
          </p>
        )}
      </div>
    </section>
  )
}
