import { useState, useRef } from 'react'
import * as XLSX from 'xlsx'
import { Plus, Upload, Pencil, Trash2 } from 'lucide-react'

import { useTable, useInsert, useUpdate, useDelete } from '@/hooks/useSupabaseQuery'
import type { Agreement, Client } from '@/lib/types'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent } from '@/components/ui/card'
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from '@/components/ui/table'
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

// ─── Types ────────────────────────────────────────────────────────────────────

type AgreementForm = {
  client_id: string
  agreement_type: string
  commission_rate: string
  monthly_fee: string
  start_date: string
  end_date: string
  notes: string
}

const EMPTY_FORM: AgreementForm = {
  client_id: '',
  agreement_type: '',
  commission_rate: '',
  monthly_fee: '',
  start_date: '',
  end_date: '',
  notes: '',
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(dateStr: string | null | undefined) {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('he-IL')
}

function formatPercent(value: number | null | undefined) {
  if (value == null) return '—'
  return `${value}%`
}

function formatCurrency(value: number | null | undefined) {
  if (value == null) return '—'
  return new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 }).format(value)
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Agreements() {
  const { data: agreements = [], isLoading } = useTable<Agreement>('agreements')
  const { data: clients = [] } = useTable<Client>('clients')

  const insertAgreement = useInsert<Agreement>('agreements')
  const updateAgreement = useUpdate<Agreement>('agreements')
  const deleteAgreement = useDelete('agreements')
  const insertMany = useInsert<Agreement>('agreements')

  // ── Dialog state ────────────────────────────────────────────────────────────
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Agreement | null>(null)

  const [form, setForm] = useState<AgreementForm>(EMPTY_FORM)
  const [formError, setFormError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  // ── Import state ─────────────────────────────────────────────────────────────
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [importRows, setImportRows] = useState<Partial<Agreement>[]>([])
  const [importError, setImportError] = useState<string | null>(null)
  const [isImporting, setIsImporting] = useState(false)

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function openAdd() {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setFormError(null)
    setEditOpen(true)
  }

  function openEdit(agreement: Agreement) {
    setEditingId(agreement.id)
    setForm({
      client_id: agreement.client_id,
      agreement_type: agreement.agreement_type ?? '',
      commission_rate: agreement.commission_rate != null ? String(agreement.commission_rate) : '',
      monthly_fee: agreement.monthly_fee != null ? String(agreement.monthly_fee) : '',
      start_date: agreement.start_date ?? '',
      end_date: agreement.end_date ?? '',
      notes: agreement.notes ?? '',
    })
    setFormError(null)
    setEditOpen(true)
  }

  function openDelete(agreement: Agreement) {
    setDeleteTarget(agreement)
    setDeleteOpen(true)
  }

  function updateField(field: keyof AgreementForm, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  async function handleSave() {
    setFormError(null)
    if (!form.client_id) { setFormError('יש לבחור לקוח'); return }
    if (!form.agreement_type.trim()) { setFormError('יש למלא סוג הסכם'); return }
    if (!form.start_date) { setFormError('יש למלא תאריך התחלה'); return }

    const payload: Partial<Agreement> = {
      client_id: form.client_id,
      agreement_type: form.agreement_type.trim(),
      commission_rate: form.commission_rate !== '' ? Number(form.commission_rate) : 0,
      monthly_fee: form.monthly_fee !== '' ? Number(form.monthly_fee) : 0,
      start_date: form.start_date,
      end_date: form.end_date || null,
      notes: form.notes.trim() || null,
    }

    setIsSaving(true)
    try {
      if (editingId) {
        await updateAgreement.mutateAsync({ id: editingId, ...payload })
      } else {
        await insertAgreement.mutateAsync(payload)
      }
      setEditOpen(false)
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'שגיאה בשמירה')
    } finally {
      setIsSaving(false)
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    try {
      await deleteAgreement.mutateAsync(deleteTarget.id)
      setDeleteOpen(false)
      setDeleteTarget(null)
    } catch {
      // silent — toast system can be wired up later
    }
  }

  // ── Import ───────────────────────────────────────────────────────────────────

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    setImportError(null)
    setImportRows([])
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (event) => {
      try {
        const data = new Uint8Array(event.target!.result as ArrayBuffer)
        const workbook = XLSX.read(data, { type: 'array' })
        const sheet = workbook.Sheets[workbook.SheetNames[0]]
        const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, { defval: '' })

        const mapped: Partial<Agreement>[] = rows.map((row) => ({
          client_id: String(row['client_id'] ?? ''),
          agreement_type: String(row['agreement_type'] ?? row['סוג'] ?? ''),
          commission_rate: row['commission_rate'] != null ? Number(row['commission_rate']) : 0,
          monthly_fee: row['monthly_fee'] != null ? Number(row['monthly_fee']) : 0,
          start_date: String(row['start_date'] ?? row['תאריך_התחלה'] ?? ''),
          end_date: row['end_date'] ? String(row['end_date']) : null,
          notes: row['notes'] ? String(row['notes']) : null,
        }))

        setImportRows(mapped)
      } catch {
        setImportError('שגיאה בקריאת הקובץ. ודא שמדובר בקובץ Excel תקין.')
      }
    }
    reader.readAsArrayBuffer(file)
  }

  async function handleImport() {
    if (!importRows.length) return
    setIsImporting(true)
    setImportError(null)
    try {
      for (const row of importRows) {
        await insertMany.mutateAsync(row)
      }
      setImportOpen(false)
      setImportRows([])
      if (fileInputRef.current) fileInputRef.current.value = ''
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'שגיאה בייבוא')
    } finally {
      setIsImporting(false)
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 space-y-4" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">הסכמים</h1>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => { setImportRows([]); setImportError(null); setImportOpen(true) }}
          >
            <Upload className="size-4" />
            ייבוא
          </Button>
          <Button
            className="bg-purple-600 hover:bg-purple-700 text-white border-transparent focus-visible:ring-purple-500/50"
            onClick={openAdd}
          >
            <Plus className="size-4" />
            הוסף הסכם
          </Button>
        </div>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
              טוען...
            </div>
          ) : agreements.length === 0 ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
              אין הסכמים להצגה
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">לקוח</TableHead>
                  <TableHead className="text-right">סוג</TableHead>
                  <TableHead className="text-right">עמלה %</TableHead>
                  <TableHead className="text-right">דמי ניהול חודשיים</TableHead>
                  <TableHead className="text-right">תאריך התחלה</TableHead>
                  <TableHead className="text-right">תאריך סיום</TableHead>
                  <TableHead className="text-right">הערות</TableHead>
                  <TableHead className="text-right">פעולות</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {agreements.map((agreement) => (
                  <TableRow key={agreement.id}>
                    <TableCell className="font-medium">{agreement.client_name || '—'}</TableCell>
                    <TableCell>{agreement.agreement_type || '—'}</TableCell>
                    <TableCell>{formatPercent(agreement.commission_rate)}</TableCell>
                    <TableCell>{formatCurrency(agreement.monthly_fee)}</TableCell>
                    <TableCell>{formatDate(agreement.start_date)}</TableCell>
                    <TableCell>{formatDate(agreement.end_date)}</TableCell>
                    <TableCell className="max-w-48 truncate text-muted-foreground">
                      {agreement.notes || '—'}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => openEdit(agreement)}
                          title="עריכה"
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => openDelete(agreement)}
                          title="מחיקה"
                          className="text-destructive hover:text-destructive"
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* ── Add / Edit Dialog ─────────────────────────────────────────────────── */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-lg" dir="rtl">
          <DialogHeader>
            <DialogTitle>{editingId ? 'עריכת הסכם' : 'הוספת הסכם'}</DialogTitle>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            {/* Client */}
            <div className="flex flex-col gap-1.5">
              <Label>לקוח</Label>
              <Select value={form.client_id} onValueChange={(val) => updateField('client_id', val ?? '')}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="בחר לקוח" />
                </SelectTrigger>
                <SelectContent>
                  {clients.map((client) => (
                    <SelectItem key={client.id} value={client.id}>
                      {client.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Agreement type */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="agreement_type">סוג הסכם</Label>
              <Input
                id="agreement_type"
                value={form.agreement_type}
                onChange={(e) => updateField('agreement_type', e.target.value)}
                placeholder="למשל: גיוס, ניהול, ייעוץ"
              />
            </div>

            {/* Commission rate + monthly fee */}
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="commission_rate">עמלה %</Label>
                <Input
                  id="commission_rate"
                  type="number"
                  min={0}
                  max={100}
                  step={0.1}
                  value={form.commission_rate}
                  onChange={(e) => updateField('commission_rate', e.target.value)}
                  placeholder="0"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="monthly_fee">דמי ניהול חודשיים (₪)</Label>
                <Input
                  id="monthly_fee"
                  type="number"
                  min={0}
                  step={1}
                  value={form.monthly_fee}
                  onChange={(e) => updateField('monthly_fee', e.target.value)}
                  placeholder="0"
                />
              </div>
            </div>

            {/* Dates */}
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="start_date">תאריך התחלה</Label>
                <Input
                  id="start_date"
                  type="date"
                  value={form.start_date}
                  onChange={(e) => updateField('start_date', e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="end_date">תאריך סיום</Label>
                <Input
                  id="end_date"
                  type="date"
                  value={form.end_date}
                  onChange={(e) => updateField('end_date', e.target.value)}
                />
              </div>
            </div>

            {/* Notes */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="notes">הערות</Label>
              <Textarea
                id="notes"
                value={form.notes}
                onChange={(e) => updateField('notes', e.target.value)}
                placeholder="הערות נוספות..."
                rows={3}
              />
            </div>

            {formError && (
              <p className="text-sm text-destructive">{formError}</p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)} disabled={isSaving}>
              ביטול
            </Button>
            <Button
              className="bg-purple-600 hover:bg-purple-700 text-white border-transparent focus-visible:ring-purple-500/50"
              onClick={handleSave}
              disabled={isSaving}
            >
              {isSaving ? 'שומר...' : 'שמור'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirmation Dialog ────────────────────────────────────────── */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-sm" dir="rtl">
          <DialogHeader>
            <DialogTitle>מחיקת הסכם</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-2">
            האם למחוק את ההסכם עם{' '}
            <span className="font-medium text-foreground">
              {deleteTarget?.client_name}
            </span>
            ? פעולה זו אינה הפיכה.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              ביטול
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              מחק
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Import Dialog ─────────────────────────────────────────────────────── */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="sm:max-w-lg" dir="rtl">
          <DialogHeader>
            <DialogTitle>ייבוא הסכמים מ-Excel</DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-2">
            <p className="text-sm text-muted-foreground">
              העלה קובץ Excel (.xlsx / .xls) עם עמודות:{' '}
              <code className="text-xs bg-muted px-1 py-0.5 rounded">client_id</code>,{' '}
              <code className="text-xs bg-muted px-1 py-0.5 rounded">agreement_type</code>,{' '}
              <code className="text-xs bg-muted px-1 py-0.5 rounded">commission_rate</code>,{' '}
              <code className="text-xs bg-muted px-1 py-0.5 rounded">monthly_fee</code>,{' '}
              <code className="text-xs bg-muted px-1 py-0.5 rounded">start_date</code>,{' '}
              <code className="text-xs bg-muted px-1 py-0.5 rounded">end_date</code>,{' '}
              <code className="text-xs bg-muted px-1 py-0.5 rounded">notes</code>
            </p>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="import_file">קובץ Excel</Label>
              <Input
                id="import_file"
                type="file"
                accept=".xlsx,.xls"
                ref={fileInputRef}
                onChange={handleFileChange}
              />
            </div>

            {importRows.length > 0 && (
              <p className="text-sm text-muted-foreground">
                נמצאו{' '}
                <span className="font-medium text-foreground">{importRows.length}</span>{' '}
                שורות לייבוא.
              </p>
            )}

            {importError && (
              <p className="text-sm text-destructive">{importError}</p>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setImportOpen(false)
                setImportRows([])
                setImportError(null)
                if (fileInputRef.current) fileInputRef.current.value = ''
              }}
              disabled={isImporting}
            >
              ביטול
            </Button>
            <Button
              className="bg-purple-600 hover:bg-purple-700 text-white border-transparent focus-visible:ring-purple-500/50"
              onClick={handleImport}
              disabled={isImporting || importRows.length === 0}
            >
              {isImporting ? 'מייבא...' : `ייבא ${importRows.length ? `(${importRows.length})` : ''}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
