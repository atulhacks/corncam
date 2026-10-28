import * as React from "react"

import { api, type Health } from "@/lib/api"

type State = { status: "loading" | "ok" | "error"; data?: Health }

/** Polls /api/health so the header reflects whether the local Detective is running. */
export function useQueryHealth(intervalMs = 10_000): State {
  const [state, setState] = React.useState<State>({ status: "loading" })
  React.useEffect(() => {
    let alive = true
    const tick = () =>
      api
        .health()
        .then((data) => alive && setState({ status: "ok", data }))
        .catch(() => alive && setState({ status: "error" }))
    tick()
    const id = window.setInterval(tick, intervalMs)
    return () => {
      alive = false
      window.clearInterval(id)
    }
  }, [intervalMs])
  return state
}
