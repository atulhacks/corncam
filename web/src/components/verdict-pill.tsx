import type * as React from "react"

import { cn } from "@/lib/utils"
import { TONE_VAR } from "@/lib/verdict-style"

/** Outlined status pill with a colour dot (Loopframe pattern): text carries the meaning, colour reinforces it. */
export function VerdictPill({
  tone,
  children,
  className,
}: {
  tone: keyof typeof TONE_VAR | "muted"
  children: React.ReactNode
  className?: string
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 font-mono text-[11px] font-medium tracking-wide whitespace-nowrap uppercase",
        className
      )}
    >
      <span
        className="size-1.5 shrink-0 rounded-full"
        style={{
          background:
            tone === "muted" ? "var(--muted-foreground)" : TONE_VAR[tone],
        }}
        aria-hidden
      />
      {children}
    </span>
  )
}
