import type * as React from "react"

import { cn } from "@/lib/utils"

export type Stat = {
  label: string
  value: React.ReactNode
  /** small unit after the value, e.g. "%" or "s" */
  unit?: string
  hint?: React.ReactNode
  /** colour the value (verdict tones only) */
  tone?: "fake" | "real" | "unsure"
}

const TONE = {
  fake: "text-fake",
  real: "text-real",
  unsure: "text-unsure",
} as const

/**
 * A row of key numbers under a heavy rule, cells split by hairlines (Crosscheck "Analytics"). The grid answers to the
 * page's own width (@container/main), not the viewport.
 */
export function StatStrip({
  stats,
  className,
}: {
  stats: Stat[]
  className?: string
}) {
  return (
    <dl
      className={cn(
        "grid grid-cols-2 border-t-2 border-b border-t-rule @3xl/main:grid-cols-4",
        "[&>div]:border-b @3xl/main:[&>div]:border-b-0 @3xl/main:[&>div+div]:border-l [&>div:nth-child(2n)]:border-l",
        className
      )}
    >
      {stats.map((s) => (
        <div
          key={s.label}
          // Left-column cells sit flush with the rule: cells 1 and 3 in the 2x2 layout, only cell 1 when 4 across.
          className="grid content-start gap-2 px-5 py-5 odd:pl-0 @3xl/main:nth-3:pl-5"
        >
          <dt className="eyebrow">{s.label}</dt>
          <dd
            className={cn(
              "font-mono text-3xl tracking-tight tabular-nums",
              s.tone && TONE[s.tone]
            )}
          >
            {s.value}
            {s.unit && (
              <span className="ml-0.5 text-base text-muted-foreground">
                {s.unit}
              </span>
            )}
          </dd>
          {s.hint && (
            <dd className="text-xs text-pretty text-muted-foreground">
              {s.hint}
            </dd>
          )}
        </div>
      ))}
    </dl>
  )
}
