import { useState, useMemo, useRef } from 'react'
import * as XLSX from 'xlsx'
import { Plus, Upload, Pencil, Trash2 } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTable, useInsert, useUpdate, useDelete } from '@/hooks/useSupabaseQuery'
import { supabase } from '@/lib/supabase'
import type { Transaction } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Card } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
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

const EMPTY_FORM: Partial<Transaction> = {
  client_name: '',
  position_name: '',
  candidate_name: '',
  service_type: '',
  salary: 0,
  commission_percent: 0,
  net_invoice_amount: 0,
  commission_amount: 0,
  service_lead: '',
  entry_date: '',
  billing_month: 1,
  billing_year: new Date().getFullYear(),
  close_date: null,
  closing_month: null,
  closing_year: null,
  payment_date: null,
  payment_status: '',
  is_billable: false,
  invoice_number: null,
  notes: null,
}

export default function Transactions() {
  const queryClient = useQueryClient()
  const { data: transactions = [], isLoading } = useTable<Transaction>('transactions', {
    orderBy: 'created_at',
    ascending: false,
  })

  const insert = useInsert<Transaction>('transactions')
  const update = useUpdate<Transaction>('transactions')
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

  // Unique filter options derived from data
  const uniqueServiceTypes = useMemo(
    () => [...new Set(transactions.map((t) => t.service_type).filter(Boolean))].sort(),
    [transactions]
  )
  const uniqueServiceLeads = useMemo(
    () => [...new Set(transactions.map((t) => t.service_lead).filter(Boolean))].sort(),
    [transactions]
  )
  const uniqueClosingYears = useMemo(
    () =>
      [...new Set(transactions.map((t) => t.closing_year).filter((y): y is number => y != null))].sort(
        (a, b) => b - a
      ),
    [transactions]
  )

  const filtered = useMemo(() => {
    return transactions.filter((t) => {
      if (filterBillingMonth !== 'all' && t.billing_month !== Number(filterBillingMonth)) return false
      if (filterClosingMonth !== 'all' && t.closing_month !== Number(filterClosingMonth)) return false
      if (filterServiceType !== 'all' && t.service_type !== filterServiceType) return false
      if (filterServiceLead !== 'all' && t.service_lead !== filterServiceLead) return false
      if (filterBillable === 'yes' && !t.is_billable) return false
      if (filterBillable === 'no' && t.is_billable) return false
      if (filterClosingYear !== 'all' && t.closing_year !== Number(filterClosingYear)) return false
      return true
    })
  }, [transactions, filterBillingMonth, filterClosingMonth, filterServiceType, filterServiceLead, filterBillable, filterClosingYear])

  // Add/Edit dialog
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null)
  const [form, setForm] = useState<Partial<Transaction>>(EMPTY_FORM)

  const openAdd = () => {
    setEditingTransaction(null)
    setForm(EMPTY_FORM)
    setDialogOpen(true)
  }

  const openEdit = (t: Transaction) => {
    setEditingTransaction(t)
    setForm({ ...t })
    setDialogOpen(true)
  }

  const handleFormChange = (field: keyof Transaction, value: unknown) => {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle')

  const handleSave = async () => {
    setSaveStatus('saving')
    try {
      if (editingTransaction) {
        await update.mutateAsync({ id: editingTransaction.id, ...form } as Partial<Transaction> & { id: string })
      } else {
        await insert.mutateAsync(form)
      }
      setSaveStatus('success')
      setTimeout(() => {
        setSaveStatus('idle')
        setDialogOpen(false)
      }, 2000)
    } catch (err) {
      console.error('Save error:', err)
      setSaveStatus('error')
    }
  }

  const handleDelete = async (id: string) => {
    if (confirm('האם למחוק עסקה זו?')) {
      await remove.mutateAsync(id)
    }
  }

  // Import dialog
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
    for (const row of importRows) {
      await insert.mutateAsync(row)
    }
    setImportOpen(false)
    setImportRows([])
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  return (
    <div className="p-6 space-y-4" dir="rtl">
      {/* Header */}
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
            הוסף עסקה
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card className="p-4">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {/* חודש כניסה */}
          <div className="space-y-1">
            <Label className="text-xs text-purple-700">חודש כניסה</Label>
            <Select value={filterBillingMonth} onValueChange={(v) => setFilterBillingMonth(v ?? 'all')}>
              <SelectTrigger className="border-purple-200 focus:ring-purple-400 text-sm">
                <SelectValue placeholder="הכל" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">הכל</SelectItem>
                {HEBREW_MONTHS.map((name, i) => (
                  <SelectItem key={i + 1} value={String(i + 1)}>{name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* חודש סגירה */}
          <div className="space-y-1">
            <Label className="text-xs text-purple-700">חודש סגירה</Label>
            <Select value={filterClosingMonth} onValueChange={(v) => setFilterClosingMonth(v ?? 'all')}>
              <SelectTrigger className="border-purple-200 focus:ring-purple-400 text-sm">
                <SelectValue placeholder="הכל" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">הכל</SelectItem>
                {HEBREW_MONTHS.map((name, i) => (
                  <SelectItem key={i + 1} value={String(i + 1)}>{name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* סוג שירות */}
          <div className="space-y-1">
            <Label className="text-xs text-purple-700">סוג שירות</Label>
            <Select value={filterServiceType} onValueChange={(v) => setFilterServiceType(v ?? 'all')}>
              <SelectTrigger className="border-purple-200 focus:ring-purple-400 text-sm">
                <SelectValue placeholder="הכל" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">הכל</SelectItem>
                {uniqueServiceTypes.map((st) => (
                  <SelectItem key={st} value={st}>{st}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* ליד שירות */}
          <div className="space-y-1">
            <Label className="text-xs text-purple-700">ליד שירות</Label>
            <Select value={filterServiceLead} onValueChange={(v) => setFilterServiceLead(v ?? 'all')}>
              <SelectTrigger className="border-purple-200 focus:ring-purple-400 text-sm">
                <SelectValue placeholder="הכל" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">הכל</SelectItem>
                {uniqueServiceLeads.map((sl) => (
                  <SelectItem key={sl} value={sl}>{sl}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* סטטוס חיוב */}
          <div className="space-y-1">
            <Label className="text-xs text-purple-700">סטטוס חיוב</Label>
            <Select value={filterBillable} onValueChange={(v) => setFilterBillable(v ?? 'all')}>
              <SelectTrigger className="border-purple-200 focus:ring-purple-400 text-sm">
                <SelectValue placeholder="הכל" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">הכל</SelectItem>
                <SelectItem value="yes">כן</SelectItem>
                <SelectItem value="no">לא</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* שנת סגירה */}
          <div className="space-y-1">
            <Label className="text-xs text-purple-700">שנת סגירה</Label>
            <Select value={filterClosingYear} onValueChange={(v) => setFilterClosingYear(v ?? 'all')}>
              <SelectTrigger className="border-purple-200 focus:ring-purple-400 text-sm">
                <SelectValue placeholder="הכל" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">הכל</SelectItem>
                {uniqueClosingYears.map((y) => (
                  <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </Card>

      {/* Table */}
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
                        <Badge className="bg-green-100 text-green-800 border-green-200">
                          {t.invoice_number}
                        </Badge>
                      ) : (
                        <span className="text-gray-300 text-sm">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex gap-1 justify-end">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-purple-600 hover:bg-purple-100"
                          onClick={() => openEdit(t)}
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-red-500 hover:bg-red-50"
                          onClick={() => handleDelete(t.id)}
                        >
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

      {/* Add / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle className="text-purple-900 text-right">
              {editingTransaction ? 'עריכת עסקה' : 'הוספת עסקה'}
            </DialogTitle>
          </DialogHeader>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-2">
            {/* לקוח */}
            <div className="space-y-1">
              <Label className="text-purple-700">לקוח</Label>
              <Input
                value={form.client_name ?? ''}
                onChange={(e) => handleFormChange('client_name', e.target.value)}
                className="border-purple-200 focus-visible:ring-purple-400"
              />
            </div>

            {/* משרה */}
            <div className="space-y-1">
              <Label className="text-purple-700">משרה</Label>
              <Input
                value={form.position_name ?? ''}
                onChange={(e) => handleFormChange('position_name', e.target.value)}
                className="border-purple-200 focus-visible:ring-purple-400"
              />
            </div>

            {/* מועמד */}
            <div className="space-y-1">
              <Label className="text-purple-700">מועמד</Label>
              <Input
                value={form.candidate_name ?? ''}
                onChange={(e) => handleFormChange('candidate_name', e.target.value)}
                className="border-purple-200 focus-visible:ring-purple-400"
              />
            </div>

            {/* סוג שירות */}
            <div className="space-y-1">
              <Label className="text-purple-700">סוג שירות</Label>
              <Input
                value={form.service_type ?? ''}
                onChange={(e) => handleFormChange('service_type', e.target.value)}
                className="border-purple-200 focus-visible:ring-purple-400"
              />
            </div>

            {/* שכר */}
            <div className="space-y-1">
              <Label className="text-purple-700">שכר</Label>
              <Input
                type="number"
                value={form.salary ?? 0}
                onChange={(e) => handleFormChange('salary', Number(e.target.value))}
                className="border-purple-200 focus-visible:ring-purple-400"
              />
            </div>

            {/* עמלה % */}
            <div className="space-y-1">
              <Label className="text-purple-700">עמלה %</Label>
              <Input
                type="number"
                value={form.commission_percent ?? 0}
                onChange={(e) => handleFormChange('commission_percent', Number(e.target.value))}
                className="border-purple-200 focus-visible:ring-purple-400"
              />
            </div>

            {/* סכום נטו */}
            <div className="space-y-1">
              <Label className="text-purple-700">סכום נטו</Label>
              <Input
                type="number"
                value={form.net_invoice_amount ?? 0}
                onChange={(e) => handleFormChange('net_invoice_amount', Number(e.target.value))}
                className="border-purple-200 focus-visible:ring-purple-400"
              />
            </div>

            {/* עמלת ספק */}
            <div className="space-y-1">
              <Label className="text-purple-700">עמלת ספק</Label>
              <Input
                type="number"
                value={form.commission_amount ?? 0}
                onChange={(e) => handleFormChange('commission_amount', Number(e.target.value))}
                className="border-purple-200 focus-visible:ring-purple-400"
              />
            </div>

            {/* ליד שירות */}
            <div className="space-y-1">
              <Label className="text-purple-700">ליד שירות</Label>
              <Input
                value={form.service_lead ?? ''}
                onChange={(e) => handleFormChange('service_lead', e.target.value)}
                className="border-purple-200 focus-visible:ring-purple-400"
              />
            </div>

            {/* תאריך כניסה */}
            <div className="space-y-1">
              <Label className="text-purple-700">תאריך כניסה</Label>
              <Input
                type="date"
                value={form.entry_date ?? ''}
                onChange={(e) => handleFormChange('entry_date', e.target.value)}
                className="border-purple-200 focus-visible:ring-purple-400"
              />
            </div>

            {/* חודש כניסה */}
            <div className="space-y-1">
              <Label className="text-purple-700">חודש כניסה</Label>
              <Select
                value={String(form.billing_month ?? 1)}
                onValueChange={(v) => handleFormChange('billing_month', Number(v))}
              >
                <SelectTrigger className="border-purple-200 focus:ring-purple-400">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {HEBREW_MONTHS.map((name, i) => (
                    <SelectItem key={i + 1} value={String(i + 1)}>{name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* שנת כניסה */}
            <div className="space-y-1">
              <Label className="text-purple-700">שנת כניסה</Label>
              <Input
                type="number"
                value={form.billing_year ?? new Date().getFullYear()}
                onChange={(e) => handleFormChange('billing_year', Number(e.target.value))}
                className="border-purple-200 focus-visible:ring-purple-400"
              />
            </div>

            {/* תאריך סגירה */}
            <div className="space-y-1">
              <Label className="text-purple-700">תאריך סגירה</Label>
              <Input
                type="date"
                value={form.close_date ?? ''}
                onChange={(e) => handleFormChange('close_date', e.target.value || null)}
                className="border-purple-200 focus-visible:ring-purple-400"
              />
            </div>

            {/* חודש סגירה */}
            <div className="space-y-1">
              <Label className="text-purple-700">חודש סגירה</Label>
              <Select
                value={form.closing_month != null ? String(form.closing_month) : 'none'}
                onValueChange={(v) => handleFormChange('closing_month', v === 'none' ? null : Number(v))}
              >
                <SelectTrigger className="border-purple-200 focus:ring-purple-400">
                  <SelectValue placeholder="לא נבחר" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">לא נבחר</SelectItem>
                  {HEBREW_MONTHS.map((name, i) => (
                    <SelectItem key={i + 1} value={String(i + 1)}>{name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* שנת סגירה */}
            <div className="space-y-1">
              <Label className="text-purple-700">שנת סגירה</Label>
              <Input
                type="number"
                value={form.closing_year ?? ''}
                onChange={(e) =>
                  handleFormChange('closing_year', e.target.value ? Number(e.target.value) : null)
                }
                className="border-purple-200 focus-visible:ring-purple-400"
                placeholder="לא נבחר"
              />
            </div>

            {/* תאריך תשלום */}
            <div className="space-y-1">
              <Label className="text-purple-700">תאריך תשלום</Label>
              <Input
                type="date"
                value={form.payment_date ?? ''}
                onChange={(e) => handleFormChange('payment_date', e.target.value || null)}
                className="border-purple-200 focus-visible:ring-purple-400"
              />
            </div>

            {/* סטטוס תשלום */}
            <div className="space-y-1">
              <Label className="text-purple-700">סטטוס תשלום</Label>
              <Input
                value={form.payment_status ?? ''}
                onChange={(e) => handleFormChange('payment_status', e.target.value)}
                className="border-purple-200 focus-visible:ring-purple-400"
              />
            </div>

            {/* מספר חשבונית */}
            <div className="space-y-1">
              <Label className="text-purple-700">מספר חשבונית</Label>
              <Input
                value={form.invoice_number ?? ''}
                onChange={(e) => handleFormChange('invoice_number', e.target.value || null)}
                className="border-purple-200 focus-visible:ring-purple-400"
              />
            </div>

            {/* חיוב */}
            <div className="space-y-1 flex flex-col justify-center">
              <Label className="text-purple-700">חיוב</Label>
              <div className="flex items-center gap-2">
                <Switch
                  checked={form.is_billable ?? false}
                  onCheckedChange={(checked) => handleFormChange('is_billable', checked)}
                  className="data-[state=checked]:bg-purple-600"
                />
                <span className="text-sm text-gray-600">{form.is_billable ? 'כן' : 'לא'}</span>
              </div>
            </div>

            {/* הערות - full width */}
            <div className="space-y-1 md:col-span-2">
              <Label className="text-purple-700">הערות</Label>
              <Textarea
                value={form.notes ?? ''}
                onChange={(e) => handleFormChange('notes', e.target.value || null)}
                className="border-purple-200 focus-visible:ring-purple-400 resize-none"
                rows={3}
              />
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
                disabled={saveStatus === 'saving' || saveStatus === 'success'}
                className="bg-purple-600 hover:bg-purple-700 text-white"
              >
                {saveStatus === 'saving' ? 'שומר...' : 'שמור'}
              </Button>
              <Button
                variant="outline"
                onClick={() => setDialogOpen(false)}
                disabled={saveStatus === 'saving'}
                className="border-purple-300 text-purple-700 hover:bg-purple-50"
              >
                ביטול
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import Dialog */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-w-lg" dir="rtl">
          <DialogHeader>
            <DialogTitle className="text-purple-900 text-right">ייבוא עסקאות מ-Excel</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <p className="text-sm text-gray-600">
              בחר קובץ Excel (.xlsx / .xls) עם עמודות מתאימות לשדות העסקה.
              עמודות מקובלות: client_name, position_name, candidate_name, service_type, salary,
              commission_percent, net_invoice_amount, commission_amount, service_lead, entry_date,
              billing_month, billing_year, close_date, closing_month, closing_year, payment_date,
              payment_status, is_billable, invoice_number, notes.
            </p>

            <div className="space-y-1">
              <Label className="text-purple-700">קובץ Excel</Label>
              <Input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls"
                onChange={handleFileUpload}
                className="border-purple-200"
              />
            </div>

            {importError && (
              <p className="text-sm text-red-600 bg-red-50 p-2 rounded">{importError}</p>
            )}

            {importRows.length > 0 && (
              <div className="bg-purple-50 p-3 rounded border border-purple-200">
                <p className="text-sm text-purple-800 font-medium">
                  נמצאו {importRows.length} שורות לייבוא
                </p>
                <ul className="text-xs text-purple-600 mt-1 space-y-0.5 max-h-32 overflow-y-auto">
                  {importRows.slice(0, 5).map((r, i) => (
                    <li key={i}>
                      {r.client_name} — {r.position_name} — {r.candidate_name}
                    </li>
                  ))}
                  {importRows.length > 5 && (
                    <li className="text-purple-400">...ועוד {importRows.length - 5} שורות</li>
                  )}
                </ul>
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
                setImportOpen(false)
                setImportRows([])
                setImportError(null)
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
