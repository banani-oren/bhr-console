import { useState, useRef, useMemo } from 'react'
import * as XLSX from 'xlsx'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getClients, upsertClient, deleteClient, type ClientFormData } from '@/lib/clients'
import type { ClientWithAgreement } from '@/lib/types'
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

function clientToFormData(c: ClientWithAgreement): ClientFormData {
  const ag = c.agreements?.[0]
  return {
    name: c.name,
    tax_id: c.tax_id ?? '',
    group_name: c.group_name ?? '',
    address: c.address ?? '',
    phone: c.phone ?? '',
    email: c.email ?? '',
    contact_name: c.contact_name ?? '',
    status: c.status ?? 'פעיל',
    notes: c.notes ?? '',
    agreement_type: ag?.agreement_type ?? '',
    commission_pct: ag?.commission_pct ?? null,
    salary_base: ag?.salary_base ?? null,
    payment_split: ag?.payment_split ?? '',
    warranty_days: ag?.warranty_days ?? null,
    payment_terms: ag?.payment_terms ?? '',
    advance: ag?.advance ?? '',
    exclusivity: ag?.exclusivity ?? false,
    agreement_contact_name: ag?.contact_name ?? '',
    agreement_contact_email: ag?.contact_email ?? '',
    agreement_contact_phone: ag?.contact_phone ?? '',
    contract_file: ag?.contract_file ?? '',
    agreement_status: ag?.status ?? 'active',
    agreement_notes: ag?.notes ?? '',
  }
}

const emptyForm: ClientFormData = {
  name: '',
  status: 'פעיל',
}

function statusLabel(s: string) {
  if (s === 'פעיל' || s === 'active') return 'פעיל'
  return 'לא פעיל'
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

  const { data: clients = [], isLoading } = useQuery<ClientWithAgreement[]>({
    queryKey: ['clients', search, filterStatus, filterGroup],
    queryFn: () =>
      getClients({
        search: search || undefined,
        status: filterStatus !== 'all' ? filterStatus : undefined,
        group: filterGroup !== 'all' ? filterGroup : undefined,
      }),
  })

  // Derive unique groups for filter dropdown
  const groups = useMemo(
    () => [...new Set(clients.map((c) => c.group_name).filter(Boolean))].sort() as string[],
    [clients],
  )

  // ---- Card dialog state ----
  const [cardOpen, setCardOpen] = useState(false)
  const [editingClient, setEditingClient] = useState<ClientWithAgreement | null>(null)
  const [form, setForm] = useState<ClientFormData>(emptyForm)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle')

  // ---- Delete dialog state ----
  const [deleteTarget, setDeleteTarget] = useState<ClientWithAgreement | null>(null)

  // ---- Import dialog state ----
  const [importOpen, setImportOpen] = useState(false)
  const [importRows, setImportRows] = useState<ClientFormData[]>([])
  const [importFileName, setImportFileName] = useState('')
  const [isImporting, setIsImporting] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ---- Form helpers ----
  function setField<K extends keyof ClientFormData>(key: K, value: ClientFormData[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function openCreate() {
    setEditingClient(null)
    setForm(emptyForm)
    setSaveStatus('idle')
    setCardOpen(true)
  }

  function openEdit(client: ClientWithAgreement) {
    setEditingClient(client)
    setForm(clientToFormData(client))
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
      await upsertClient(form, editingClient?.id)
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
      await deleteClient(deleteTarget.id)
      queryClient.invalidateQueries({ queryKey: ['clients'] })
      setDeleteTarget(null)
    } catch (err) {
      console.error('Delete error:', err)
    }
  }

  // ---- Import ----
  function parseFile(file: File) {
    const reader = new FileReader()
    reader.onload = (e) => {
      const data = new Uint8Array(e.target?.result as ArrayBuffer)
      const workbook = XLSX.read(data, { type: 'array' })

      // Try to find the two Hebrew sheets, or fallback to first sheet
      const clientSheet = workbook.Sheets['פרטי לקוחות'] ?? workbook.Sheets[workbook.SheetNames[0]]
      const agreementSheet = workbook.Sheets['תנאי הסכמים']

      const clientRows: Record<string, string>[] = XLSX.utils.sheet_to_json(clientSheet, { defval: '' })

      let agreementRows: Record<string, string>[] = []
      if (agreementSheet) {
        agreementRows = XLSX.utils.sheet_to_json(agreementSheet, { defval: '' })
      }

      // Build a map of agreement data by client name
      const agByName = new Map<string, Record<string, string>>()
      for (const row of agreementRows) {
        const name = String(row['שם הלקוח'] ?? row['name'] ?? '').trim()
        if (name) agByName.set(name, row)
      }

      const rows: ClientFormData[] = clientRows
        .map((row) => {
          const name = String(row['שם העסק'] ?? row['name'] ?? row['שם'] ?? '').trim()
          const ag = agByName.get(name)
          return {
            name,
            contact_name: String(row['שם איש הקשר'] ?? row['contact_name'] ?? ''),
            email: String(row['דואל'] ?? row['email'] ?? row['אימייל'] ?? ''),
            phone: String(row['נייד'] ?? row['phone'] ?? row['טלפון'] ?? ''),
            tax_id: String(row['מספר עסק'] ?? row['tax_id'] ?? row['ח.פ'] ?? ''),
            address: String(row['כתובת'] ?? row['address'] ?? ''),
            status: String(row['סטטוס'] ?? ag?.['סטטוס'] ?? 'פעיל'),
            agreement_type: ag ? String(ag['סוג הסכם'] ?? '') : '',
            commission_pct: ag?.['אחוז עמלה'] ? Number(ag['אחוז עמלה']) : null,
            salary_base: ag?.['בסיס משכורות'] ? Number(ag['בסיס משכורות']) : null,
            payment_split: ag ? String(ag['חלוקת תשלום'] ?? '') : '',
            warranty_days: ag?.['תקופת אחריות'] ? Number(ag['תקופת אחריות']) : null,
            payment_terms: ag ? String(ag['תנאי תשלום'] ?? '') : '',
            advance: ag ? String(ag['מקדמה'] ?? '') : '',
            exclusivity: ag?.['בלעדיות'] === 'כן',
            agreement_contact_name: ag ? String(ag['איש/אשת קשר'] ?? '') : '',
            agreement_contact_email: ag ? String(ag['מייל'] ?? '') : '',
            agreement_contact_phone: ag ? String(ag['טלפון'] ?? '') : '',
            contract_file: ag ? String(ag['שם קובץ הסכם'] ?? '') : '',
          } as ClientFormData
        })
        .filter((r) => r.name)

      setImportRows(rows)
      setImportFileName(file.name)
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
    setIsImporting(true)
    try {
      for (const row of importRows) {
        await upsertClient(row)
      }
      queryClient.invalidateQueries({ queryKey: ['clients'] })
      setImportOpen(false)
      setImportRows([])
      setImportFileName('')
    } catch (err) {
      console.error('Import error:', err)
    } finally {
      setIsImporting(false)
    }
  }

  function closeImportDialog() {
    setImportOpen(false)
    setImportRows([])
    setImportFileName('')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // ---- Render ----
  return (
    <div dir="rtl" className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">לקוחות</h1>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => setImportOpen(true)}
            className="flex items-center gap-2"
          >
            <Upload className="h-4 w-4" />
            ייבוא מאקסל
          </Button>
          <Button
            onClick={openCreate}
            className="flex items-center gap-2 bg-purple-600 hover:bg-purple-700 text-white"
          >
            <Plus className="h-4 w-4" />
            לקוח חדש
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap items-end">
        <div className="relative max-w-xs flex-1">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="חיפוש לפי שם..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pr-9"
          />
        </div>
        <Select value={filterStatus} onValueChange={(v) => setFilterStatus(v ?? 'all')}>
          <SelectTrigger className="w-32">
            <SelectValue placeholder="סטטוס" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">הכל</SelectItem>
            <SelectItem value="פעיל">פעיל</SelectItem>
            <SelectItem value="לא פעיל">לא פעיל</SelectItem>
          </SelectContent>
        </Select>
        {groups.length > 0 && (
          <Select value={filterGroup} onValueChange={(v) => setFilterGroup(v ?? 'all')}>
            <SelectTrigger className="w-36">
              <SelectValue placeholder="קבוצה" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">כל הקבוצות</SelectItem>
              {groups.map((g) => (
                <SelectItem key={g} value={g}>{g}</SelectItem>
              ))}
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
                <TableHead className="text-right">קבוצה</TableHead>
                <TableHead className="text-right">ח.פ</TableHead>
                <TableHead className="text-right">סוג הסכם</TableHead>
                <TableHead className="text-right">איש קשר</TableHead>
                <TableHead className="text-right">סטטוס</TableHead>
                <TableHead className="text-right">פעולות</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {clients.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    לא נמצאו לקוחות
                  </TableCell>
                </TableRow>
              ) : (
                clients.map((client) => {
                  const ag = client.agreements?.[0]
                  return (
                    <TableRow
                      key={client.id}
                      className="cursor-pointer hover:bg-purple-50/50"
                      onClick={() => openEdit(client)}
                    >
                      <TableCell className="font-medium">{client.name}</TableCell>
                      <TableCell>{client.group_name ?? '—'}</TableCell>
                      <TableCell className="font-mono text-sm">{client.tax_id ?? '—'}</TableCell>
                      <TableCell>{ag?.agreement_type ?? '—'}</TableCell>
                      <TableCell>{client.contact_name ?? '—'}</TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(client.status)}>
                          {statusLabel(client.status)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                          <Button size="icon" variant="ghost" onClick={() => openEdit(client)} title="עריכה">
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => setDeleteTarget(client)}
                            title="מחיקה"
                            className="text-destructive hover:text-destructive"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })
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
            <DialogTitle>
              {editingClient ? `עריכת ${editingClient.name}` : 'לקוח חדש'}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-6 py-2">
            {/* Section 1 — Company details */}
            <div>
              <h3 className="text-sm font-semibold text-purple-700 mb-3">פרטי החברה</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>שם לקוח *</Label>
                  <Input value={form.name} onChange={(e) => setField('name', e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>ח.פ</Label>
                  <Input value={form.tax_id ?? ''} onChange={(e) => setField('tax_id', e.target.value)} dir="ltr" />
                </div>
                <div className="space-y-1.5">
                  <Label>קבוצה</Label>
                  <Input
                    value={form.group_name ?? ''}
                    onChange={(e) => setField('group_name', e.target.value)}
                    list="group-suggestions"
                  />
                  <datalist id="group-suggestions">
                    {groups.map((g) => <option key={g} value={g} />)}
                  </datalist>
                </div>
                <div className="space-y-1.5">
                  <Label>כתובת</Label>
                  <Input value={form.address ?? ''} onChange={(e) => setField('address', e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>טלפון</Label>
                  <Input value={form.phone ?? ''} onChange={(e) => setField('phone', e.target.value)} dir="ltr" />
                </div>
                <div className="space-y-1.5">
                  <Label>מייל</Label>
                  <Input type="email" value={form.email ?? ''} onChange={(e) => setField('email', e.target.value)} dir="ltr" />
                </div>
                <div className="space-y-1.5">
                  <Label>איש/אשת קשר</Label>
                  <Input value={form.contact_name ?? ''} onChange={(e) => setField('contact_name', e.target.value)} />
                </div>
                <div className="space-y-1.5 flex flex-col">
                  <Label>סטטוס</Label>
                  <Select value={form.status} onValueChange={(v) => setField('status', v ?? 'פעיל')}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="פעיל">פעיל</SelectItem>
                      <SelectItem value="לא פעיל">לא פעיל</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5 mt-4">
                <Label>הערות</Label>
                <Textarea value={form.notes ?? ''} onChange={(e) => setField('notes', e.target.value)} rows={2} />
              </div>
            </div>

            <Separator />

            {/* Section 2 — Agreement terms */}
            <div>
              <h3 className="text-sm font-semibold text-purple-700 mb-3">תנאי הסכם</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>סוג הסכם</Label>
                  <Select value={form.agreement_type ?? ''} onValueChange={(v) => setField('agreement_type', v ?? '')}>
                    <SelectTrigger><SelectValue placeholder="בחר סוג" /></SelectTrigger>
                    <SelectContent>
                      {AGREEMENT_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>אחוז עמלה (%)</Label>
                  <Input
                    type="number"
                    dir="ltr"
                    value={form.commission_pct ?? ''}
                    onChange={(e) => setField('commission_pct', e.target.value ? Number(e.target.value) : null)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>בסיס משכורות</Label>
                  <Input
                    type="number"
                    dir="ltr"
                    step="0.5"
                    value={form.salary_base ?? ''}
                    onChange={(e) => setField('salary_base', e.target.value ? Number(e.target.value) : null)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>חלוקת תשלום</Label>
                  <Input value={form.payment_split ?? ''} onChange={(e) => setField('payment_split', e.target.value)} dir="ltr" placeholder="30/70" />
                </div>
                <div className="space-y-1.5">
                  <Label>תקופת אחריות (ימים)</Label>
                  <Input
                    type="number"
                    dir="ltr"
                    value={form.warranty_days ?? ''}
                    onChange={(e) => setField('warranty_days', e.target.value ? Number(e.target.value) : null)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>תנאי תשלום</Label>
                  <Input value={form.payment_terms ?? ''} onChange={(e) => setField('payment_terms', e.target.value)} placeholder="שוטף + 30" />
                </div>
                <div className="space-y-1.5">
                  <Label>מקדמה</Label>
                  <Input value={form.advance ?? ''} onChange={(e) => setField('advance', e.target.value)} />
                </div>
                <div className="space-y-1.5 flex items-center gap-3 pt-6">
                  <Switch
                    checked={form.exclusivity ?? false}
                    onCheckedChange={(v) => setField('exclusivity', v)}
                  />
                  <Label>בלעדיות</Label>
                </div>
                <div className="space-y-1.5">
                  <Label>איש/אשת קשר להסכם</Label>
                  <Input value={form.agreement_contact_name ?? ''} onChange={(e) => setField('agreement_contact_name', e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>מייל איש קשר</Label>
                  <Input type="email" dir="ltr" value={form.agreement_contact_email ?? ''} onChange={(e) => setField('agreement_contact_email', e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>טלפון איש קשר</Label>
                  <Input dir="ltr" value={form.agreement_contact_phone ?? ''} onChange={(e) => setField('agreement_contact_phone', e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>שם קובץ הסכם</Label>
                  <Input value={form.contract_file ?? ''} onChange={(e) => setField('contract_file', e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>סטטוס הסכם</Label>
                  <Select value={form.agreement_status ?? 'active'} onValueChange={(v) => setField('agreement_status', v ?? 'active')}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">פעיל</SelectItem>
                      <SelectItem value="inactive">לא פעיל</SelectItem>
                      <SelectItem value="pending">ממתין</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5 mt-4">
                <Label>הערות הסכם</Label>
                <Textarea value={form.agreement_notes ?? ''} onChange={(e) => setField('agreement_notes', e.target.value)} rows={2} />
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
              <Button
                onClick={handleSave}
                disabled={saveStatus === 'saving' || saveStatus === 'success' || !form.name.trim()}
                className="bg-purple-600 hover:bg-purple-700 text-white"
              >
                {saveStatus === 'saving' ? 'שומר...' : 'שמור'}
              </Button>
              <Button variant="outline" onClick={closeCard} disabled={saveStatus === 'saving'}>
                ביטול
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}>
        <DialogContent dir="rtl" className="max-w-sm">
          <DialogHeader>
            <DialogTitle>מחיקת לקוח</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            האם אתה בטוח שברצונך למחוק את הלקוח{' '}
            <span className="font-semibold text-foreground">{deleteTarget?.name}</span>?
            ההסכם המשויך יימחק גם כן. פעולה זו אינה ניתנת לביטול.
          </p>
          <DialogFooter className="flex gap-2 flex-row-reverse">
            <Button variant="destructive" onClick={handleDelete}>מחק</Button>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>ביטול</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import Dialog */}
      <Dialog open={importOpen} onOpenChange={(open) => { if (!open) closeImportDialog() }}>
        <DialogContent dir="rtl" className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>ייבוא לקוחות מאקסל</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div
              onDrop={handleDrop}
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
              onDragLeave={() => setIsDragging(false)}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
                isDragging
                  ? 'border-purple-500 bg-purple-50'
                  : 'border-muted-foreground/30 hover:border-purple-400 hover:bg-muted/40'
              }`}
            >
              <Upload className="h-8 w-8 mx-auto mb-3 text-muted-foreground" />
              {importFileName ? (
                <p className="text-sm font-medium">{importFileName}</p>
              ) : (
                <>
                  <p className="text-sm font-medium">גרור קובץ לכאן או לחץ לבחירה</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    קבצי Excel (.xlsx) — תומך בגיליונות "פרטי לקוחות" ו"תנאי הסכמים"
                  </p>
                </>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={handleFileInput}
              />
            </div>

            {importRows.length > 0 && (
              <>
                <div className="max-h-64 overflow-y-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-right">שם</TableHead>
                        <TableHead className="text-right">ח.פ</TableHead>
                        <TableHead className="text-right">סוג הסכם</TableHead>
                        <TableHead className="text-right">איש קשר</TableHead>
                        <TableHead className="text-right">סטטוס</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {importRows.map((row, i) => (
                        <TableRow key={i}>
                          <TableCell>{row.name}</TableCell>
                          <TableCell className="font-mono text-sm">{row.tax_id || '—'}</TableCell>
                          <TableCell>{row.agreement_type || '—'}</TableCell>
                          <TableCell>{row.contact_name || '—'}</TableCell>
                          <TableCell>{row.status || 'פעיל'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                <p className="text-sm text-muted-foreground">
                  נמצאו <span className="font-semibold text-foreground">{importRows.length}</span> רשומות לייבוא
                </p>
              </>
            )}
          </div>

          <DialogFooter className="flex gap-2 flex-row-reverse">
            <Button
              onClick={handleConfirmImport}
              disabled={importRows.length === 0 || isImporting}
              className="bg-purple-600 hover:bg-purple-700 text-white"
            >
              {isImporting ? 'מייבא...' : `אשר ייבוא (${importRows.length})`}
            </Button>
            <Button variant="outline" onClick={closeImportDialog}>ביטול</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
