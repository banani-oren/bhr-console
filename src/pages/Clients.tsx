import { useState, useRef, useMemo } from 'react'
import * as XLSX from 'xlsx'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Client } from '@/lib/types'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import { Plus, Upload, Search, Pencil, Trash2 } from 'lucide-react'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type ClientForm = {
  name: string
  company_id: string
  address: string
  contact_name: string
  phone: string
  email: string
  status: string
  notes: string
  agreement_type: string
  commission_percent: string
  salary_basis: string
  warranty_days: string
  payment_terms: string
  payment_split: string
  advance: string
  exclusivity: boolean
  agreement_file: string
  hourly_rate: string
  time_log_enabled: boolean
  time_log_permissions: string[]
}

const emptyForm: ClientForm = {
  name: '',
  company_id: '',
  address: '',
  contact_name: '',
  phone: '',
  email: '',
  status: 'פעיל',
  notes: '',
  agreement_type: '',
  commission_percent: '',
  salary_basis: '',
  warranty_days: '',
  payment_terms: '',
  payment_split: '',
  advance: '',
  exclusivity: false,
  agreement_file: '',
  hourly_rate: '',
  time_log_enabled: false,
  time_log_permissions: [],
}

function clientToForm(c: Client): ClientForm {
  return {
    name: c.name,
    company_id: c.company_id ?? '',
    address: c.address ?? '',
    contact_name: c.contact_name ?? '',
    phone: c.phone ?? '',
    email: c.email ?? '',
    status: c.status ?? 'פעיל',
    notes: c.notes ?? '',
    agreement_type: c.agreement_type ?? '',
    commission_percent: c.commission_percent != null ? String(c.commission_percent) : '',
    salary_basis: c.salary_basis ?? '',
    warranty_days: c.warranty_days != null ? String(c.warranty_days) : '',
    payment_terms: c.payment_terms ?? '',
    payment_split: c.payment_split ?? '',
    advance: c.advance ?? '',
    exclusivity: c.exclusivity ?? false,
    agreement_file: c.agreement_file ?? '',
    hourly_rate: c.hourly_rate != null ? String(c.hourly_rate) : '',
    time_log_enabled: c.time_log_enabled ?? false,
    time_log_permissions: [],
  }
}

function formToPayload(form: ClientForm) {
  return {
    name: form.name,
    company_id: form.company_id || null,
    address: form.address || null,
    contact_name: form.contact_name || null,
    phone: form.phone || null,
    email: form.email || null,
    status: form.status || 'פעיל',
    notes: form.notes || null,
    agreement_type: form.agreement_type || null,
    commission_percent: form.commission_percent ? Number(form.commission_percent) : null,
    salary_basis: form.salary_basis || null,
    warranty_days: form.warranty_days ? Number(form.warranty_days) : null,
    payment_terms: form.payment_terms || null,
    payment_split: form.payment_split || null,
    advance: form.advance || null,
    exclusivity: form.exclusivity,
    agreement_file: form.agreement_file || null,
    hourly_rate: form.hourly_rate ? Number(form.hourly_rate) : null,
    time_log_enabled: form.time_log_enabled,
  }
}

function statusLabel(s: string) {
  return s === 'פעיל' || s === 'active' ? 'פעיל' : 'לא פעיל'
}

function statusVariant(s: string): 'default' | 'secondary' {
  return s === 'פעיל' || s === 'active' ? 'default' : 'secondary'
}

const AGREEMENT_TYPES = ['השמה', 'ריטיינר', 'ליווי', 'אחר']

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Clients() {
  const queryClient = useQueryClient()

  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterGroup, setFilterGroup] = useState('all')

  const { data: clients = [], isLoading } = useQuery<Client[]>({
    queryKey: ['clients'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clients')
        .select('*')
        .order('name', { ascending: true })
      if (error) throw error
      return data as Client[]
    },
  })

  // Filter client-side
  const filtered = useMemo(() => {
    return clients.filter((c) => {
      if (search && !c.name.toLowerCase().includes(search.toLowerCase())) return false
      if (filterStatus !== 'all' && c.status !== filterStatus) return false
      if (filterGroup !== 'all' && c.group_name !== filterGroup) return false
      return true
    })
  }, [clients, search, filterStatus, filterGroup])

  const groups = useMemo(
    () => [...new Set(clients.map((c) => c.group_name).filter(Boolean))].sort() as string[],
    [clients],
  )

  // ---- Card dialog state ----
  const [cardOpen, setCardOpen] = useState(false)
  const [editingClient, setEditingClient] = useState<Client | null>(null)
  const [form, setForm] = useState<ClientForm>(emptyForm)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle')

  // ---- Delete dialog state ----
  const [deleteTarget, setDeleteTarget] = useState<Client | null>(null)

  // ---- Import dialog state ----
  type ImportNewRow = {
    name: string
    company_id: string | null
    address: string | null
    contact_name: string | null
    phone: string | null
    email: string | null
    hourly_rate: number | null
  }
  type ImportUpdateRow = {
    existing: Client
    updates: Partial<ImportNewRow>
    incoming: ImportNewRow
  }
  type ImportSkipRow = { rowIndex: number; reason: string }
  type ImportAnalysis = {
    newRows: ImportNewRow[]
    updateRows: ImportUpdateRow[]
    skippedRows: ImportSkipRow[]
    fileName: string
  }

  const [importOpen, setImportOpen] = useState(false)
  const [importAnalysis, setImportAnalysis] = useState<ImportAnalysis | null>(null)
  const [isImporting, setIsImporting] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [importSummary, setImportSummary] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function setField<K extends keyof ClientForm>(key: K, value: ClientForm[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function openCreate() {
    setEditingClient(null)
    setForm(emptyForm)
    setSaveStatus('idle')
    setCardOpen(true)
  }

  function openEdit(client: Client) {
    setEditingClient(client)
    setForm(clientToForm(client))
    setSaveStatus('idle')
    setCardOpen(true)
  }

  function closeCard() {
    setCardOpen(false)
    setEditingClient(null)
    setSaveStatus('idle')
  }

  async function handleSave() {
    if (!form.name.trim()) return
    setSaveStatus('saving')
    try {
      const payload = formToPayload(form)
      if (editingClient) {
        const { error } = await supabase.from('clients').update(payload).eq('id', editingClient.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('clients').insert(payload)
        if (error) throw error
      }
      setSaveStatus('success')
      queryClient.invalidateQueries({ queryKey: ['clients'] })
      setTimeout(() => closeCard(), 2000)
    } catch (err) {
      console.error('Save error:', err)
      setSaveStatus('error')
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    try {
      const { error } = await supabase.from('clients').delete().eq('id', deleteTarget.id)
      if (error) throw error
      queryClient.invalidateQueries({ queryKey: ['clients'] })
      setDeleteTarget(null)
    } catch (err) {
      console.error('Delete error:', err)
    }
  }

  // ---- Import ----
  // Field labels for diff preview
  const FIELD_LABELS: Record<keyof ImportNewRow, string> = {
    name: 'שם',
    company_id: 'מספר עסק',
    address: 'כתובת',
    contact_name: 'איש קשר',
    phone: 'נייד',
    email: 'דואל',
    hourly_rate: 'תעריף שעת עבודה',
  }

  function normalizeHeader(h: string): string {
    return h.replace(/\s+/g, '').trim().toLowerCase()
  }

  function collapseWs(s: string): string {
    return s.trim().replace(/\s+/g, ' ')
  }

  function normName(s: string): string {
    return collapseWs(s).toLowerCase()
  }

  function normCompanyId(s: string): string {
    return s.replace(/\s+/g, '').toLowerCase()
  }

  function normPhone(raw: string): string | null {
    const trimmed = String(raw ?? '').trim()
    if (!trimmed) return null
    const startsWithZero = trimmed.startsWith('0')
    const digits = trimmed.replace(/\D/g, '')
    if (!digits) return null
    if (startsWithZero && !digits.startsWith('0')) return '0' + digits
    return digits
  }

  function parseFile(file: File) {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer)
        const workbook = XLSX.read(data, { type: 'array' })

        // Prefer 'רשימת לקוחות - קבועים' then 'פרטי לקוחות' then first sheet.
        const sheet =
          workbook.Sheets['רשימת לקוחות - קבועים'] ??
          workbook.Sheets['פרטי לקוחות'] ??
          workbook.Sheets[workbook.SheetNames[0]]
        const jsonRows = XLSX.utils.sheet_to_json(sheet, {
          defval: '',
          raw: false,
        }) as Record<string, unknown>[]

        // Build normalized-header lookup
        const keyMap = new Map<string, keyof ImportNewRow>()
        const HEADERS: Array<[string, keyof ImportNewRow]> = [
          ['שם העסק', 'name'],
          ['שם איש הקשר', 'contact_name'],
          ['דואל', 'email'],
          ['נייד', 'phone'],
          ['מספר עסק', 'company_id'],
          ['כתובת', 'address'],
          ['תעריף שעת עבודה', 'hourly_rate'],
        ]
        for (const [label, field] of HEADERS) {
          keyMap.set(normalizeHeader(label), field)
        }

        const readCell = (row: Record<string, unknown>, field: keyof ImportNewRow): string => {
          for (const [k, v] of Object.entries(row)) {
            const normK = normalizeHeader(k)
            if (keyMap.get(normK) === field) {
              return v == null ? '' : String(v)
            }
          }
          return ''
        }

        // Build lookup maps from current clients
        const byCompanyId = new Map<string, Client>()
        const byName = new Map<string, Client>()
        for (const c of clients) {
          if (c.company_id) {
            byCompanyId.set(normCompanyId(String(c.company_id)), c)
          }
          if (c.name) {
            byName.set(normName(c.name), c)
          }
        }

        const newRows: ImportNewRow[] = []
        const updateRows: ImportUpdateRow[] = []
        const skippedRows: ImportSkipRow[] = []
        const seenInFile = new Set<string>()

        jsonRows.forEach((row, idx) => {
          const rawName = readCell(row, 'name')
          const nameTrimmed = collapseWs(rawName)
          if (!nameTrimmed) {
            // Skip entirely empty rows silently; otherwise warn.
            const anyValue = Object.values(row).some((v) => v != null && String(v).trim() !== '')
            if (anyValue) {
              skippedRows.push({ rowIndex: idx + 2, reason: 'חסר שם עסק' })
            }
            return
          }

          const companyIdRaw = readCell(row, 'company_id')
          const companyId = companyIdRaw.replace(/\s+/g, '').trim() || null

          const emailRaw = readCell(row, 'email').trim()
          const email = emailRaw ? emailRaw.toLowerCase() : null

          const phone = normPhone(readCell(row, 'phone'))

          const contact = readCell(row, 'contact_name').trim() || null
          const address = readCell(row, 'address').trim() || null
          const hourlyRateRaw = readCell(row, 'hourly_rate').trim()
          const hourlyRate = hourlyRateRaw ? Number(hourlyRateRaw.replace(/[^0-9.]/g, '')) : null

          const incoming: ImportNewRow = {
            name: nameTrimmed,
            company_id: companyId,
            address,
            contact_name: contact,
            phone,
            email,
            hourly_rate: Number.isFinite(hourlyRate) ? hourlyRate : null,
          }

          // De-dup within the upload itself: pick the first occurrence only.
          const fileKey = companyId ? 'cid:' + normCompanyId(companyId) : 'nm:' + normName(nameTrimmed)
          if (seenInFile.has(fileKey)) {
            skippedRows.push({ rowIndex: idx + 2, reason: 'שורה כפולה בקובץ' })
            return
          }
          seenInFile.add(fileKey)

          // Match existing
          let existing: Client | undefined
          if (companyId) {
            existing = byCompanyId.get(normCompanyId(companyId))
          }
          if (!existing) {
            existing = byName.get(normName(nameTrimmed))
          }

          if (!existing) {
            newRows.push(incoming)
            return
          }

          // Build diff: only fields where Excel has a non-empty value and it differs from DB.
          const updates: Partial<ImportNewRow> = {}
          const fields: Array<keyof ImportNewRow> = [
            'name',
            'company_id',
            'address',
            'contact_name',
            'phone',
            'email',
            'hourly_rate',
          ]
          for (const field of fields) {
            const incomingVal = incoming[field]
            if (incomingVal == null || incomingVal === '') continue
            const dbVal = (existing as Record<string, unknown>)[field]
            const dbStr = dbVal == null ? '' : String(dbVal)
            if (dbStr !== String(incomingVal)) {
              (updates as Record<string, unknown>)[field] = incomingVal
            }
          }

          if (Object.keys(updates).length === 0) {
            // No-op update — surface it as "update" with empty diff so the user sees it's a match.
            updateRows.push({ existing, updates, incoming })
          } else {
            updateRows.push({ existing, updates, incoming })
          }
        })

        setImportAnalysis({
          newRows,
          updateRows,
          skippedRows,
          fileName: file.name,
        })
      } catch (err) {
        console.error('parseFile error', err)
        setImportAnalysis({
          newRows: [],
          updateRows: [],
          skippedRows: [{ rowIndex: 0, reason: 'כשלון בקריאת הקובץ' }],
          fileName: file.name,
        })
      }
    }
    reader.readAsArrayBuffer(file)
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) parseFile(file)
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) parseFile(file)
  }

  async function handleConfirmImport() {
    if (!importAnalysis) return
    setIsImporting(true)
    let inserted = 0
    let updated = 0
    let failed = 0
    try {
      // Insert new rows
      for (const row of importAnalysis.newRows) {
        const payload = {
          name: row.name,
          company_id: row.company_id,
          address: row.address,
          contact_name: row.contact_name,
          phone: row.phone,
          email: row.email,
          hourly_rate: row.hourly_rate,
          status: 'פעיל',
        }
        const { error } = await supabase.from('clients').insert(payload)
        if (error) {
          console.error('Import insert error:', error, payload)
          failed += 1
        } else {
          inserted += 1
        }
      }

      // Apply updates — only fields in `updates`; never touches agreement fields.
      for (const u of importAnalysis.updateRows) {
        if (Object.keys(u.updates).length === 0) continue
        const { error } = await supabase
          .from('clients')
          .update(u.updates)
          .eq('id', u.existing.id)
        if (error) {
          console.error('Import update error:', error, u)
          failed += 1
        } else {
          updated += 1
        }
      }

      await queryClient.invalidateQueries({ queryKey: ['clients'] })
      const skipped = importAnalysis.skippedRows.length
      const summary = `נוספו ${inserted} • עודכנו ${updated} • דולגו ${skipped}${failed ? ` • שגיאות: ${failed}` : ''}`
      setImportSummary(summary)
      setImportAnalysis(null)
      setImportOpen(false)
      setTimeout(() => setImportSummary(null), 5000)
    } catch (err) {
      console.error('Import error:', err)
    } finally {
      setIsImporting(false)
    }
  }

  function closeImportDialog() {
    setImportOpen(false)
    setImportAnalysis(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // ---- Render ----
  return (
    <div dir="rtl" className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">לקוחות</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setImportOpen(true)} className="flex items-center gap-2">
            <Upload className="h-4 w-4" />
            ייבוא מאקסל
          </Button>
          <Button onClick={openCreate} className="flex items-center gap-2 bg-purple-600 hover:bg-purple-700 text-white">
            <Plus className="h-4 w-4" />
            לקוח חדש
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap items-end">
        <div className="relative max-w-xs flex-1">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="חיפוש לפי שם..." value={search} onChange={(e) => setSearch(e.target.value)} className="pr-9" />
        </div>
        <Select value={filterStatus} onValueChange={(v) => setFilterStatus(v ?? 'all')}>
          <SelectTrigger className="w-32"><SelectValue placeholder="סטטוס" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">הכל</SelectItem>
            <SelectItem value="פעיל">פעיל</SelectItem>
            <SelectItem value="לא פעיל">לא פעיל</SelectItem>
          </SelectContent>
        </Select>
        {groups.length > 0 && (
          <Select value={filterGroup} onValueChange={(v) => setFilterGroup(v ?? 'all')}>
            <SelectTrigger className="w-36"><SelectValue placeholder="קבוצה" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">כל הקבוצות</SelectItem>
              {groups.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Table */}
      <Card>
        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground">טוען...</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-right">שם לקוח</TableHead>
                <TableHead className="text-right">איש קשר</TableHead>
                <TableHead className="text-right">נייד</TableHead>
                <TableHead className="text-right">סוג הסכם</TableHead>
                <TableHead className="text-right">תעריף/שעה</TableHead>
                <TableHead className="text-right">סטטוס</TableHead>
                <TableHead className="text-right">פעולות</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    לא נמצאו לקוחות
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((client) => (
                  <TableRow key={client.id} className="cursor-pointer hover:bg-purple-50/50" onClick={() => openEdit(client)}>
                    <TableCell className="font-medium">{client.name}</TableCell>
                    <TableCell>{client.contact_name ?? '—'}</TableCell>
                    <TableCell dir="ltr" className="text-right">{client.phone ?? '—'}</TableCell>
                    <TableCell>{client.agreement_type ?? '—'}</TableCell>
                    <TableCell dir="ltr" className="text-right">
                      {client.hourly_rate != null
                        ? new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 }).format(client.hourly_rate)
                        : '—'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(client.status)}>{statusLabel(client.status)}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                        <Button size="icon" variant="ghost" onClick={() => openEdit(client)} title="עריכה">
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => setDeleteTarget(client)} title="מחיקה" className="text-destructive hover:text-destructive">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        )}
      </Card>

      {/* ================================================================== */}
      {/* Unified Client Card Dialog                                         */}
      {/* ================================================================== */}
      <Dialog open={cardOpen} onOpenChange={(open) => { if (!open) closeCard() }}>
        <DialogContent dir="rtl" className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingClient ? `עריכת ${editingClient.name}` : 'לקוח חדש'}</DialogTitle>
          </DialogHeader>

          <div className="space-y-6 py-2">
            {/* Section 1 — פרטי החברה */}
            <div>
              <h3 className="text-sm font-semibold text-purple-700 mb-3">פרטי החברה</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>שם לקוח *</Label>
                  <Input value={form.name} onChange={(e) => setField('name', e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>ח.פ.</Label>
                  <Input value={form.company_id} onChange={(e) => setField('company_id', e.target.value)} dir="ltr" />
                </div>
                <div className="space-y-1.5">
                  <Label>כתובת</Label>
                  <Input value={form.address} onChange={(e) => setField('address', e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>סטטוס</Label>
                  <Select value={form.status} onValueChange={(v) => setField('status', v ?? 'פעיל')}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="פעיל">פעיל</SelectItem>
                      <SelectItem value="לא פעיל">לא פעיל</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>איש קשר</Label>
                  <Input value={form.contact_name} onChange={(e) => setField('contact_name', e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>טלפון</Label>
                  <Input value={form.phone} onChange={(e) => setField('phone', e.target.value)} dir="ltr" />
                </div>
                <div className="space-y-1.5 md:col-span-2">
                  <Label>מייל</Label>
                  <Input type="email" value={form.email} onChange={(e) => setField('email', e.target.value)} dir="ltr" />
                </div>
              </div>
              <div className="space-y-1.5 mt-4">
                <Label>הערות</Label>
                <Textarea value={form.notes} onChange={(e) => setField('notes', e.target.value)} rows={2} />
              </div>
            </div>

            <Separator />

            {/* Section 2 — תנאי הסכם */}
            <div>
              <h3 className="text-sm font-semibold text-purple-700 mb-3">תנאי הסכם</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>סוג הסכם</Label>
                  <Select value={form.agreement_type} onValueChange={(v) => setField('agreement_type', v ?? '')}>
                    <SelectTrigger><SelectValue placeholder="בחר סוג" /></SelectTrigger>
                    <SelectContent>
                      {AGREEMENT_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>אחוז עמלה %</Label>
                  <Input type="number" dir="ltr" value={form.commission_percent} onChange={(e) => setField('commission_percent', e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>בסיס משכורות</Label>
                  <Input value={form.salary_basis} onChange={(e) => setField('salary_basis', e.target.value)} dir="ltr" />
                </div>
                <div className="space-y-1.5">
                  <Label>תקופת אחריות בימים</Label>
                  <Input type="number" dir="ltr" value={form.warranty_days} onChange={(e) => setField('warranty_days', e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>תנאי תשלום</Label>
                  <Input value={form.payment_terms} onChange={(e) => setField('payment_terms', e.target.value)} placeholder="שוטף + 30" />
                </div>
                <div className="space-y-1.5">
                  <Label>חלוקת תשלום</Label>
                  <Input value={form.payment_split} onChange={(e) => setField('payment_split', e.target.value)} dir="ltr" placeholder="30/70" />
                </div>
                <div className="space-y-1.5">
                  <Label>מקדמה</Label>
                  <Input value={form.advance} onChange={(e) => setField('advance', e.target.value)} />
                </div>
                <div className="space-y-1.5 flex items-center gap-3 pt-6">
                  <Switch checked={form.exclusivity} onCheckedChange={(v) => setField('exclusivity', v)} />
                  <Label>בלעדיות</Label>
                </div>
                <div className="space-y-1.5">
                  <Label>תעריף שעת עבודה (₪)</Label>
                  <Input
                    type="number"
                    dir="ltr"
                    step={1}
                    value={form.hourly_rate}
                    onChange={(e) => setField('hourly_rate', e.target.value)}
                    placeholder="למשל 200"
                  />
                </div>
                <div className="space-y-1.5 md:col-span-2">
                  <Label>שם קובץ הסכם</Label>
                  <Input value={form.agreement_file} onChange={(e) => setField('agreement_file', e.target.value)} />
                </div>
              </div>
            </div>

          </div>

          <DialogFooter className="flex flex-col gap-2">
            {saveStatus === 'success' && (
              <p className="text-green-600 font-medium text-sm text-right">המידע נשמר ✓</p>
            )}
            {saveStatus === 'error' && (
              <p className="text-red-600 font-medium text-sm text-right">שגיאה בשמירה, נסה שנית</p>
            )}
            <div className="flex gap-2 flex-row-reverse">
              <Button onClick={handleSave} disabled={saveStatus === 'saving' || saveStatus === 'success' || !form.name.trim()} className="bg-purple-600 hover:bg-purple-700 text-white">
                {saveStatus === 'saving' ? 'שומר...' : 'שמור'}
              </Button>
              <Button variant="outline" onClick={closeCard} disabled={saveStatus === 'saving'}>ביטול</Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}>
        <DialogContent dir="rtl" className="max-w-sm">
          <DialogHeader><DialogTitle>מחיקת לקוח</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            האם אתה בטוח שברצונך למחוק את <span className="font-semibold text-foreground">{deleteTarget?.name}</span>?
            פעולה זו אינה ניתנת לביטול.
          </p>
          <DialogFooter className="flex gap-2 flex-row-reverse">
            <Button variant="destructive" onClick={handleDelete}>מחק</Button>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>ביטול</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import summary toast */}
      {importSummary && (
        <div className="fixed bottom-6 left-6 z-50 rounded-lg bg-foreground text-background px-4 py-3 shadow-lg text-sm">
          {importSummary}
        </div>
      )}

      {/* Import Dialog */}
      <Dialog open={importOpen} onOpenChange={(open) => { if (!open) closeImportDialog() }}>
        <DialogContent dir="rtl" className="max-w-4xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>ייבוא לקוחות מאקסל</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div
              onDrop={handleDrop}
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
              onDragLeave={() => setIsDragging(false)}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${isDragging ? 'border-purple-500 bg-purple-50' : 'border-muted-foreground/30 hover:border-purple-400 hover:bg-muted/40'}`}
            >
              <Upload className="h-8 w-8 mx-auto mb-3 text-muted-foreground" />
              {importAnalysis?.fileName ? (
                <p className="text-sm font-medium">{importAnalysis.fileName}</p>
              ) : (
                <>
                  <p className="text-sm font-medium">גרור קובץ לכאן או לחץ לבחירה</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    קבצי Excel (.xlsx) — כותרות נתמכות: שם העסק, שם איש הקשר, דואל, נייד, מספר עסק, כתובת
                  </p>
                </>
              )}
              <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFileInput} />
            </div>

            {importAnalysis && (
              <div className="space-y-4">
                {/* New rows section */}
                <section className="rounded-lg border border-green-200 bg-green-50/50">
                  <header className="flex items-center justify-between px-4 py-2 border-b border-green-200 bg-green-100/50">
                    <h3 className="text-sm font-semibold text-green-800">
                      חדשים ({importAnalysis.newRows.length})
                    </h3>
                  </header>
                  {importAnalysis.newRows.length === 0 ? (
                    <p className="p-4 text-xs text-muted-foreground">אין לקוחות חדשים</p>
                  ) : (
                    <div className="max-h-40 overflow-y-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-right">שם</TableHead>
                            <TableHead className="text-right">איש קשר</TableHead>
                            <TableHead className="text-right">נייד</TableHead>
                            <TableHead className="text-right">דואל</TableHead>
                            <TableHead className="text-right">מספר עסק</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {importAnalysis.newRows.slice(0, 20).map((row, i) => (
                            <TableRow key={i}>
                              <TableCell className="font-medium">{row.name}</TableCell>
                              <TableCell>{row.contact_name ?? '—'}</TableCell>
                              <TableCell dir="ltr" className="text-right">{row.phone ?? '—'}</TableCell>
                              <TableCell dir="ltr" className="text-right">{row.email ?? '—'}</TableCell>
                              <TableCell dir="ltr" className="text-right">{row.company_id ?? '—'}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                      {importAnalysis.newRows.length > 20 && (
                        <p className="text-[11px] text-muted-foreground px-4 py-2">
                          ועוד {importAnalysis.newRows.length - 20} לקוחות חדשים...
                        </p>
                      )}
                    </div>
                  )}
                </section>

                {/* Update rows section */}
                <section className="rounded-lg border border-amber-200 bg-amber-50/50">
                  <header className="flex items-center justify-between px-4 py-2 border-b border-amber-200 bg-amber-100/50">
                    <h3 className="text-sm font-semibold text-amber-800">
                      עדכונים ({importAnalysis.updateRows.filter((u) => Object.keys(u.updates).length > 0).length})
                    </h3>
                  </header>
                  {importAnalysis.updateRows.filter((u) => Object.keys(u.updates).length > 0).length === 0 ? (
                    <p className="p-4 text-xs text-muted-foreground">אין שינויים בלקוחות קיימים</p>
                  ) : (
                    <div className="max-h-56 overflow-y-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-right">לקוח קיים</TableHead>
                            <TableHead className="text-right">שדה</TableHead>
                            <TableHead className="text-right">ערך במערכת</TableHead>
                            <TableHead className="text-right">ערך חדש</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {importAnalysis.updateRows
                            .filter((u) => Object.keys(u.updates).length > 0)
                            .slice(0, 50)
                            .flatMap((u) =>
                              Object.entries(u.updates).map(([field, value]) => (
                                <TableRow key={u.existing.id + field}>
                                  <TableCell className="font-medium">{u.existing.name}</TableCell>
                                  <TableCell className="text-xs text-muted-foreground">
                                    {FIELD_LABELS[field as keyof ImportNewRow]}
                                  </TableCell>
                                  <TableCell className="text-xs" dir="ltr">
                                    {((u.existing as Record<string, unknown>)[field] as string) ?? '—'}
                                  </TableCell>
                                  <TableCell className="text-xs font-medium text-amber-900" dir="ltr">
                                    {String(value)}
                                  </TableCell>
                                </TableRow>
                              )),
                            )}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </section>

                {/* Skipped rows section */}
                {importAnalysis.skippedRows.length > 0 && (
                  <section className="rounded-lg border border-red-200 bg-red-50/50">
                    <header className="flex items-center justify-between px-4 py-2 border-b border-red-200 bg-red-100/50">
                      <h3 className="text-sm font-semibold text-red-800">
                        שגיאות ({importAnalysis.skippedRows.length})
                      </h3>
                    </header>
                    <div className="max-h-32 overflow-y-auto p-3 text-xs space-y-1">
                      {importAnalysis.skippedRows.slice(0, 40).map((s, i) => (
                        <div key={i} className="flex gap-2 text-red-800">
                          <span className="font-mono">שורה {s.rowIndex}:</span>
                          <span>{s.reason}</span>
                        </div>
                      ))}
                    </div>
                  </section>
                )}
              </div>
            )}
          </div>
          <DialogFooter className="flex gap-2 flex-row-reverse pt-2">
            <Button
              onClick={handleConfirmImport}
              disabled={
                !importAnalysis ||
                isImporting ||
                (importAnalysis.newRows.length === 0 &&
                  importAnalysis.updateRows.filter((u) => Object.keys(u.updates).length > 0).length === 0)
              }
              className="bg-purple-600 hover:bg-purple-700 text-white"
            >
              {isImporting
                ? 'מייבא...'
                : importAnalysis
                ? `אשר ייבוא של ${
                    importAnalysis.newRows.length +
                    importAnalysis.updateRows.filter((u) => Object.keys(u.updates).length > 0).length
                  } רשומות`
                : 'אשר ייבוא'}
            </Button>
            <Button variant="outline" onClick={closeImportDialog}>ביטול</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
