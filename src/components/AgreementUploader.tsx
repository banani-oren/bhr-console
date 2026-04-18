import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Upload, FileText, Check, X, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { Client } from '@/lib/types'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Card } from '@/components/ui/card'

type ExtractedAgreement = {
  document_kind: 'agreement' | 'vendor_form' | 'other'
  matched_client_name: string | null
  company_id: string | null
  client_address: string | null
  agreement_type: string | null
  commission_percent: number | null
  salary_basis: string | null
  warranty_days: number | null
  payment_terms: string | null
  payment_split: string | null
  advance: string | null
  exclusivity: boolean | null
  non_solicit_months: number | null
  hourly_rate: number | null
  notes: string | null
}

type FuzzyMatch = { client_id: string; name: string; score: number }

type PendingItem = {
  id: string
  file: File
  tempPath: string
  status: 'uploading' | 'extracting' | 'ready' | 'confirmed' | 'skipped' | 'error'
  error?: string
  extracted?: ExtractedAgreement
  fuzzy?: FuzzyMatch[]
  chosenClientId?: string | 'new' | ''
}

export default function AgreementUploader({ clients }: { clients: Client[] }) {
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<PendingItem[]>([])
  const [summary, setSummary] = useState<string | null>(null)

  const onClickOpen = () => {
    setItems([])
    setSummary(null)
    setOpen(true)
  }

  const processFile = async (file: File): Promise<PendingItem> => {
    const id = crypto.randomUUID()
    const tempPath = `pending/${id}.pdf`
    const item: PendingItem = {
      id,
      file,
      tempPath,
      status: 'uploading',
      chosenClientId: '',
    }
    // upload
    const { error: upErr } = await supabase.storage
      .from('client-agreements')
      .upload(tempPath, file, { contentType: 'application/pdf', upsert: true })
    if (upErr) {
      return { ...item, status: 'error', error: upErr.message }
    }
    // call edge function
    try {
      const { data, error } = await supabase.functions.invoke('extract-agreement', {
        body: { storage_path: tempPath },
      })
      if (error) throw error
      const payload = data as {
        extracted: ExtractedAgreement
        fuzzy_matches: FuzzyMatch[]
      }
      const top = payload.fuzzy_matches?.[0]
      return {
        ...item,
        status: 'ready',
        extracted: payload.extracted,
        fuzzy: payload.fuzzy_matches ?? [],
        chosenClientId: top && top.score > 0.85 ? top.client_id : '',
      }
    } catch (err) {
      return {
        ...item,
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }

  const handleFiles = async (files: FileList) => {
    const arr = Array.from(files).filter((f) => f.type === 'application/pdf')
    // Optimistic placeholders
    const placeholders: PendingItem[] = arr.map((file) => ({
      id: crypto.randomUUID(),
      file,
      tempPath: '',
      status: 'uploading',
      chosenClientId: '',
    }))
    setItems((prev) => [...prev, ...placeholders])
    const results = await Promise.all(arr.map((f) => processFile(f)))
    setItems((prev) => {
      // Remove the placeholders we added and append the real results.
      const phIds = new Set(placeholders.map((p) => p.id))
      const kept = prev.filter((p) => !phIds.has(p.id))
      return [...kept, ...results]
    })
  }

  const updateItem = (id: string, patch: Partial<PendingItem>) => {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)))
  }

  const mergeAgreementFields = (current: Client, ex: ExtractedAgreement): Partial<Client> => {
    const patch: Partial<Client> = {}
    // Only set a DB field if it is currently null/empty AND the extraction provided a value.
    const set = <K extends keyof Client>(k: K, v: Client[K] | null | undefined) => {
      if (v == null || v === '') return
      const curr = current[k]
      if (curr == null || curr === '') {
        patch[k] = v as Client[K]
      }
    }
    set('company_id', ex.company_id ?? null)
    set('address', ex.client_address ?? null)
    set('agreement_type', ex.agreement_type ?? null)
    set('commission_percent', ex.commission_percent ?? null)
    set('salary_basis', ex.salary_basis ?? null)
    set('warranty_days', ex.warranty_days ?? null)
    set('payment_terms', ex.payment_terms ?? null)
    set('payment_split', ex.payment_split ?? null)
    set('advance', ex.advance ?? null)
    set('hourly_rate', ex.hourly_rate ?? null)
    if (ex.exclusivity != null && !current.exclusivity) patch.exclusivity = ex.exclusivity
    return patch
  }

  const confirmItem = async (item: PendingItem) => {
    if (!item.extracted || !item.chosenClientId) return
    const clientId = item.chosenClientId
    if (clientId === 'new') {
      // Create a new client stub from extracted fields.
      const name = item.extracted.matched_client_name?.trim()
      if (!name) return
      const { data: created, error: cErr } = await supabase
        .from('clients')
        .insert({
          name,
          company_id: item.extracted.company_id ?? null,
          address: item.extracted.client_address ?? null,
          agreement_type: item.extracted.agreement_type ?? null,
          commission_percent: item.extracted.commission_percent ?? null,
          salary_basis: item.extracted.salary_basis ?? null,
          warranty_days: item.extracted.warranty_days ?? null,
          payment_terms: item.extracted.payment_terms ?? null,
          payment_split: item.extracted.payment_split ?? null,
          advance: item.extracted.advance ?? null,
          exclusivity: !!item.extracted.exclusivity,
          hourly_rate: item.extracted.hourly_rate ?? null,
          status: 'פעיל',
        })
        .select('id')
        .single()
      if (cErr || !created) {
        updateItem(item.id, { status: 'error', error: cErr?.message ?? 'insert failed' })
        return
      }
      await moveAndAttach(created.id as string, item)
      return
    }
    const existing = clients.find((c) => c.id === clientId)
    if (!existing) return
    const patch = mergeAgreementFields(existing, item.extracted)
    if (Object.keys(patch).length > 0) {
      await supabase.from('clients').update(patch).eq('id', clientId)
    }
    await moveAndAttach(clientId, item)
  }

  const moveAndAttach = async (clientId: string, item: PendingItem) => {
    const safeName = item.file.name.replace(/[/\\?%*:|"<>]/g, '_')
    const destPath = `${clientId}/${safeName}`
    const { error: moveErr } = await supabase.storage
      .from('client-agreements')
      .move(item.tempPath, destPath)
    if (moveErr) {
      // Fall back to copy-then-delete if move fails.
      const { data: dl } = await supabase.storage.from('client-agreements').download(item.tempPath)
      if (dl) {
        await supabase.storage.from('client-agreements').upload(destPath, dl, {
          contentType: 'application/pdf',
          upsert: true,
        })
        await supabase.storage.from('client-agreements').remove([item.tempPath])
      }
    }
    await supabase
      .from('clients')
      .update({ agreement_storage_path: destPath, agreement_file: safeName })
      .eq('id', clientId)
    updateItem(item.id, { status: 'confirmed' })
    queryClient.invalidateQueries({ queryKey: ['clients'] })
  }

  const skipItem = async (item: PendingItem) => {
    if (item.tempPath) {
      await supabase.storage.from('client-agreements').remove([item.tempPath])
    }
    updateItem(item.id, { status: 'skipped' })
  }

  const handleClose = async () => {
    // Clean up any unconfirmed pending uploads.
    const toClean = items.filter((i) => i.status === 'ready' && i.tempPath)
    for (const i of toClean) {
      await supabase.storage.from('client-agreements').remove([i.tempPath])
    }
    const confirmed = items.filter((i) => i.status === 'confirmed').length
    const skipped = items.filter((i) => i.status === 'skipped').length
    const errors = items.filter((i) => i.status === 'error').length
    if (items.length > 0) {
      setSummary(`${confirmed} עודכנו · ${skipped} דולגו · ${errors} שגיאות`)
      setTimeout(() => setSummary(null), 6000)
    }
    setOpen(false)
    setItems([])
  }

  return (
    <>
      <Button
        variant="outline"
        onClick={onClickOpen}
        className="flex items-center gap-2 border-purple-300 text-purple-700"
      >
        <FileText className="h-4 w-4" />
        העלה הסכמים
      </Button>

      {summary && (
        <div className="fixed bottom-6 left-6 z-50 rounded-lg bg-foreground text-background px-4 py-3 shadow-lg text-sm">
          {summary}
        </div>
      )}

      <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose() }}>
        <DialogContent dir="rtl" className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>העלאת קבצי הסכם</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer hover:border-purple-400 hover:bg-muted/40"
            >
              <Upload className="h-8 w-8 mx-auto mb-3 text-muted-foreground" />
              <p className="text-sm font-medium">גרור קבצי PDF לכאן או לחץ לבחירה</p>
              <p className="text-xs text-muted-foreground mt-1">ניתן לבחור מספר קבצים בו-זמנית</p>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="application/pdf"
                className="hidden"
                onChange={(e) => { if (e.target.files) handleFiles(e.target.files) }}
              />
            </div>

            {items.length === 0 ? null : (
              <div className="space-y-2">
                {items.map((item) => {
                  const active = item.status === 'ready'
                  return (
                    <Card key={item.id} className="p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-sm font-medium">
                          <FileText className="h-4 w-4 text-purple-600" />
                          <span className="truncate max-w-md">{item.file.name}</span>
                          <StatusBadge status={item.status} />
                        </div>
                      </div>
                      {item.status === 'error' && (
                        <p className="text-xs text-red-600 bg-red-50 border border-red-200 p-2 rounded">
                          {item.error}
                        </p>
                      )}
                      {item.status === 'ready' && item.extracted && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1 text-xs">
                          <Kv k="סוג מסמך" v={item.extracted.document_kind} />
                          <Kv k="לקוח שזוהה" v={item.extracted.matched_client_name} />
                          <Kv k="ח.פ." v={item.extracted.company_id} />
                          <Kv k="סוג הסכם" v={item.extracted.agreement_type} />
                          <Kv k="עמלה %" v={item.extracted.commission_percent} />
                          <Kv k="בסיס משכורת" v={item.extracted.salary_basis} />
                          <Kv k="אחריות" v={item.extracted.warranty_days ? `${item.extracted.warranty_days} ימים` : null} />
                          <Kv k="תנאי תשלום" v={item.extracted.payment_terms} />
                          <Kv k="מקדמה" v={item.extracted.advance} />
                          <Kv k="תעריף שעה" v={item.extracted.hourly_rate} />
                        </div>
                      )}
                      {item.status === 'ready' && (
                        <div className="flex items-center gap-2 flex-wrap">
                          <div className="flex-1 min-w-60">
                            <Select
                              value={item.chosenClientId ?? ''}
                              onValueChange={(v) => updateItem(item.id, { chosenClientId: (v ?? '') as typeof item.chosenClientId })}
                            >
                              <SelectTrigger><SelectValue placeholder="בחר לקוח לשיוך" /></SelectTrigger>
                              <SelectContent>
                                {(item.fuzzy ?? []).map((m) => (
                                  <SelectItem key={m.client_id} value={m.client_id}>
                                    {m.name} ({(m.score * 100).toFixed(0)}%)
                                  </SelectItem>
                                ))}
                                <SelectItem value="new">➕ צור לקוח חדש מהמסמך</SelectItem>
                                {/* Fallback: any other client */}
                                {clients.slice(0, 200).map((c) => (
                                  <SelectItem key={`any-${c.id}`} value={c.id}>
                                    {c.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <Button
                            size="sm"
                            className="bg-purple-600 hover:bg-purple-700 text-white"
                            disabled={!active || !item.chosenClientId}
                            onClick={() => confirmItem(item)}
                          >
                            <Check className="h-3 w-3 ml-1" /> אשר
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => skipItem(item)}>
                            <X className="h-3 w-3 ml-1" /> דלג
                          </Button>
                        </div>
                      )}
                    </Card>
                  )
                })}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={handleClose}>סגור</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function StatusBadge({ status }: { status: PendingItem['status'] }) {
  const map: Record<PendingItem['status'], { label: string; cls: string }> = {
    uploading: { label: 'מעלה...', cls: 'bg-muted text-muted-foreground' },
    extracting: { label: 'מחלץ...', cls: 'bg-amber-50 text-amber-700 border border-amber-200' },
    ready: { label: 'מוכן לאישור', cls: 'bg-purple-50 text-purple-700 border border-purple-200' },
    confirmed: { label: 'אושר ✓', cls: 'bg-green-50 text-green-700 border border-green-200' },
    skipped: { label: 'דולג', cls: 'bg-muted text-muted-foreground' },
    error: { label: 'שגיאה', cls: 'bg-red-50 text-red-700 border border-red-200' },
  }
  const it = map[status]
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded-full ${it.cls} flex items-center gap-1`}>
      {status === 'uploading' || status === 'extracting' ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : null}
      {it.label}
    </span>
  )
}

function Kv({ k, v }: { k: string; v: string | number | boolean | null | undefined }) {
  return (
    <div>
      <span className="text-muted-foreground">{k}:</span>{' '}
      <span className="font-medium">{v == null || v === '' ? '—' : String(v)}</span>
    </div>
  )
}
