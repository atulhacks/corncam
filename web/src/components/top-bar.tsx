import { SearchIcon, UploadIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { routeById, type RouteId } from "@/lib/routes"

/**
 * Flush top bar with a bottom hairline ("proof desk" shell).
 * Grid contract: 64px tall so its bottom hairline continues the sidebar header's; contents sit in the page column
 * (max-w-[1600px], px-4 md:px-6 xl:px-10) so the trigger and actions align with page content edges.
 */
export function TopBar({
  route,
  onOpenCommand,
  onAnalyse,
}: {
  route: RouteId
  onOpenCommand: () => void
  onAnalyse: () => void
}) {
  const r = routeById(route)
  return (
    <header className="sticky top-0 z-30 h-16 shrink-0 border-b bg-background">
      <div className="mx-auto flex h-full w-full max-w-[1600px] items-center gap-3 px-4 md:px-6 xl:px-10">
        {/* -ml-1.5: optically align the trigger's glyph (not its hit box) with the page's left edge */}
        <SidebarTrigger className="-ml-1.5" />
        <Separator
          orientation="vertical"
          className="data-vertical:h-5 data-vertical:self-center"
        />
        <p className="flex min-w-0 items-center gap-2 truncate text-sm">
          <span className="text-muted-foreground">{r.group}</span>
          <span className="text-muted-foreground/50" aria-hidden>
            /
          </span>
          <span className="truncate font-mono text-[13px]">{r.label}</span>
        </p>
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="text-muted-foreground"
            onClick={onOpenCommand}
          >
            <SearchIcon aria-hidden /> Go to…
            <kbd className="ml-2 hidden rounded border bg-muted px-1.5 font-mono text-[10px] md:inline">
              ⌘K
            </kbd>
          </Button>
          {route !== "detective" && (
            <Button size="sm" onClick={onAnalyse} aria-label="Analyse an item">
              <UploadIcon aria-hidden />
              <span className="hidden sm:inline">Analyse an item</span>
            </Button>
          )}
        </div>
      </div>
    </header>
  )
}
