import { useState, useMemo, useRef, useEffect } from 'react'
import * as XLSX from 'xlsx'
import { Plus, Upload, Pencil, Trash2, FileText, Search, X } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTable, useInsert, useDelete } from '@/hooks/useSupabaseQuery'
import { supabase } from '@/lib/supabase'
import type { Transaction, HoursLog, Client } from '@/lib/types'
import type { ServiceType } from '@/lib/serviceTypes'
import TransactionDialog from '@/components/TransactionDialog'
import { buildTimeSheetPdf, uploadTimeSheetPdf, signedUrl } from '@/lib/pdf'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Card } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const HEBREW_MONTHS = [
  'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
]

const formatCurrency = (n: number | null | undefined) => {
  if (n == null) return '—'
  return new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS' }).format(n)
}

export default function Transactions() {
  const queryClient = useQueryClient()
  const { data: transactions = [], isLoading } = useTable<Transaction>('transactions', {
    orderBy: 'created_at',
    ascending: false,
  })

  const { data: serviceTypes = [] } = useQuery<ServiceType[]>({
    queryKey: ['service_types'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('service_types')
        .select('*')
        .order('display_order', { ascending: true })
      if (error) throw error
      return data as ServiceType[]
    },
  })

  const insert = useInsert<Transaction>('transactions')
  const remove = useDelete('transactions')

  const toggleBillable = useMutation({
    mutationFn: async ({ id, is_billable }: { id: string; is_billable: boolean }) => {
      const { error } = await supabase.from('transactions').update({ is_billable }).eq('id', id).select()
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['transactions'] }),
  })

  // Filters
  const [filterBillingMonth, setFilterBillingMonth] = useState<string>('all')
  const [filterClosingMonth, setFilterClosingMonth] = useState<string>('all')
  const [filterServiceType, setFilterServiceType] = useState<string>('all')
  const [filterServiceLead, setFilterServiceLead] = useState<string>('all')
  const [filterBillable, setFilterBillable] = useState<string>('all')
  const [filterClosingYear, setFilterClosingYear] = useState<string>('all')
  const [filterKind, setFilterKind] = useState<string>('all')
  // Free-text search (Batch 4.2 Phase B): single input matching any of
  // client name / service_lead / custom_fields.position_name /
  // custom_fields.candidate_name / custom_fields.position_number /
  // notes / invoice_number_transaction / invoice_number_receipt.
  const [searchInput, setSearchInput] = useState('')
  const [searchDebounced, setSearchDebounced] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(searchInput.trim().toLowerCase()), 200)
    return () => clearTimeout(t)
  }, [searchInput])

  const uniqueServiceLeads = useMemo(
    () => [...new Set(transactions.map((t) => t.service_lead).filter(Boolean))].sort(),
    [transactions],
  )
  const uniqueClosingYears = useMemo(
    () =>
      [...new Set(transactions.map((t) => t.closing_year).filter((y): y is number => y != null))].sort(
        (a, b) => b - a,
      ),
    [transactions],
  )

  const serviceNameById = useMemo(() => {
    const m = new Map<string, string>()
    for (const s of serviceTypes) m.set(s.id, s.name)
    return m
  }, [serviceTypes])

  const resolveServiceName = (t: Transaction) =>
    (t.service_type_id && serviceNameById.get(t.service_type_id)) || t.service_type || ''

  const searchMatches = (t: Transaction, q: string): boolean => {
    if (!q) return true
    const cf = (t.custom_fields ?? {}) as Record<string, unknown>
    const needles = [
      t.client_name,
      t.service_lead,
      t.position_name,
      t.candidate_name,
      cf.position_name,
      cf.candidate_name,
      cf.position_number,
      cf.deliverable_name,
      cf.invoice_contact,
      t.notes,
      t.invoice_number,
      t.invoice_number_transaction,
      t.invoice_number_receipt,
      resolveServiceName(t),
    ]
      .filter(Boolean)
      .map((s) => String(s).toLowerCase())
    return needles.some((s) => s.includes(q))
  }

  const filtered = useMemo(() => {
    return transactions.filter((t) => {
      if (!searchMatches(t, searchDebounced)) return false
      if (filterKind !== 'all' && (t.kind ?? 'service') !== filterKind) return false
      if (filterBillingMonth !== 'all' && t.billing_month !== Number(filterBillingMonth)) return false
      if (filterClosingMonth !== 'all' && t.closing_month !== Number(filterClosingMonth)) return false
      if (filterServiceType !== 'all' && resolveServiceName(t) !== filterServiceType) return false
      if (filterServiceLead !== 'all' && t.service_lead !== filterServiceLead) return false
      if (filterBillable === 'yes' && !t.is_billable) return false
      if (filterBillable === 'no' && t.is_billable) return false
      if (filterClosingYear !== 'all' && t.closing_year !== Number(filterClosingYear)) return false
      return true
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transactions, searchDebounced, filterKind, filterBillingMonth, filterClosingMonth, filterServiceType, filterServiceLead, filterBillable, filterClosingYear, serviceNameById])

  const [wizardOpen, setWizardOpen] = useState(false)
  const [editing, setEditing] = useState<Transaction | null>(null)

  const openAdd = () => { setEditing(null); setWizardOpen(true) }
  const openEdit = (t: Transaction) => { setEditing(t); setWizardOpen(true) }

  const handleDelete = async (id: string) => {
    if (confirm('האם למחוק עסקה זו?')) await remove.mutateAsync(id)
  }

  const handleGenerateTimeSheet = async (t: Transaction) => {
    try {
      // Fetch the hours_log rows billed to this transaction.
      const { data: hours, error: hErr } = await supabase
        .from('hours_log')
        .select('*')
        .eq('billed_transaction_id', t.id)
        .order('visit_date', { ascending: true })
      if (hErr) throw hErr
      // Fetch profile names.
      const { data: profiles } = await supabase.from('profiles').select('id, full_name')
      const profileNameById = new Map<string, string>()
      for (const p of (profiles as Array<{ id: string; full_name: string }> | null) ?? []) {
        profileNameById.set(p.id, p.full_name)
      }
      // Fetch client.
      const { data: client } = await supabase
        .from('clients')
        .select('*')
        .eq('name', t.client_name)
        .maybeSingle()

      const doc = buildTimeSheetPdf({
        transaction: t,
        client: (client as Client | null) ?? null,
        entries: (hours as HoursLog[] | null) ?? [],
        profileNameById,
      })
      const path = await uploadTimeSheetPdf(t.id, doc)
      await supabase.from('transactions').update({ time_sheet_pdf_path: path }).eq('id', t.id)
      queryClient.invalidateQueries({ queryKey: ['transactions'] })
      const url = await signedUrl('time-sheets', path, 120)
      if (url) window.open(url, '_blank', 'noopener')
    } catch (err) {
      console.error('time sheet PDF error:', err)
      alert('שגיאה בהפקת ה-PDF')
    }
  }

  // Excel import (kept from prior batch; minimal update: accepts old flat columns)
  const [importOpen, setImportOpen] = useState(false)
  const [importRows, setImportRows] = useState<Partial<Transaction>[]>([])
  const [importError, setImportError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImportError(null)
    const reader = new FileReader()
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target!.result as ArrayBuffer)
        const workbook = XLSX.read(data, { type: 'array' })
        const sheet = workbook.Sheets[workbook.SheetNames[0]]
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet)
        const mapped = rows.map((row) => ({
          client_name: String(row['client_name'] ?? row['לקוח'] ?? ''),
          position_name: String(row['position_name'] ?? row['משרה'] ?? ''),
          candidate_name: String(row['candidate_name'] ?? row['מועמד'] ?? ''),
          service_type: String(row['service_type'] ?? row['סוג שירות'] ?? ''),
          salary: Number(row['salary'] ?? row['שכר'] ?? 0),
          commission_percent: Number(row['commission_percent'] ?? row['עמלה %'] ?? 0),
          net_invoice_amount: Number(row['net_invoice_amount'] ?? row['סכום נטו'] ?? 0),
          commission_amount: Number(row['commission_amount'] ?? row['עמלת ספק'] ?? 0),
          service_lead: String(row['service_lead'] ?? row['ליד שירות'] ?? ''),
          entry_date: String(row['entry_date'] ?? row['תאריך כניסה'] ?? ''),
          billing_month: Number(row['billing_month'] ?? row['חודש כניסה'] ?? 1),
          billing_year: Number(row['billing_year'] ?? row['שנת כניסה'] ?? new Date().getFullYear()),
          close_date: row['close_date'] ? String(row['close_date']) : null,
          closing_month: row['closing_month'] ? Number(row['closing_month']) : null,
          closing_year: row['closing_year'] ? Number(row['closing_year']) : null,
          payment_date: row['payment_date'] ? String(row['payment_date']) : null,
          payment_status: String(row['payment_status'] ?? row['סטטוס תשלום'] ?? ''),
          is_billable: row['is_billable'] === true || row['is_billable'] === 'true' || row['חיוב'] === 'כן',
          invoice_number: row['invoice_number'] ? String(row['invoice_number']) : null,
          notes: row['notes'] ? String(row['notes']) : null,
        }))
        setImportRows(mapped)
      } catch {
        setImportError('שגיאה בקריאת הקובץ. אנא ודא שהקובץ תקין.')
      }
    }
    reader.readAsArrayBuffer(file)
  }

  const handleImportConfirm = async () => {
    for (const row of importRows) await insert.mutateAsync(row)
    setImportOpen(false)
    setImportRows([])
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  return (
    <div className="p-6 space-y-4" dir="rtl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-purple-900">עסקאות</h1>
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="border-purple-300 text-purple-700 hover:bg-purple-50"
            onClick={() => setImportOpen(true)}
          >
            <Upload className="w-4 h-4 ml-2" />
            ייבוא
          </Button>
          <Button
            className="bg-purple-600 hover:bg-purple-700 text-white"
            onClick={openAdd}
          >
            <Plus className="w-4 h-4 ml-2" />
            הוספת עסקה
          </Button>
        </div>
      </div>

      <Card className="p-4 space-y-3">
        <div className="space-y-1">
          <Label className="text-xs text-purple-700">חיפוש חופשי</Label>
          <div className="relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="חפש לפי לקוח, עובד, משרה, מועמד, מספר חשבונית..."
              className="border-purple-200 focus-visible:ring-purple-400 pr-9 pl-9"
              dir="rtl"
            />
            {searchInput && (
              <button
                type="button"
                onClick={() => setSearchInput('')}
                className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 rounded-full bg-muted/60 text-muted-foreground hover:text-foreground hover:bg-muted flex items-center justify-center"
                aria-label="נקה"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
          {searchDebounced && (
            <p className="text-[11px] text-muted-foreground">
              {filtered.length === 0
                ? 'לא נמצאו תוצאות'
                : `נמצאו ${filtered.length} מתוך ${transactions.length}`}
            </p>
          )}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
          <div className="space-y-1">
            <Label className="text-xs text-purple-700">סוג</Label>
            <Select value={filterKind} onValueChange={(v) => setFilterKind(v ?? 'all')}>
              <SelectTrigger className="border-purple-200 focus:ring-purple-400 text-sm"><SelectValue placeholder="הכל" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">הכל</SelectItem>
                <SelectItem value="service">שירות</SelectItem>
                <SelectItem value="time_period">שעות</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-purple-700">חודש כניסה</Label>
            <Select value={filterBillingMonth} onValueChange={(v) => setFilterBillingMonth(v ?? 'all')}>
              <SelectTrigger className="border-purple-200 focus:ring-purple-400 text-sm"><SelectValue placeholder="הכל" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">הכל</SelectItem>
                {HEBREW_MONTHS.map((name, i) => (<SelectItem key={i + 1} value={String(i + 1)}>{name}</SelectItem>))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-purple-700">חודש סגירה</Label>
            <Select value={filterClosingMonth} onValueChange={(v) => setFilterClosingMonth(v ?? 'all')}>
              <SelectTrigger className="border-purple-200 focus:ring-purple-400 text-sm"><SelectValue placeholder="הכל" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">הכל</SelectItem>
                {HEBREW_MONTHS.map((name, i) => (<SelectItem key={i + 1} value={String(i + 1)}>{name}</SelectItem>))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-purple-700">סוג שירות</Label>
            <Select value={filterServiceType} onValueChange={(v) => setFilterServiceType(v ?? 'all')}>
              <SelectTrigger className="border-purple-200 focus:ring-purple-400 text-sm"><SelectValue placeholder="הכל" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">הכל</SelectItem>
                {serviceTypes.map((st) => (<SelectItem key={st.id} value={st.name}>{st.name}</SelectItem>))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-purple-700">ליד שירות</Label>
            <Select value={filterServiceLead} onValueChange={(v) => setFilterServiceLead(v ?? 'all')}>
              <SelectTrigger className="border-purple-200 focus:ring-purple-400 text-sm"><SelectValue placeholder="הכל" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">הכל</SelectItem>
                {uniqueServiceLeads.map((sl) => (<SelectItem key={sl} value={sl}>{sl}</SelectItem>))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-purple-700">סטטוס חיוב</Label>
            <Select value={filterBillable} onValueChange={(v) => setFilterBillable(v ?? 'all')}>
              <SelectTrigger className="border-purple-200 focus:ring-purple-400 text-sm"><SelectValue placeholder="הכל" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">הכל</SelectItem>
                <SelectItem value="yes">כן</SelectItem>
                <SelectItem value="no">לא</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-purple-700">שנת סגירה</Label>
            <Select value={filterClosingYear} onValueChange={(v) => setFilterClosingYear(v ?? 'all')}>
              <SelectTrigger className="border-purple-200 focus:ring-purple-400 text-sm"><SelectValue placeholder="הכל" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">הכל</SelectItem>
                {uniqueClosingYears.map((y) => (<SelectItem key={y} value={String(y)}>{y}</SelectItem>))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </Card>

      <Card>
        {isLoading ? (
          <div className="p-8 text-center text-purple-400">טוען...</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-gray-400">לא נמצאו עסקאות</div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-purple-50">
                  <TableHead className="text-right text-purple-800 font-semibold">לקוח</TableHead>
                  <TableHead className="text-right text-purple-800 font-semibold">סוג</TableHead>
                  <TableHead className="text-right text-purple-800 font-semibold">סוג שירות</TableHead>
                  <TableHead className="text-right text-purple-800 font-semibold">משרה</TableHead>
                  <TableHead className="text-right text-purple-800 font-semibold">מועמד</TableHead>
                  <TableHead className="text-right text-purple-800 font-semibold">שכר</TableHead>
                  <TableHead className="text-right text-purple-800 font-semibold">עמלה %</TableHead>
                  <TableHead className="text-right text-purple-800 font-semibold">ליד שירות</TableHead>
                  <TableHead className="text-right text-purple-800 font-semibold">תאריך כניסה</TableHead>
                  <TableHead className="text-right text-purple-800 font-semibold">תאריך סגירה</TableHead>
                  <TableHead className="text-right text-purple-800 font-semibold">סכום נטו</TableHead>
                  <TableHead className="text-right text-purple-800 font-semibold">עמלת ספק</TableHead>
                  <TableHead className="text-right text-purple-800 font-semibold">חיוב</TableHead>
                  <TableHead className="text-right text-purple-800 font-semibold">חשבונית</TableHead>
                  <TableHead className="text-right text-purple-800 font-semibold">פעולות</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((t) => (
                  <TableRow key={t.id} className="hover:bg-purple-50/50 transition-colors">
                    <TableCell className="text-right font-medium">{t.client_name}</TableCell>
                    <TableCell className="text-right">
                      {t.kind === 'time_period' ? (
                        <Badge className="bg-amber-50 text-amber-700 border-amber-200">שעות</Badge>
                      ) : (
                        <Badge className="bg-purple-50 text-purple-700 border-purple-200">שירות</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {t.kind === 'time_period' ? '—' : resolveServiceName(t) || '—'}
                    </TableCell>
                    <TableCell className="text-right">{t.position_name}</TableCell>
                    <TableCell className="text-right">{t.candidate_name}</TableCell>
                    <TableCell className="text-right">{formatCurrency(t.salary)}</TableCell>
                    <TableCell className="text-right">{t.commission_percent}%</TableCell>
                    <TableCell className="text-right">{t.service_lead}</TableCell>
                    <TableCell className="text-right">{t.entry_date}</TableCell>
                    <TableCell className="text-right">{t.close_date ?? '—'}</TableCell>
                    <TableCell className="text-right">{formatCurrency(t.net_invoice_amount)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(t.commission_amount)}</TableCell>
                    <TableCell className="text-right">
                      <Switch
                        checked={t.is_billable}
                        onCheckedChange={(checked) =>
                          toggleBillable.mutate({ id: t.id, is_billable: checked })
                        }
                        className="data-[state=checked]:bg-purple-600"
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      {t.invoice_number ? (
                        <Badge className="bg-green-100 text-green-800 border-green-200">{t.invoice_number}</Badge>
                      ) : (
                        <span className="text-gray-300 text-sm">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex gap-1 justify-end">
                        {t.kind === 'time_period' && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-amber-600 hover:bg-amber-50"
                            onClick={() => handleGenerateTimeSheet(t)}
                            title="הפק דף שעות"
                          >
                            <FileText className="w-4 h-4" />
                          </Button>
                        )}
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-purple-600 hover:bg-purple-100" onClick={() => openEdit(t)}>
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500 hover:bg-red-50" onClick={() => handleDelete(t.id)}>
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

      {/* Dialog (single panel) */}
      <TransactionDialog
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        editing={editing}
      />

      {/* Import Dialog */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-w-lg" dir="rtl">
          <DialogHeader>
            <DialogTitle className="text-purple-900 text-right">ייבוא עסקאות מ-Excel</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-gray-600">
              בחר קובץ Excel (.xlsx / .xls) עם עמודות מתאימות לשדות העסקה.
            </p>
            <div className="space-y-1">
              <Label className="text-purple-700">קובץ Excel</Label>
              <Input ref={fileInputRef} type="file" accept=".xlsx,.xls" onChange={handleFileUpload} className="border-purple-200" />
            </div>
            {importError && <p className="text-sm text-red-600 bg-red-50 p-2 rounded">{importError}</p>}
            {importRows.length > 0 && (
              <div className="bg-purple-50 p-3 rounded border border-purple-200">
                <p className="text-sm text-purple-800 font-medium">נמצאו {importRows.length} שורות לייבוא</p>
              </div>
            )}
          </div>
          <DialogFooter className="flex gap-2 flex-row-reverse">
            <Button
              onClick={handleImportConfirm}
              disabled={importRows.length === 0 || insert.isPending}
              className="bg-purple-600 hover:bg-purple-700 text-white"
            >
              {insert.isPending ? 'מייבא...' : `ייבא ${importRows.length} שורות`}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setImportOpen(false); setImportRows([]); setImportError(null)
                if (fileInputRef.current) fileInputRef.current.value = ''
              }}
              className="border-purple-300 text-purple-700 hover:bg-purple-50"
            >
              ביטול
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
