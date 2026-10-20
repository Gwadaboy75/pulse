"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Pencil } from "lucide-react"
import { toast } from "sonner"
import { deleteDocument, updateDocument } from "@/server/actions/medical"
import type { DocumentVM } from "@/server/queries/types"
import { DOCUMENT_KINDS } from "@/server/medical/extraction"
import { Button } from "@/components/ui/button"
import { COPY } from "../../copy"
import { AREA, Field, FIELD, FormSheet, Select } from "../../form"

/** Edit the document's title, kind, date, practitioner and notes; delete it. */
export function DocumentActions({ doc }: { doc: DocumentVM }) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [d, setD] = React.useState({ title: doc.title, kind: doc.kind, day: doc.day ?? "", practitioner: doc.practitioner ?? "", notes: doc.notes ?? "" })
  const set = (k: keyof typeof d) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setD({ ...d, [k]: e.target.value })
  const c = COPY.documents
  return (
    <>
      <Button size="icon-touch" variant="ghost" aria-label={c.edit} onClick={() => setOpen(true)}>
        <Pencil aria-hidden strokeWidth={1.75} />
      </Button>
      <FormSheet
        open={open}
        onOpenChange={setOpen}
        title={c.edit}
        onSubmit={() => updateDocument({ id: doc.id, title: d.title, kind: d.kind as (typeof DOCUMENT_KINDS)[number], day: d.day || null, practitioner: d.practitioner, notes: d.notes })}
        onSaved={() => {
          toast.success(COPY.common.save)
          router.refresh()
        }}
        destructive={{
          label: c.delete,
          confirm: c.deleteConfirm,
          run: async () => {
            const r = await deleteDocument(doc.id)
            if (r.ok) router.replace("/medical/documents")
            return r
          },
        }}
      >
        <Field id="doc-title" label={c.fields.title}>
          <input id="doc-title" className={FIELD} value={d.title} onChange={set("title")} required />
        </Field>
        <Field id="doc-kind" label={c.fields.kind}>
          <Select id="doc-kind" value={d.kind} onChange={set("kind")}>
            {DOCUMENT_KINDS.map((k) => (
              <option key={k} value={k}>
                {COPY.kinds[k]}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="doc-day" label={c.fields.day} optional>
          <input id="doc-day" type="date" className={FIELD} value={d.day} onChange={set("day")} />
        </Field>
        <Field id="doc-practitioner" label={c.fields.practitioner} optional>
          <input id="doc-practitioner" className={FIELD} value={d.practitioner} onChange={set("practitioner")} />
        </Field>
        <Field id="doc-notes" label={c.fields.notes} optional>
          <textarea id="doc-notes" className={AREA} value={d.notes} onChange={set("notes")} />
        </Field>
      </FormSheet>
    </>
  )
}
