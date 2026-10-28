import { useEffect, useRef, type ComponentPropsWithoutRef } from "react"
import { useMotionValue, useReducedMotion, useSpring } from "motion/react"

import { cn } from "@/lib/utils"

interface NumberTickerProps extends ComponentPropsWithoutRef<"span"> {
  value: number
  decimalPlaces?: number
}

const format = (n: number, d: number) =>
  Intl.NumberFormat("en-US", {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  }).format(Number(n.toFixed(d)))

/**
 * A number that shows its real value at once and only springs when the value changes later (e.g. the Reveal score).
 * Counting up from 0 on every visit was decorative, slowed the page, and let readers catch a wrong mid-count value.
 * Colour and font are inherited, so verdict tones and the mono stat style apply.
 */
export function NumberTicker({
  value,
  className,
  decimalPlaces = 0,
  ...props
}: NumberTickerProps) {
  const ref = useRef<HTMLSpanElement>(null)
  const reduce = useReducedMotion()
  const motionValue = useMotionValue(value)
  const springValue = useSpring(motionValue, { damping: 30, stiffness: 220 })

  useEffect(() => {
    if (reduce) springValue.jump(value)
    else motionValue.set(value)
  }, [value, reduce, motionValue, springValue])

  useEffect(
    () =>
      springValue.on("change", (latest) => {
        if (ref.current) ref.current.textContent = format(latest, decimalPlaces)
      }),
    [springValue, decimalPlaces]
  )

  return (
    <span
      ref={ref}
      className={cn("inline-block tabular-nums", className)}
      {...props}
    >
      {format(value, decimalPlaces)}
    </span>
  )
}
