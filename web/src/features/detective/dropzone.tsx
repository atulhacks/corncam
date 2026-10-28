import * as React from "react"
import { UploadCloudIcon } from "lucide-react"

import { cn } from "@/lib/utils"

const ACCEPT = "image/*,video/*,audio/*,.txt,.md"

export function Dropzone({
  onFile,
  disabled,
}: {
  onFile: (f: File) => void
  disabled?: boolean
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
        "flex min-h-[340px] cursor-pointer flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed p-8 text-center transition-colors",
        "focus-within:outline-2 focus-within:outline-offset-4 focus-within:outline-ring",
        over
          ? "border-brand bg-brand/10"
          : "border-border hover:border-brand/60 hover:bg-foreground/[0.03]",
        disabled && "pointer-events-none opacity-60"
      )}
    >
      <span className="grid size-14 place-items-center rounded-2xl bg-brand/15 text-brand">
        <UploadCloudIcon className="size-7" aria-hidden />
      </span>
      <span className="space-y-1">
        <span className="block text-base font-medium">
          Drop an evidence item, or click to choose
        </span>
        <span className="block text-sm text-muted-foreground">
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
