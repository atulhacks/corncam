import * as React from "react"
import { FileTextIcon } from "lucide-react"

import type { MediaKind, Signal } from "@/lib/api"
import { cn } from "@/lib/utils"
import { TONE_VAR } from "@/lib/verdict-style"

// Same thresholds as the backend's rank_for (signals/image.py): > 0.5 suspicious, > 0.33 unsure.
const tone = (p: number) => (p > 0.5 ? "fake" : p > 0.33 ? "unsure" : "real")
const pct = (p: number) => `${Math.round(p * 100)}%`

type FaceBox = {
  box: [number, number, number, number]
  scores: { name: string; p: number; votes: boolean }[]
}
type Track = { name: string; points: { t: number; p: number }[] }

/** Face boxes from any detector that reports them; detectors reporting bare per-face scores join by index. */
function faceBoxes(signals: Signal[]): FaceBox[] {
  const withBoxes = signals.find(
    (s) =>
      Array.isArray(s.details?.faces) &&
      (s.details.faces as unknown[]).some(
        (f) => typeof f === "object" && f !== null && "box" in f
      )
  )
  if (!withBoxes) return []
  const base = withBoxes.details.faces as {
    box: [number, number, number, number]
    p_fake: number
  }[]
  return base.map((f, i) => ({
    box: f.box,
    scores: signals.flatMap((s) => {
      const faces = s.details?.faces as unknown[] | undefined
      if (!Array.isArray(faces) || faces.length !== base.length) return []
      const v = faces[i]
      const p = typeof v === "number" ? v : (v as { p_fake?: number })?.p_fake
      return typeof p === "number"
        ? [{ name: s.name, p, votes: s.policy !== "ignore" }]
        : []
    }),
  }))
}

function tracks(signals: Signal[], key: "frames" | "windows"): Track[] {
  return signals.flatMap((s) => {
    const raw = s.details?.[key]
    if (!Array.isArray(raw) || raw.length === 0) return []
    const points = (
      raw as { t?: number; start_s?: number; p_fake: number }[]
    ).map((r) => ({
      t: r.t ?? r.start_s ?? 0,
      p: r.p_fake,
    }))
    return [{ name: s.name, points }]
  })
}

function Legend({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-4 pt-3 text-xs text-pretty text-muted-foreground">
      {children}
    </p>
  )
}

/** Clickable markers along a media timeline: one row per detector, colour = how suspicious that moment is. */
function Timeline({
  rows,
  duration,
  span,
  onSeek,
}: {
  rows: Track[]
  duration: number
  /** seconds each point covers (audio windows); 0 draws a marker (video frames) */
  span: number
  onSeek: (t: number) => void
}) {
  if (!duration) return null
  return (
    <div className="grid gap-2 px-4 pt-2 pb-4">
      {rows.map((r) => (
        <div key={r.name} className="grid gap-1">
          <span className="text-xs text-muted-foreground">{r.name}</span>
          <div className="relative h-6 rounded-md bg-foreground/10">
            {r.points.map((pt) => (
              <button
                key={pt.t}
                type="button"
                onClick={() => onSeek(pt.t)}
                className={cn(
                  "absolute top-1 bottom-1 rounded-sm transition-transform hover:scale-y-125 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                  span === 0 && "w-2 -translate-x-1/2"
                )}
                style={{
                  left: `${(pt.t / duration) * 100}%`,
                  width: span
                    ? `${Math.min(span / duration, 1) * 100}%`
                    : undefined,
                  background: TONE_VAR[tone(pt.p)],
                }}
                aria-label={`${r.name} at ${pt.t.toFixed(1)}s: ${pct(pt.p)} likely fake. Jump there.`}
                title={`${pt.t.toFixed(1)}s · ${pct(pt.p)} likely fake`}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * The evidence item itself, with what triggered suspicion drawn on it (brief: "Explanation view: highlight what
 * triggered suspicion so a non-expert can understand"). Content layer: always solid, never glass.
 */
export function MediaPreview({
  url,
  kind,
  name,
  signals = [],
}: {
  url: string
  kind: MediaKind
  name: string
  signals?: Signal[]
}) {
  const [natural, setNatural] = React.useState<{ w: number; h: number } | null>(
    null
  )
  const [duration, setDuration] = React.useState(0)
  const mediaRef = React.useRef<HTMLMediaElement | null>(null)
  const seek = (t: number) => {
    const m = mediaRef.current
    if (!m) return
    m.currentTime = t
    void m.play().catch(() => undefined)
  }

  const boxes = kind === "image" ? faceBoxes(signals) : []
  const frames = kind === "video" ? tracks(signals, "frames") : []
  const windows =
    kind === "audio" || kind === "video" ? tracks(signals, "windows") : []
  const audioDuration =
    (signals.find((s) => typeof s.details?.duration_s === "number")?.details
      .duration_s as number | undefined) ?? 0

  return (
    <div className="overflow-hidden rounded-2xl border bg-black/40">
      {kind === "image" && (
        <div className="relative mx-auto w-fit">
          <img
            src={url}
            alt={`Evidence item ${name}`}
            className="block max-h-[460px] w-auto max-w-full"
            onLoad={(e) =>
              setNatural({
                w: e.currentTarget.naturalWidth,
                h: e.currentTarget.naturalHeight,
              })
            }
          />
          {natural &&
            boxes.map((f, i) => {
              const voting = f.scores.filter((s) => s.votes)
              const worst = Math.max(
                ...(voting.length ? voting : f.scores).map((s) => s.p),
                0
              )
              const [x, y, w, h] = f.box
              return (
                <div
                  key={i}
                  className="pointer-events-none absolute rounded-md border-2"
                  style={{
                    left: `${(x / natural.w) * 100}%`,
                    top: `${(y / natural.h) * 100}%`,
                    width: `${(w / natural.w) * 100}%`,
                    height: `${(h / natural.h) * 100}%`,
                    borderColor: TONE_VAR[tone(worst)],
                  }}
                >
                  <span
                    className="absolute -top-6 left-0 rounded-md px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap text-background"
                    style={{ background: TONE_VAR[tone(worst)] }}
                  >
                    Face {i + 1} · {pct(worst)}
                  </span>
                </div>
              )
            })}
        </div>
      )}
      {kind === "image" && boxes.length > 0 && (
        <Legend>
          Boxes mark every face the face-forgery models checked. Colour shows
          how suspicious each face looks:{" "}
          {boxes
            .map(
              (f, i) =>
                `face ${i + 1}: ${f.scores
                  .map(
                    (s) =>
                      `${s.name.replace(" face-forgery detector", "")} ${pct(s.p)}${s.votes ? "" : " (shown only)"}`
                  )
                  .join(", ")}`
            )
            .join("; ")}
          .
        </Legend>
      )}

      {kind === "video" && (
        <>
          <video
            ref={(el) => {
              mediaRef.current = el
            }}
            src={url}
            controls
            className="mx-auto max-h-[460px] w-full"
            aria-label={`Evidence video ${name}`}
            onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
          />
          {frames.length + windows.length > 0 && (
            <>
              <Legend>
                Each mark is a moment the detectors checked. Select one to jump
                there; red is the most suspicious.
              </Legend>
              <Timeline
                rows={frames}
                duration={duration}
                span={0}
                onSeek={seek}
              />
              <Timeline
                rows={windows}
                duration={duration}
                span={4}
                onSeek={seek}
              />
            </>
          )}
        </>
      )}

      {kind === "audio" && (
        <>
          <div className="p-8 pb-4">
            <audio
              ref={(el) => {
                mediaRef.current = el
              }}
              src={url}
              controls
              className="w-full"
              aria-label={`Evidence audio ${name}`}
              onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
            />
          </div>
          {windows.length > 0 && (
            <>
              <Legend>
                The voice was checked in 4-second stretches. Select one to hear
                it; red stretches sound the most synthetic.
              </Legend>
              <Timeline
                rows={windows}
                duration={duration || audioDuration}
                span={4}
                onSeek={seek}
              />
            </>
          )}
        </>
      )}

      {(kind === "text" || kind === "unknown") && (
        <div className="flex items-center gap-3 p-8 text-sm text-muted-foreground">
          <FileTextIcon className="size-5" aria-hidden /> {name}
        </div>
      )}
    </div>
  )
}
