import * as React from "react"
import { UserPlusIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { api } from "@/lib/api"

/** Add a persona from the organisers' pack (or a fictional test persona). Synthetic only, by rule. */
export function PersonaDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = React.useState(false)
  const [synthetic, setSynthetic] = React.useState(false)
  const [saving, setSaving] = React.useState(false)

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    form.set("synthetic", String(synthetic))
    const ref = form.get("reference")
    if (ref instanceof File && ref.size === 0) form.delete("reference")
    setSaving(true)
    try {
      const p = await api.createPersona(form)
      toast.success(`Added ${p.name}`)
      setOpen(false)
      setSynthetic(false)
      onCreated()
    } catch (err) {
      toast.error("Could not add the persona", {
        description: (err as Error).message,
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <UserPlusIcon aria-hidden /> Add persona
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={(e) => void submit(e)} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Add a synthetic persona</DialogTitle>
            <DialogDescription>
              Use the organisers' persona pack. No real people: no politicians,
              celebrities, officials or classmates.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="persona-name">Name</Label>
            <Input id="persona-name" name="name" required maxLength={60} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="persona-bio">Who they are</Label>
            <Textarea
              id="persona-bio"
              name="bio"
              rows={2}
              placeholder="Age, job, city, what they post about"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="persona-look">Appearance</Label>
            <Input
              id="persona-look"
              name="appearance"
              placeholder="Used when there is no reference photo"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="persona-voice">Voice</Label>
            <Input
              id="persona-voice"
              name="voice"
              placeholder="e.g. warm, mid-30s, Indian English"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="persona-ref">Reference photo (optional)</Label>
            <Input
              id="persona-ref"
              name="reference"
              type="file"
              accept="image/*"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="persona-source">Source</Label>
            <Input
              id="persona-source"
              name="source"
              placeholder="Organisers' pack, persona #3"
            />
          </div>
          <div className="flex items-start gap-3">
            <Checkbox
              id="persona-synthetic"
              checked={synthetic}
              onCheckedChange={(v) => setSynthetic(v === true)}
            />
            <Label
              htmlFor="persona-synthetic"
              className="leading-snug font-normal text-pretty"
            >
              This persona is synthetic (from the organisers' pack or
              fictional). It is not a real person.
            </Label>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={!synthetic || saving}>
              {saving ? "Adding…" : "Add persona"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
