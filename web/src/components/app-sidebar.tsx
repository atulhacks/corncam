import { MoonIcon, ScanEyeIcon, SunIcon } from "lucide-react"

import { useTheme } from "@/components/theme-provider"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar"
import { useQueryHealth } from "@/hooks/use-health"
import { GROUPS, ROUTES, type RouteId } from "@/lib/routes"
import { cn } from "@/lib/utils"

/** Full-height pane with a hairline edge ("proof desk" shell); collapses to icons. */
export function AppSidebar({
  route,
  onNavigate,
}: {
  route: RouteId
  onNavigate: (r: RouteId) => void
}) {
  const { theme, setTheme } = useTheme()
  const health = useQueryHealth()
  const dark =
    theme === "dark" ||
    (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches)

  return (
    <Sidebar variant="sidebar" collapsible="icon">
      {/* Collapsed: 16px + 32px logo + 16px = the expanded 64px row, so the centre line (41) and the nav below never move */}
      <SidebarHeader className="h-16 justify-center border-b group-data-[collapsible=icon]:px-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              onClick={() => onNavigate("overview")}
              tooltip="Corncam"
            >
              <span className="grid size-8 shrink-0 place-items-center rounded-md border text-brand">
                <ScanEyeIcon className="size-4" aria-hidden />
              </span>
              <span className="grid gap-0.5 leading-tight group-data-[collapsible=icon]:hidden">
                <span className="font-heading text-lg font-medium tracking-tight">
                  Corncam
                </span>
                <span className="eyebrow text-[10px]">Proof desk</span>
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {GROUPS.map((group) => (
          <SidebarGroup key={group}>
            {group !== "Home" && (
              <SidebarGroupLabel className="eyebrow">{group}</SidebarGroupLabel>
            )}
            <SidebarGroupContent>
              <SidebarMenu>
                {ROUTES.filter((r) => r.group === group).map((r) => (
                  <SidebarMenuItem key={r.id}>
                    <SidebarMenuButton
                      className="data-[active=true]:shadow-[inset_2px_0_0_var(--brand)]"
                      isActive={route === r.id}
                      tooltip={r.label}
                      onClick={() => onNavigate(r.id)}
                      aria-current={route === r.id ? "page" : undefined}
                    >
                      <r.icon aria-hidden />
                      <span>{r.label}</span>
                    </SidebarMenuButton>
                    {!r.ready && (
                      <SidebarMenuBadge className="text-[10px] tracking-wider uppercase">
                        next
                      </SidebarMenuBadge>
                    )}
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip={
                health.data
                  ? `Covers ${health.data.covered_media.join(", ")} · calibrated ${health.data.calibrated ? "yes" : "no"}`
                  : "Start the API: make api"
              }
            >
              <span
                className="grid size-4 shrink-0 place-items-center"
                aria-hidden
              >
                <span
                  className={cn(
                    "size-2 shrink-0 rounded-full",
                    health.status === "ok"
                      ? "bg-real"
                      : health.status === "loading"
                        ? "bg-unsure"
                        : "bg-fake"
                  )}
                  aria-hidden
                />
              </span>
              <span className="text-xs">
                {health.status === "ok"
                  ? "Online · offline-only"
                  : health.status === "loading"
                    ? "Connecting…"
                    : "API offline"}
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip={dark ? "Light theme" : "Dark theme"}
              onClick={() => setTheme(dark ? "light" : "dark")}
            >
              {dark ? <SunIcon aria-hidden /> : <MoonIcon aria-hidden />}
              <span>{dark ? "Light theme" : "Dark theme"}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
