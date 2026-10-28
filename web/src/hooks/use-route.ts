import * as React from "react"

import { ROUTES, type RouteId } from "@/lib/routes"

const isRoute = (s: string): s is RouteId => ROUTES.some((r) => r.id === s)

function read(): RouteId {
  const h = window.location.hash.replace(/^#\/?/, "")
  return isRoute(h) ? h : "overview"
}

/** Minimal hash router: deep-linkable pages without a router dependency. */
export function useRoute(): [RouteId, (r: RouteId) => void] {
  const [route, setRoute] = React.useState<RouteId>(read)
  React.useEffect(() => {
    const onHash = () => setRoute(read())
    window.addEventListener("hashchange", onHash)
    return () => window.removeEventListener("hashchange", onHash)
  }, [])
  const navigate = React.useCallback((r: RouteId) => {
    window.location.hash = `/${r}`
  }, [])
  return [route, navigate]
}
