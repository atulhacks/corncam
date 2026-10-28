import * as React from "react"
import { CheckIcon, DownloadIcon, SparklesIcon, WandIcon } from "lucide-react"
import { toast } from "sonner"

import { VerdictPill } from "@/components/verdict-pill"
import { PageHeader } from "@/components/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useAIStatus } from "@/hooks/use-ai-status"
import { useForger } from "@/hooks/use-forger"
import { api, type Candidate, type Persona } from "@/lib/api"
import { cn } from "@/lib/utils"

import { PersonaDialog } from "./persona-dialog"

type Show = "all" | "selected"

/** Lower is better for a fake: how strongly our own Detective flags it. */
function evasion(p: number | null) {
  if (p == null) return null
  if (p <= 0.5)
    return { tone: "real" as const, text: "slips past our Detective" }
  if (p < 0.8)
    return { tone: "unsure" as const, text: "our Detective is suspicious" }
  return { tone: "fake" as const, text: "our Detective catches it" }
}

function PersonaButton({
  p,
  active,
  onSelect,
}: {
  p: Persona
  active: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={cn(
        "flex items-center gap-3 rounded-lg border p-2.5 text-left transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        active && "border-brand bg-brand/10"
      )}
    >
      {p.reference_url ? (
        <img
          src={p.reference_url}
          alt=""
          className="size-10 rounded-md object-cover"
        />
      ) : (
        <span className="grid size-10 place-items-center rounded-md bg-brand/15 text-sm font-semibold text-brand">
          {p.name.slice(0, 1)}
        </span>
      )}
      <span className="grid min-w-0 gap-0.5">
        <span className="truncate text-sm font-medium">{p.name}</span>
        <span className="truncate text-xs text-muted-foreground">
          {p.source || "synthetic persona"}
        </span>
      </span>
    </button>
  )
}

/** A text candidate's post, fetched from its local file. */
function TextPreview({ url }: { url: string }) {
  const [text, setText] = React.useState<string | null>(null)
  React.useEffect(() => {
    let alive = true
    fetch(url)
      .then((r) => r.text())
      .then((t) => alive && setText(t))
      .catch(() => alive && setText(""))
    return () => {
      alive = false
    }
  }, [url])
  return (
    <p className="size-full overflow-y-auto p-4 pt-10 text-sm leading-relaxed text-pretty whitespace-pre-wrap">
      {text ?? "…"}
    </p>
  )
}

function CandidateCard({
  c,
  personaName,
  onChanged,
}: {
  c: Candidate
  personaName: string
  onChanged: () => void
}) {
  const ev = evasion(c.p_fake)
  const working = ["queued", "generating", "scoring"].includes(c.status)
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn()
      toast.success(ok)
      onChanged()
    } catch (e) {
      toast.error("Could not do that", { description: (e as Error).message })
    }
  }
  return (
    <Card
      className={cn(
        "gap-3 overflow-hidden bg-card/80 p-0",
        c.selected && "ring-2 ring-brand"
      )}
    >
      <div className="relative aspect-[4/5] bg-muted">
        {(c.status === "done" || c.status === "scoring") &&
        c.kind === "text" ? (
          <TextPreview url={c.media_url} />
        ) : c.status === "done" || c.status === "scoring" ? (
          <img
            src={c.media_url}
            alt={`Candidate: ${c.scene}`}
            className="size-full object-cover"
            loading="lazy"
          />
        ) : working ? (
          <Skeleton className="size-full rounded-none" />
        ) : (
          <p className="p-4 text-sm text-fake">{c.error ?? "Failed"}</p>
        )}
        <Badge
          variant="secondary"
          className="absolute top-2 left-2 rounded-full capitalize"
        >
          {c.parent ? "laundered" : c.status === "done" ? c.kind : c.status}
        </Badge>
      </div>
      <div className="grid gap-2 px-4 pb-4">
        <p className="line-clamp-2 text-sm text-pretty">
          <span className="font-medium">{personaName}</span> · {c.scene}
        </p>
        {ev && (
          <p className="flex items-center gap-2 text-xs">
            <VerdictPill tone={ev.tone}>
              {Math.round(c.p_fake! * 100)}% fake
            </VerdictPill>
            <span className="text-muted-foreground">{ev.text}</span>
          </p>
        )}
        {c.launder.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {c.launder.join(" · ")}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={c.status !== "done" || c.kind !== "image"}
            onClick={() =>
              void act(
                () =>
                  Promise.all([
                    api.launder(c.id, "phone"),
                    api.launder(c.id, "whatsapp"),
                  ]),
                "Laundering two copies: phone re-save and WhatsApp forward"
              )
            }
          >
            <WandIcon aria-hidden /> Launder
          </Button>
          <Button
            variant={c.selected ? "default" : "outline"}
            size="sm"
            disabled={c.status !== "done"}
            aria-pressed={c.selected}
            onClick={() =>
              void act(
                () => api.selectCandidate(c.id, !c.selected),
                c.selected ? "Removed from submission" : "Added to submission"
              )
            }
          >
            <CheckIcon aria-hidden /> {c.selected ? "Selected" : "Select"}
          </Button>
        </div>
      </div>
    </Card>
  )
}

export function ForgerPage() {
  const forge = useForger()
  const [persona, setPersona] = React.useState<string | null>(null)
  const [scene, setScene] = React.useState("")
  const [kind, setKind] = React.useState<"image" | "text">("image")
  const [engine, setEngine] = React.useState<"local" | "gemini">("local")
  const [ideas, setIdeas] = React.useState<string[]>([])
  const [suggesting, setSuggesting] = React.useState(false)
  const ai = useAIStatus()
  const [count, setCount] = React.useState("2")
  const [show, setShow] = React.useState<Show>("all")
  const [busy, setBusy] = React.useState(false)

  const active = persona ?? forge.personas[0]?.id ?? null
  const names = Object.fromEntries(forge.personas.map((p) => [p.id, p.name]))
  const imageReady = forge.tools
    ? Object.values(forge.tools.tools).every(Boolean)
    : false
  // Images need the local generator; text posts are written by the AI layer.
  const gemini = Boolean(forge.tools?.gemini)
  const imageEngine = gemini ? engine : "local"
  // Local images need mflux; Nano Banana needs a Gemini key; text posts are written by the AI layer.
  const ready =
    kind === "text"
      ? Boolean(ai?.configured)
      : imageEngine === "gemini"
        ? gemini
        : imageReady
  const selectedCount = forge.candidates.filter((c) => c.selected).length
  const max = forge.tools?.max_submission ?? 5
  // Best fakes first: finished candidates by our Detective's P(fake), lowest first; in-progress ones on top.
  const shown = forge.candidates
    .filter((c) => show === "all" || c.selected)
    .sort((a, b) => {
      const rank = (c: Candidate) =>
        c.status === "done" ? (c.p_fake ?? 1) : -1
      return rank(a) - rank(b)
    })

  const generate = async () => {
    if (!active) return
    setBusy(true)
    try {
      const r = await api.generate({
        persona: active,
        kind,
        scene,
        engine: imageEngine,
        n: Number(count),
      })
      toast.info(
        `Generating ${r.length} candidate${r.length === 1 ? "" : "s"}`,
        {
          description:
            "Each one is scored by our own Detective when it is done.",
        }
      )
      await forge.refresh()
    } catch (e) {
      toast.error("Could not start generation", {
        description: (e as Error).message,
      })
    } finally {
      setBusy(false)
    }
  }

  const suggest = async () => {
    if (!active) return
    setSuggesting(true)
    try {
      setIdeas((await api.aiScenes(active, scene, 4)).scenes)
    } catch (e) {
      toast.error("Could not suggest scenes", {
        description: (e as Error).message,
      })
    } finally {
      setSuggesting(false)
    }
  }

  const exportSubmission = async () => {
    try {
      const r = await api.exportSubmission()
      toast.success(`Exported ${r.count} fake${r.count === 1 ? "" : "s"}`, {
        description: `Saved to ${r.folder} on this machine. Never upload or share them.`,
      })
    } catch (e) {
      toast.error("Export failed", { description: (e as Error).message })
    }
  }

  return (
    <div className="@container/main mx-auto grid w-full max-w-6xl gap-8 px-4 pt-10 pb-16">
      <PageHeader
        eyebrow="Red team"
        title="Forger Studio"
        description={
          <>
            Make fakes from the synthetic personas on this machine, launder them
            the way a phone would, and submit the five our own Detective misses.
            Fakes never leave the hackathon.
          </>
        }
        actions={
          <>
            <Button
              size="sm"
              disabled={selectedCount === 0}
              onClick={() => void exportSubmission()}
            >
              <DownloadIcon aria-hidden /> Export submission ({selectedCount}/
              {max})
            </Button>
          </>
        }
      />

      {forge.status === "error" && (
        <p className="text-sm text-fake">
          Could not load the Forger: {forge.error}
        </p>
      )}
      {forge.tools &&
        !imageReady &&
        kind === "image" &&
        imageEngine === "local" && (
          <Card className="bg-card/80 p-5 text-sm text-muted-foreground">
            The image generator is not installed yet. Run{" "}
            <code className="text-foreground">
              uv tool install mflux==0.24.0
            </code>{" "}
            then reload this page.
          </Card>
        )}

      <div className="grid gap-6 @4xl/main:grid-cols-[20rem_1fr]">
        <Card className="bg-card/80">
          <CardHeader>
            <CardTitle>Personas</CardTitle>
            <CardDescription>Synthetic only.</CardDescription>
            <CardAction>
              <PersonaDialog onCreated={() => void forge.refresh()} />
            </CardAction>
          </CardHeader>
          <CardContent className="grid gap-2">
            {forge.status === "loading" ? (
              <Skeleton className="h-24" />
            ) : forge.personas.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Add the organisers' personas to start forging.
              </p>
            ) : (
              forge.personas.map((p) => (
                <PersonaButton
                  key={p.id}
                  p={p}
                  active={p.id === active}
                  onSelect={() => setPersona(p.id)}
                />
              ))
            )}
          </CardContent>
        </Card>

        <Card className="bg-card/80">
          <CardHeader>
            <CardTitle>Generate</CardTitle>
            <CardDescription>
              {kind === "text"
                ? `A short post in the persona's voice, written by ${ai?.provider ?? "the AI"} (${ai?.model ?? "not configured"}).`
                : imageEngine === "gemini"
                  ? `Nano Banana 2.1 through the Gemini API (${forge.tools?.gemini_image_model}): the generator other teams are most likely to use. Needs a key with billing. Only the prompt and the persona photo are sent.`
                  : active &&
                      forge.personas.find((p) => p.id === active)?.has_reference
                    ? "Edits from the persona's reference photo, so the face stays the same. FLUX.2 Klein 4B, on this Mac."
                    : "Text-to-image from the persona's appearance. FLUX.2 Klein 4B, on this Mac."}
            </CardDescription>
            <CardAction>
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                value={kind}
                onValueChange={(v) => v && setKind(v as "image" | "text")}
                aria-label="What to generate"
              >
                <ToggleGroupItem value="image">Image</ToggleGroupItem>
                <ToggleGroupItem value="text">Text post</ToggleGroupItem>
              </ToggleGroup>
            </CardAction>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-2">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="forge-scene">
                  {kind === "text" ? "Topic" : "Scene"}
                </Label>
                {ai?.configured && kind === "image" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={!active || suggesting}
                    onClick={() => void suggest()}
                  >
                    <SparklesIcon aria-hidden />{" "}
                    {suggesting ? "Thinking…" : "Suggest scenes with AI"}
                  </Button>
                )}
              </div>
              <Textarea
                id="forge-scene"
                rows={3}
                value={scene}
                onChange={(e) => setScene(e.target.value)}
                placeholder={
                  kind === "text"
                    ? "e.g. a rainy commute and missing the bus"
                    : "e.g. taking a selfie at a crowded train station in the evening"
                }
              />
              {ideas.length > 0 && kind === "image" && (
                <div className="flex flex-wrap gap-2">
                  {ideas.map((idea) => (
                    <button
                      key={idea}
                      type="button"
                      onClick={() => setScene(idea)}
                      className="rounded-lg border px-2.5 py-1.5 text-left text-xs text-pretty text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    >
                      {idea}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              {kind === "image" && gemini && (
                <ToggleGroup
                  type="single"
                  variant="outline"
                  size="sm"
                  value={engine}
                  onValueChange={(v) => v && setEngine(v as "local" | "gemini")}
                  aria-label="Image engine"
                >
                  <ToggleGroupItem value="local">On this Mac</ToggleGroupItem>
                  <ToggleGroupItem value="gemini">Nano Banana</ToggleGroupItem>
                </ToggleGroup>
              )}
              <div className="flex items-center gap-3">
                <span className="text-sm text-muted-foreground">
                  Candidates
                </span>
                <ToggleGroup
                  type="single"
                  variant="outline"
                  size="sm"
                  value={count}
                  onValueChange={(v) => v && setCount(v)}
                  aria-label="Number of candidates"
                >
                  {["1", "2", "4"].map((n) => (
                    <ToggleGroupItem key={n} value={n}>
                      {n}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>
              <Button
                disabled={!active || !scene.trim() || !ready || busy}
                onClick={() => void generate()}
              >
                <SparklesIcon aria-hidden /> Generate
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-card/80">
        <CardHeader>
          <CardTitle>Candidates</CardTitle>
          <CardDescription>
            Ranked by our own Detective: the lower its fake score, the better
            the fake. Launder a copy to strip metadata and re-compress it.
          </CardDescription>
          <CardAction>
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={show}
              onValueChange={(v) => v && setShow(v as Show)}
            >
              <ToggleGroupItem value="all">All</ToggleGroupItem>
              <ToggleGroupItem value="selected">
                Selected ({selectedCount})
              </ToggleGroupItem>
            </ToggleGroup>
          </CardAction>
        </CardHeader>
        <CardContent>
          {shown.length === 0 ? (
            <p className="py-6 text-sm text-muted-foreground">
              {show === "selected"
                ? "Nothing selected yet. Pick up to five candidates."
                : "No candidates yet. Choose a persona, describe a scene and generate."}
            </p>
          ) : (
            <div className="grid gap-4 @xl/main:grid-cols-2 @4xl/main:grid-cols-3">
              {shown.map((c) => (
                <CandidateCard
                  key={c.id}
                  c={c}
                  personaName={names[c.persona] ?? c.persona}
                  onChanged={() => void forge.refresh()}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
