import * as React from "react"

import { AppSidebar } from "@/components/app-sidebar"
import { CommandMenu } from "@/components/command-menu"
import { TopBar } from "@/components/top-bar"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { useRoute } from "@/hooks/use-route"
import { Skeleton } from "@/components/ui/skeleton"

// One chunk per page: the node graph (React Flow) and charts load only on the pages that use them.
const BenchmarkPage = React.lazy(() =>
  import("@/features/benchmark/benchmark-page").then((m) => ({
    default: m.BenchmarkPage,
  }))
)
const DetectivePage = React.lazy(() =>
  import("@/features/detective/detective-page").then((m) => ({
    default: m.DetectivePage,
  }))
)
const ForgerPage = React.lazy(() =>
  import("@/features/forger/forger-page").then((m) => ({
    default: m.ForgerPage,
  }))
)
const RevealPage = React.lazy(() =>
  import("@/features/scoreboard/reveal-page").then((m) => ({
    default: m.RevealPage,
  }))
)
const PipelinePage = React.lazy(() =>
  import("@/features/pipeline/pipeline-page").then((m) => ({
    default: m.PipelinePage,
  }))
)
const ReportPage = React.lazy(() =>
  import("@/features/report/report-page").then((m) => ({
    default: m.ReportPage,
  }))
)
const OverviewPage = React.lazy(() =>
  import("@/features/overview/overview-page").then((m) => ({
    default: m.OverviewPage,
  }))
)
const PoolPage = React.lazy(() =>
  import("@/features/pool/pool-page").then((m) => ({ default: m.PoolPage }))
)
const StudioPage = React.lazy(() =>
  import("@/features/studio/studio-page").then((m) => ({
    default: m.StudioPage,
  }))
)

export function App() {
  const [route, navigate] = useRoute()
  const [commandOpen, setCommandOpen] = React.useState(false)

  return (
    <SidebarProvider>
      <AppSidebar route={route} onNavigate={navigate} />
      {/* min-w-0: a flex child defaults to min-width:auto, so the top bar's nowrap breadcrumb (or any wide page
          content) would push the page past the viewport instead of truncating/scrolling inside it. */}
      <SidebarInset className="min-w-0">
        <TopBar
          route={route}
          onOpenCommand={() => setCommandOpen(true)}
          onAnalyse={() => navigate("detective")}
        />
        <main>
          <React.Suspense
            fallback={
              <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 pt-10">
                <Skeleton className="h-24" />
                <Skeleton className="h-64" />
              </div>
            }
          >
            {route === "overview" && <OverviewPage onNavigate={navigate} />}
            {route === "detective" && <DetectivePage />}
            {route === "pool" && <PoolPage />}
            {route === "benchmark" && <BenchmarkPage />}
            {route === "report" && <ReportPage />}
            {route === "pipeline" && <PipelinePage />}
            {route === "studio" && <StudioPage />}
            {route === "forger" && <ForgerPage />}
            {route === "scoreboard" && <RevealPage onNavigate={navigate} />}
          </React.Suspense>
        </main>
      </SidebarInset>
      <CommandMenu
        open={commandOpen}
        onOpenChange={setCommandOpen}
        onNavigate={navigate}
      />
    </SidebarProvider>
  )
}

export default App
