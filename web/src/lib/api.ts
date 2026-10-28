// Typed client for the Corncam FastAPI backend (proxied at /api by Vite).

export type Rank = "low" | "uncertain" | "high" | "n/a"
export type Category =
  | "provenance"
  | "generative_ai"
  | "faces"
  | "visual_noise"
  | "voice"
  | "semantic"
export type MediaKind = "image" | "video" | "audio" | "text" | "unknown"

export interface Signal {
  name: string
  category: Category
  score: number | null
  rank: Rank
  reason_code: string
  evidence: string
  policy: "include" | "trust" | "ignore"
  decisive: boolean
  details: Record<string, unknown>
  seconds: number | null
}

export interface Verdict {
  item_id: string
  filename: string
  media_type: MediaKind
  media_kind: MediaKind
  media_url: string
  label: "fake" | "real"
  tier: Exclude<Rank, "n/a">
  p_fake: number
  p_raw: number
  confidence: number
  reason_code: string
  reason_text: string
  votes: number
  experimental: boolean
  signals: Signal[]
}

export interface Health {
  status: string
  covered_media: string[]
  calibrated: boolean
  fake_prior: number | null
  aicheck: boolean
}

export interface BenchmarkReport {
  name: string
  role: "held-out" | "tuning" | "smoke" | "stress"
  media: MediaKind
  created: number
  dataset: string
  n: number
  n_real: number
  n_fake: number
  auc: number | null
  accuracy: number
  false_alarm_rate: number | null
  miss_rate: number | null
  brier: number
  game_points: number
  seconds_median: number
}

export interface PoolSummary {
  total: number
  new: number
  queued: number
  analysing: number
  done: number
  failed: number
  fake: number
  real: number
  uncertain: number
}

export interface PoolItem {
  sha: string
  filename: string
  media_kind: MediaKind
  status: "new" | "queued" | "analysing" | "done" | "failed"
  error: string | null
  added: number
  media_url: string
  label: Verdict["label"] | null
  tier: Verdict["tier"] | null
  p_fake: number | null
  confidence: number | null
  reason_code: string | null
  verdict?: Verdict
}

export interface PoolState {
  summary: PoolSummary
  items: PoolItem[]
}

export interface PipelineDetector {
  name: string
  model: string
  policy: Signal["policy"]
  looks_for: string
  measured?: string
}

export interface PipelineLane {
  category: Category
  title: string
  question: string
  detectors: PipelineDetector[]
}

export interface PipelineMedia {
  summary: string
  lanes: PipelineLane[]
  covered: boolean
  calibrated: boolean
  planned?: boolean
}

export interface Pipeline {
  steps: Record<"ingest" | "fusion" | "calibration" | "verdict", string>
  media: Record<"image" | "video" | "audio" | "text", PipelineMedia>
  available: { aicheck: boolean; df40: boolean }
}

export interface Persona {
  id: string
  name: string
  bio: string
  synthetic: boolean
  appearance: string
  voice: string
  source: string
  has_reference: boolean
  has_voice: boolean
  reference_url: string | null
}

export interface Candidate {
  id: string
  persona: string
  kind: "image" | "audio" | "text"
  scene: string
  file: string
  created: number
  status: "queued" | "generating" | "scoring" | "done" | "failed"
  error: string | null
  model: string
  prompt: string
  seed: number
  parent: string | null
  engine: "local" | "gemini"
  launder: string[]
  p_fake: number | null
  label: "fake" | "real" | null
  reason_code: string | null
  selected: boolean
  media_url: string
}

export interface ForgerStatus {
  tools: Record<string, boolean>
  image_model: string
  kinds: string[]
  gemini: boolean
  gemini_image_model: string
  max_submission: number
}

export interface AIStatus {
  configured: boolean
  model: string
  provider: string
  balance?: string
  error?: string
}

export interface AIExplanation {
  headline: string
  explanation: string
  triggers: string[]
  check_yourself: string[]
  caveat: string
  cached: boolean
}

export interface AIReport {
  summary: string
  slipped_through: string[]
  improvements: string[]
  cached: boolean
}

export type ChatTurn = { role: "user" | "assistant"; content: string }

export type InvestigationEvent =
  | { type: "start"; media_type: MediaKind; facts: Record<string, unknown> }
  | { type: "thought"; text: string }
  | {
      type: "tool"
      tool: string
      args: Record<string, unknown>
      lanes: string[]
      why: string
    }
  | { type: "tool_result"; tool: string; signals: Signal[]; seconds: number }
  | { type: "verdict"; verdict: Verdict }
  | ({ type: "explanation" } & Partial<AIExplanation>)
  | { type: "error"; text: string }
  | { type: "done" }

/** A node the Studio canvas (or the AI) can add. Advisory nodes are shown as evidence and never vote. */
export interface StudioTool {
  name: string
  description: string
  media: MediaKind[]
  advisory: boolean
  /** media types for which this check always runs, whatever the AI or the person chooses */
  core: MediaKind[]
}

/** POST a form and read the newline-delimited JSON event stream (investigator and Studio). */
async function streamEvents(
  url: string,
  body: FormData,
  onEvent: (e: InvestigationEvent) => void,
  signal?: AbortSignal
) {
  const res = await fetch(url, { method: "POST", body, signal })
  if (!res.ok || !res.body) {
    throw new Error(
      `${res.status} ${res.statusText}: ${(await res.text()).slice(0, 200)}`
    )
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ""
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let nl: number
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (line) onEvent(JSON.parse(line) as InvestigationEvent)
    }
  }
}

export type Outcome = "caught" | "cleared" | "false_alarm" | "missed"

export interface ReportRow {
  sha: string
  filename: string
  media_type: MediaKind
  truth: "fake" | "real"
  call: "fake" | "real"
  p_fake: number
  confidence: number
  tier: Verdict["tier"]
  reason_code: string
  reason_text: string
  outcome: Outcome
  points: number
  why: string
  improve: string
  source: string
  top_signals: { name: string; score: number; rank: Rank }[]
}

export interface Report {
  n: number
  n_fake: number
  n_real: number
  counts: Record<Outcome, number>
  points: number
  reason_points: string
  accuracy: number | null
  brier: number | null
  fake_share: number | null
  best_threshold: number
  best_threshold_points: number
  by_media: Record<string, { n: number; correct: number; points: number }>
  lessons: string[]
  slipped: ReportRow[]
  false_alarms: ReportRow[]
  rows: ReportRow[]
  unmatched_key: string[]
  unjudged: string[]
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`${res.status} ${res.statusText}: ${body.slice(0, 200)}`)
  }
  return res.json() as Promise<T>
}

export const api = {
  health: () => fetch("/api/health").then((r) => json<Health>(r)),
  pipeline: () => fetch("/api/pipeline").then((r) => json<Pipeline>(r)),
  benchmark: () =>
    fetch("/api/benchmark").then((r) => json<BenchmarkReport[]>(r)),
  detect: (file: File, signal?: AbortSignal) => {
    const body = new FormData()
    body.append("file", file)
    return fetch("/api/detect", { method: "POST", body, signal }).then((r) =>
      json<Verdict>(r)
    )
  },
  pool: () => fetch("/api/pool").then((r) => json<PoolState>(r)),
  poolItem: (sha: string) =>
    fetch(`/api/pool/${sha}`).then((r) => json<PoolItem>(r)),
  poolUpload: (files: File[]) => {
    const body = new FormData()
    files.forEach((f) => body.append("files", f, f.name))
    return fetch("/api/pool/upload", { method: "POST", body }).then((r) =>
      json<{ added: number; summary: PoolSummary }>(r)
    )
  },
  poolAnalyse: (force = false) =>
    fetch(`/api/pool/analyse${force ? "?force=true" : ""}`, {
      method: "POST",
    }).then((r) => json<{ queued: number; summary: PoolSummary }>(r)),
  poolClear: () =>
    fetch("/api/pool", { method: "DELETE" }).then((r) =>
      json<{ summary: PoolSummary }>(r)
    ),
  poolExportUrl: (fmt: "json" | "csv") => `/api/pool-export.${fmt}`,
  // null until an answer key has been imported
  report: () => fetch("/api/report").then((r) => json<Report | null>(r)),
  reportKey: (file: File) => {
    const body = new FormData()
    body.append("file", file, file.name)
    return fetch("/api/report/key", { method: "POST", body }).then((r) =>
      json<Report>(r)
    )
  },
  reportClear: () =>
    fetch("/api/report/key", { method: "DELETE" }).then((r) =>
      json<{ cleared: boolean }>(r)
    ),
  reportMarkdownUrl: "/api/report.md",
  /** Streams the AI investigation (newline-delimited JSON), calling onEvent for each event. */
  investigate: async (
    file: File,
    onEvent: (e: InvestigationEvent) => void,
    signal?: AbortSignal
  ) => {
    const body = new FormData()
    body.append("file", file)
    await streamEvents("/api/investigate", body, onEvent, signal)
  },
  studioTools: () =>
    fetch("/api/studio/tools").then((r) => json<StudioTool[]>(r)),
  /** Studio run: the AI plans around `goal`; `requested` nodes always run. */
  studioInvestigate: async (
    file: File,
    goal: string,
    requested: string[],
    onEvent: (e: InvestigationEvent) => void,
    signal?: AbortSignal
  ) => {
    const body = new FormData()
    body.append("file", file)
    body.append("goal", goal)
    body.append("requested", requested.join(","))
    await streamEvents("/api/studio/investigate", body, onEvent, signal)
  },
  aiStatus: () => fetch("/api/ai/status").then((r) => json<AIStatus>(r)),
  aiExplain: (verdict: Verdict) =>
    fetch("/api/ai/explain", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ verdict }),
    }).then((r) => json<AIExplanation>(r)),
  aiAsk: (verdict: Verdict, question: string, history: ChatTurn[]) =>
    fetch("/api/ai/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ verdict, question, history }),
    }).then((r) => json<{ answer: string }>(r)),
  aiReport: () =>
    fetch("/api/ai/report", { method: "POST" }).then((r) => json<AIReport>(r)),
  aiScenes: (persona: string, theme: string, n = 4) =>
    fetch("/api/ai/scenes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ persona, theme, n }),
    }).then((r) => json<{ scenes: string[] }>(r)),
  forgerStatus: () =>
    fetch("/api/forger/status").then((r) => json<ForgerStatus>(r)),
  personas: () => fetch("/api/forger/personas").then((r) => json<Persona[]>(r)),
  createPersona: (form: FormData) =>
    fetch("/api/forger/personas", { method: "POST", body: form }).then((r) =>
      json<Persona>(r)
    ),
  candidates: () =>
    fetch("/api/forger/candidates").then((r) => json<Candidate[]>(r)),
  generate: (body: {
    persona: string
    kind: string
    scene: string
    n: number
    engine?: "local" | "gemini"
  }) =>
    fetch("/api/forger/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => json<Candidate[]>(r)),
  launder: (id: string, preset: "phone" | "whatsapp" = "phone") =>
    fetch(`/api/forger/candidates/${id}/launder?preset=${preset}`, {
      method: "POST",
    }).then((r) => json<Candidate>(r)),
  selectCandidate: (id: string, selected: boolean) =>
    fetch(`/api/forger/candidates/${id}/select`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ selected }),
    }).then((r) => json<Candidate>(r)),
  exportSubmission: () =>
    fetch("/api/forger/export", { method: "POST" }).then((r) =>
      json<{ count: number; folder: string }>(r)
    ),
}
