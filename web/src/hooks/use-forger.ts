import * as React from "react"

import { api, type Candidate, type ForgerStatus, type Persona } from "@/lib/api"

type State = {
  status: "loading" | "ok" | "error"
  personas: Persona[]
  candidates: Candidate[]
  tools?: ForgerStatus
  error?: string
}

/** Forger state; polls faster while candidates are being generated or scored (same pattern as usePool). */
export function useForger() {
  const [state, setState] = React.useState<State>({
    status: "loading",
    personas: [],
    candidates: [],
  })
  const refresh = React.useCallback(
    () =>
      Promise.all([api.personas(), api.candidates(), api.forgerStatus()])
        .then(([personas, candidates, tools]) =>
          setState({ status: "ok", personas, candidates, tools })
        )
        .catch((e: Error) =>
          setState((s) => ({ ...s, status: "error", error: e.message }))
        ),
    []
  )
  const busy = state.candidates.some((c) =>
    ["queued", "generating", "scoring"].includes(c.status)
  )

  React.useEffect(() => {
    void refresh()
    const id = window.setInterval(refresh, busy ? 1500 : 8000)
    return () => window.clearInterval(id)
  }, [refresh, busy])

  return { ...state, busy, refresh }
}
