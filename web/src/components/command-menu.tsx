import * as React from "react"

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { GROUPS, ROUTES, type RouteId } from "@/lib/routes"

/** ⌘K / Ctrl+K: jump to any page. */
export function CommandMenu({
  open,
  onOpenChange,
  onNavigate,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  onNavigate: (r: RouteId) => void
}) {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        onOpenChange(!open)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onOpenChange])

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Go to"
      description="Jump to a page"
    >
      <CommandInput placeholder="Go to…" />
      <CommandList>
        <CommandEmpty>No page found.</CommandEmpty>
        {GROUPS.map((group) => (
          <CommandGroup key={group} heading={group}>
            {ROUTES.filter((r) => r.group === group).map((r) => (
              <CommandItem
                key={r.id}
                value={`${r.label} ${r.description}`}
                onSelect={() => {
                  onNavigate(r.id)
                  onOpenChange(false)
                }}
              >
                <r.icon aria-hidden />
                <span>{r.label}</span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {r.description}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
  )
}
