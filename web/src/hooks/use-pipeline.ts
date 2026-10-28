import * as React from "react"

import { api, type Pipeline } from "@/lib/api"

// The pipeline map only changes when the API restarts, so one fetch is shared by every view.
let cached: Promise<Pipeline> | null = null

/** The Detective's pipeline map; `pipeline` is null while loading or after an error. */
export function usePipeline(): {
  pipeline: Pipeline | null
  error: string | null
} {
  const [state, setState] = React.useState<{
    pipeline: Pipeline | null
    error: string | null
  }>({
    pipeline: null,
    error: null,
  })
  React.useEffect(() => {
    let alive = true
    cached ??= api.pipeline().catch((e: Error) => {
      cached = null // retry on the next mount
      throw e
    })
    cached
      .then((p) => alive && setState({ pipeline: p, error: null }))
      .catch(
        (e: Error) => alive && setState({ pipeline: null, error: e.message })
      )
    return () => {
      alive = false
    }
  }, [])
  return state
}
