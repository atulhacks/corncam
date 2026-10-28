import * as React from "react"

import { api, type AIStatus } from "@/lib/api"

let cached: Promise<AIStatus> | null = null

/** Whether the AI layer is configured (shared, fetched once per page load). */
export function useAIStatus(): AIStatus | null {
  const [status, setStatus] = React.useState<AIStatus | null>(null)
  React.useEffect(() => {
    let alive = true
    cached ??= api.aiStatus().catch((e: Error) => {
      cached = null
      throw e
    })
    cached
      .then((s) => alive && setStatus(s))
      .catch(
        () =>
          alive &&
          setStatus({ configured: false, model: "", provider: "DeepSeek" })
      )
    return () => {
      alive = false
    }
  }, [])
  return status
}
