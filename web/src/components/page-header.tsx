import type * as React from "react"

/**
 * Every page's header ("proof desk"): mono eyebrow, serif title, one-paragraph lede, actions on the right. Pattern from Crosscheck ("FORENSICS DESK / Media Verification").
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string
  title: string
  description?: React.ReactNode
  actions?: React.ReactNode
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="grid max-w-2xl gap-2">
        <p className="eyebrow">{eyebrow}</p>
        <h1 className="font-heading text-4xl font-medium tracking-tight sm:text-[2.75rem] sm:leading-[1.1]">
          {title}
        </h1>
        {description && (
          <p className="text-pretty text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      )}
    </header>
  )
}
