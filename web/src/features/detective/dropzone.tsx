import * as React from "react"
import { UploadCloudIcon } from "lucide-react"

import { cn } from "@/lib/utils"

const ACCEPT = "image/*,video/*,audio/*,.txt,.md"

export function Dropzone({
  onFile,
  disabled,
  compact,
}: {
  onFile: (f: File) => void
  disabled?: boolean
  /** a short row-style target for side panels (Studio) instead of the full-height page target */
  compact?: boolean
}) {
  const [over, setOver] = React.useState(false)
  const inputId = React.useId()

  const pick = (files: FileList | null) => {
    const f = files?.[0]
    if (f) onFile(f)
  }

  return (
    <label
      htmlFor={inputId}
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        if (!disabled) pick(e.dataTransfer.files)
      }}
      className={cn(
        "flex cursor-pointer rounded-2xl border-2 border-dashed transition-colors",
        compact
          ? "items-center gap-3 rounded-xl p-3 text-left"
          : "min-h-[340px] flex-col items-center justify-center gap-4 p-8 text-center",
        "focus-within:outline-2 focus-within:outline-offset-4 focus-within:outline-ring",
        over
          ? "border-brand bg-brand/10"
          : "border-border hover:border-brand/60 hover:bg-foreground/[0.03]",
        disabled && "pointer-events-none opacity-60"
      )}
    >
      <span
        className={cn(
          "grid shrink-0 place-items-center bg-brand/15 text-brand",
          compact ? "size-10 rounded-lg" : "size-14 rounded-2xl"
        )}
      >
        <UploadCloudIcon
          className={compact ? "size-5" : "size-7"}
          aria-hidden
        />
      </span>
      <span className={compact ? "grid gap-0.5" : "space-y-1"}>
        <span
          className={cn("block font-medium", compact ? "text-sm" : "text-base")}
        >
          {compact
            ? "Drop a file or click"
            : "Drop an evidence item, or click to choose"}
        </span>
        <span
          className={cn(
            "block text-muted-foreground",
            compact ? "text-xs" : "text-sm"
          )}
        >
          Image · video · audio · text — analysed on this machine, never
          uploaded
        </span>
      </span>
      <input
        id={inputId}
        type="file"
        accept={ACCEPT}
        className="sr-only"
        disabled={disabled}
        onChange={(e) => {
          pick(e.target.files)
          e.target.value = ""
        }}
      />
    </label>
  )
}
