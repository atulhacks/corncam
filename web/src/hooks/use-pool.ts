import * as React from "react"

import { api, type PoolState } from "@/lib/api"

type State = {
  status: "loading" | "ok" | "error"
  data?: PoolState
  error?: string
}

/** Pool state; polls faster while the background worker is busy. */
export function usePool() {
  const [state, setState] = React.useState<State>({ status: "loading" })
  const refresh = React.useCallback(
    () =>
      api
        .pool()
        .then((data) => setState({ status: "ok", data }))
        .catch((e: Error) =>
          setState((s) => ({ ...s, status: "error", error: e.message }))
        ),
    []
  )
  const busy =
    (state.data?.summary.queued ?? 0) + (state.data?.summary.analysing ?? 0) > 0

  React.useEffect(() => {
    void refresh()
    const id = window.setInterval(refresh, busy ? 1500 : 8000)
    return () => window.clearInterval(id)
  }, [refresh, busy])

  return { ...state, busy, refresh }
}
