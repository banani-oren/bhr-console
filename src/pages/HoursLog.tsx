import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Lock, Clock } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import type { HoursLog as HoursLogType, Transaction } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'

const HEBREW_MONTHS = [
  'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
]

// Known retainer clients — extend as needed
const RETAINER_CLIENTS: string[] = []

const now = new Date()
const CURRENT_MONTH = now.getMonth() + 1
const CURRENT_YEAR = now.getFullYear()

const YEAR_OPTIONS = Array.from({ length: 5 }, (_, i) => CURRENT_YEAR - 2 + i)

interface AddVisitForm {
  visit_date: string
  hours: number
  description: string
  client_name: string
  hours_category: string
}

const EMPTY_FORM: AddVisitForm = {
  visit_date: new Date().toISOString().slice(0, 10),
  hours: 1,
  description: '',
  client_name: '',
  hours_category: '',
}

export default function HoursLog() {
  const queryClient = useQueryClient()
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'

  const [selectedMonth, setSelectedMonth] = useState<number>(CURRENT_MONTH)
  const [selectedYear, setSelectedYear] = useState<number>(CURRENT_YEAR)
  const [activeTab, setActiveTab] = useState<string>('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState<AddVisitForm>(EMPTY_FORM)
  const [closingClient, setClosingClient] = useState<string | null>(null)

  // Fetch all hours_log entries for selected month/year
  const { data: hoursData = [], isLoading } = useQuery<HoursLogType[]>({
    queryKey: ['hours_log', selectedMonth, selectedYear],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('hours_log')
        .select('*')
        .eq('month', selectedMonth)
        .eq('year', selectedYear)
        .order('visit_date', { ascending: true })
      if (error) throw error
      return data as HoursLogType[]
    },
  })

  // Fetch transactions for close-month checks
  const { data: transactions = [] } = useQuery<Transaction[]>({
    queryKey: ['transactions'],
    queryFn: async () => {
      const { data, error } = await supabase.from('transactions').select('*')
      if (error) throw error
      return data as Transaction[]
    },
  })

  // Derive unique client tabs: retainer clients + clients from hours_log data
  const clientTabs = useMemo(() => {
    const fromData = hoursData.map((h) => h.client_name).filter(Boolean)
    const combined = [...new Set([...RETAINER_CLIENTS, ...fromData])]
    return combined.sort((a, b) => a.localeCompare(b, 'he'))
  }, [hoursData])

  // Keep activeTab in sync when tabs change
  const resolvedTab = clientTabs.includes(activeTab)
    ? activeTab
    : clientTabs[0] ?? ''

  // Insert new hours_log entry
  const insertHours = useMutation({
    mutationFn: async (row: Omit<AddVisitForm, ''> & { month: number; year: number }) => {
      const payload = profile?.id ? { ...row, profile_id: profile.id } : row
      const { error } = await supabase.from('hours_log').insert(payload)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hours_log'] })
    },
  })

  // Close month: upsert transaction
  const closeMonth = useMutation({
    mutationFn: async ({ clientName, totalHours }: { clientName: string; totalHours: number }) => {
      const existing = transactions.find(
        (t) =>
          t.client_name === clientName &&
          t.billing_month === selectedMonth &&
          t.billing_year === selectedYear &&
          t.service_type === 'ריטיינר'
      )
      if (existing) {
        const { error } = await supabase
          .from('transactions')
          .update({ net_invoice_amount: totalHours })
          .eq('id', existing.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('transactions').insert({
          client_name: clientName,
          billing_month: selectedMonth,
          billing_year: selectedYear,
          service_type: 'ריטיינר',
          net_invoice_amount: totalHours,
          position_name: '',
          candidate_name: '',
          salary: 0,
          commission_percent: 0,
          commission_amount: 0,
          service_lead: '',
          entry_date: new Date().toISOString().slice(0, 10),
          payment_status: 'ממתין',
          is_billable: true,
        })
        if (error) throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] })
    },
  })

  const hoursForClient = (clientName: string) =>
    hoursData.filter((h) => h.client_name === clientName)

  const totalHours = (clientName: string) =>
    hoursForClient(clientName).reduce((sum, h) => sum + (h.hours ?? 0), 0)

  const handleOpenAddDialog = (clientName: string) => {
    setForm({ ...EMPTY_FORM, client_name: clientName })
    setDialogOpen(true)
  }

  const handleFormChange = (field: keyof AddVisitForm, value: string | number) => {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle')

  const handleSaveVisit = async () => {
    setSaveStatus('saving')
    try {
      const visitDate = new Date(form.visit_date)
      await insertHours.mutateAsync({
        ...form,
        month: visitDate.getMonth() + 1,
        year: visitDate.getFullYear(),
      })
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

  const handleCloseMonth = (clientName: string) => {
    setClosingClient(clientName)
  }

  const [closeStatus, setCloseStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle')

  const confirmCloseMonth = async () => {
    if (!closingClient) return
    setCloseStatus('saving')
    try {
      await closeMonth.mutateAsync({
        clientName: closingClient,
        totalHours: totalHours(closingClient),
      })
      setCloseStatus('success')
      setTimeout(() => {
        setCloseStatus('idle')
        setClosingClient(null)
      }, 2000)
    } catch (err) {
      console.error('Close month error:', err)
      setCloseStatus('error')
    }
  }

  // Check if transaction already closed for client/month/year
  const isMonthClosed = (clientName: string) =>
    transactions.some(
      (t) =>
        t.client_name === clientName &&
        t.billing_month === selectedMonth &&
        t.billing_year === selectedYear &&
        t.service_type === 'ריטיינר'
    )

  // Determine if any hour entry has a non-null hours_category
  const hasCategory = (clientName: string) =>
    hoursForClient(clientName).some((h) => h.hours_category)

  // -----------------------------------------------------------------------
  // Personal view (non-admin): single table of my own hours for the month,
  // no per-client tabs, no close-month action.
  // -----------------------------------------------------------------------
  if (!isAdmin) {
    const totalMine = hoursData.reduce((s, h) => s + (h.hours ?? 0), 0)
    const showCategoryPersonal = hoursData.some((h) => h.hours_category)
    return (
      <div className="p-6 space-y-4" dir="rtl">
        <div className="flex items-center gap-2">
          <Clock className="w-6 h-6 text-purple-600" />
          <h1 className="text-2xl font-bold text-purple-900">יומן שעות</h1>
        </div>

        <Card className="p-4">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="space-y-1">
              <Label className="text-xs text-purple-700">חודש</Label>
              <Select value={String(selectedMonth)} onValueChange={(v) => setSelectedMonth(Number(v))}>
                <SelectTrigger className="w-36 border-purple-200 focus:ring-purple-400">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {HEBREW_MONTHS.map((name, i) => (
                    <SelectItem key={i + 1} value={String(i + 1)}>{name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-purple-700">שנה</Label>
              <Select value={String(selectedYear)} onValueChange={(v) => setSelectedYear(Number(v))}>
                <SelectTrigger className="w-28 border-purple-200 focus:ring-purple-400">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {YEAR_OPTIONS.map((y) => (
                    <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </Card>

        <div className="flex items-center justify-end">
          <Button className="bg-purple-600 hover:bg-purple-700 text-white" onClick={() => { setForm({ ...EMPTY_FORM }); setDialogOpen(true) }}>
            <Plus className="w-4 h-4 ml-1" />
            הוסף דיווח
          </Button>
        </div>

        <Card>
          {isLoading ? (
            <div className="p-8 text-center text-purple-400">טוען...</div>
          ) : hoursData.length === 0 ? (
            <div className="p-8 text-center text-gray-400">אין רשומות לחודש זה</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-purple-50">
                    <TableHead className="text-right text-purple-800 font-semibold">תאריך</TableHead>
                    <TableHead className="text-right text-purple-800 font-semibold">לקוח</TableHead>
                    <TableHead className="text-right text-purple-800 font-semibold">שעות</TableHead>
                    <TableHead className="text-right text-purple-800 font-semibold">תיאור</TableHead>
                    {showCategoryPersonal && (
                      <TableHead className="text-right text-purple-800 font-semibold">קטגוריה</TableHead>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {hoursData.map((entry) => (
                    <TableRow key={entry.id} className="hover:bg-purple-50/50 transition-colors">
                      <TableCell className="text-right font-medium">{entry.visit_date}</TableCell>
                      <TableCell className="text-right">{entry.client_name}</TableCell>
                      <TableCell className="text-right">{entry.hours}</TableCell>
                      <TableCell className="text-right text-gray-600">{entry.description ?? '—'}</TableCell>
                      {showCategoryPersonal && (
                        <TableCell className="text-right text-gray-500 text-sm">{entry.hours_category ?? '—'}</TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          <div className="flex items-center justify-between px-4 py-3 border-t border-purple-100 bg-purple-50/60">
            <span className="text-sm font-semibold text-purple-800">
              סה"כ שעות — {HEBREW_MONTHS[selectedMonth - 1]} {selectedYear}
            </span>
            <span className="text-lg font-bold text-purple-900">
              {totalMine.toLocaleString('he-IL')} ש'
            </span>
          </div>
        </Card>

        {/* Add-entry Dialog (reused) */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-md" dir="rtl">
            <DialogHeader>
              <DialogTitle className="text-purple-900 text-right">הוספת דיווח שעות</DialogTitle>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <div className="space-y-1">
                <Label className="text-purple-700">לקוח</Label>
                <Input
                  value={form.client_name}
                  onChange={(e) => handleFormChange('client_name', e.target.value)}
                  className="border-purple-200 focus-visible:ring-purple-400"
                  placeholder="שם הלקוח"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-purple-700">תאריך</Label>
                <Input
                  type="date"
                  value={form.visit_date}
                  onChange={(e) => handleFormChange('visit_date', e.target.value)}
                  className="border-purple-200 focus-visible:ring-purple-400"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-purple-700">שעות</Label>
                <Input
                  type="number"
                  step={0.5}
                  min={0.5}
                  value={form.hours}
                  onChange={(e) => handleFormChange('hours', Number(e.target.value))}
                  className="border-purple-200 focus-visible:ring-purple-400"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-purple-700">תיאור</Label>
                <Input
                  value={form.description}
                  onChange={(e) => handleFormChange('description', e.target.value)}
                  className="border-purple-200 focus-visible:ring-purple-400"
                  placeholder="תיאור הדיווח..."
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
              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setDialogOpen(false)}>ביטול</Button>
                <Button
                  className="bg-purple-600 hover:bg-purple-700 text-white"
                  onClick={handleSaveVisit}
                  disabled={saveStatus === 'saving' || !form.client_name.trim()}
                >
                  {saveStatus === 'saving' ? 'שומר...' : 'שמור'}
                </Button>
              </div>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    )
  }

  // -----------------------------------------------------------------------
  // Admin view (existing tabs-per-client layout)
  // -----------------------------------------------------------------------
  return (
    <div className="p-6 space-y-4" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clock className="w-6 h-6 text-purple-600" />
          <h1 className="text-2xl font-bold text-purple-900">יומן שעות</h1>
        </div>
      </div>

      {/* Month / Year selector */}
      <Card className="p-4">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="space-y-1">
            <Label className="text-xs text-purple-700">חודש</Label>
            <Select
              value={String(selectedMonth)}
              onValueChange={(v) => setSelectedMonth(Number(v))}
            >
              <SelectTrigger className="w-36 border-purple-200 focus:ring-purple-400">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {HEBREW_MONTHS.map((name, i) => (
                  <SelectItem key={i + 1} value={String(i + 1)}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-xs text-purple-700">שנה</Label>
            <Select
              value={String(selectedYear)}
              onValueChange={(v) => setSelectedYear(Number(v))}
            >
              <SelectTrigger className="w-28 border-purple-200 focus:ring-purple-400">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {YEAR_OPTIONS.map((y) => (
                  <SelectItem key={y} value={String(y)}>
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-end pb-0.5">
            <span className="text-sm text-purple-600 font-medium">
              {HEBREW_MONTHS[selectedMonth - 1]} {selectedYear}
            </span>
          </div>
        </div>
      </Card>

      {/* Tabs per client */}
      {isLoading ? (
        <div className="p-8 text-center text-purple-400">טוען...</div>
      ) : clientTabs.length === 0 ? (
        <Card className="p-8 text-center text-gray-400">
          אין נתוני שעות לחודש זה
        </Card>
      ) : (
        <Tabs
          value={resolvedTab}
          onValueChange={(v) => setActiveTab(v)}
          dir="rtl"
        >
          <TabsList className="bg-purple-50 border border-purple-200 flex-wrap h-auto gap-1 p-1">
            {clientTabs.map((client) => (
              <TabsTrigger
                key={client}
                value={client}
                className="data-[state=active]:bg-purple-600 data-[state=active]:text-white text-purple-700"
              >
                {client}
                {isMonthClosed(client) && (
                  <Lock className="w-3 h-3 mr-1 inline-block opacity-70" />
                )}
              </TabsTrigger>
            ))}
          </TabsList>

          {clientTabs.map((client) => {
            const entries = hoursForClient(client)
            const total = totalHours(client)
            const showCategory = hasCategory(client)
            const closed = isMonthClosed(client)

            return (
              <TabsContent key={client} value={client} className="space-y-3 mt-3">
                {/* Actions row */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {closed ? (
                      <span className="text-sm text-green-700 bg-green-50 border border-green-200 px-3 py-1 rounded-full flex items-center gap-1">
                        <Lock className="w-3 h-3" />
                        החודש נסגר
                      </span>
                    ) : (
                      <Button
                        variant="outline"
                        className="border-amber-300 text-amber-700 hover:bg-amber-50 text-sm"
                        onClick={() => handleCloseMonth(client)}
                        disabled={entries.length === 0}
                      >
                        <Lock className="w-4 h-4 ml-1" />
                        סגור חודש
                      </Button>
                    )}
                  </div>
                  <Button
                    className="bg-purple-600 hover:bg-purple-700 text-white"
                    onClick={() => handleOpenAddDialog(client)}
                  >
                    <Plus className="w-4 h-4 ml-1" />
                    הוסף ביקור
                  </Button>
                </div>

                {/* Hours table */}
                <Card>
                  {entries.length === 0 ? (
                    <div className="p-8 text-center text-gray-400">אין רשומות לחודש זה</div>
                  ) : (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-purple-50">
                            <TableHead className="text-right text-purple-800 font-semibold">
                              תאריך
                            </TableHead>
                            <TableHead className="text-right text-purple-800 font-semibold">
                              שעות
                            </TableHead>
                            <TableHead className="text-right text-purple-800 font-semibold">
                              תיאור
                            </TableHead>
                            {showCategory && (
                              <TableHead className="text-right text-purple-800 font-semibold">
                                קטגוריה
                              </TableHead>
                            )}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {entries.map((entry) => (
                            <TableRow
                              key={entry.id}
                              className="hover:bg-purple-50/50 transition-colors"
                            >
                              <TableCell className="text-right font-medium">
                                {entry.visit_date}
                              </TableCell>
                              <TableCell className="text-right">
                                {entry.hours}
                              </TableCell>
                              <TableCell className="text-right text-gray-600">
                                {entry.description ?? '—'}
                              </TableCell>
                              {showCategory && (
                                <TableCell className="text-right text-gray-500 text-sm">
                                  {entry.hours_category ?? '—'}
                                </TableCell>
                              )}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}

                  {/* Total footer */}
                  <div className="flex items-center justify-between px-4 py-3 border-t border-purple-100 bg-purple-50/60">
                    <span className="text-sm font-semibold text-purple-800">
                      סה"כ שעות — {HEBREW_MONTHS[selectedMonth - 1]} {selectedYear}
                    </span>
                    <span className="text-lg font-bold text-purple-900">
                      {total.toLocaleString('he-IL')} ש'
                    </span>
                  </div>
                </Card>
              </TabsContent>
            )
          })}
        </Tabs>
      )}

      {/* Add Visit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle className="text-purple-900 text-right">הוספת ביקור</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* לקוח */}
            <div className="space-y-1">
              <Label className="text-purple-700">לקוח</Label>
              <Select
                value={form.client_name}
                onValueChange={(v) => handleFormChange('client_name', v ?? '')}
              >
                <SelectTrigger className="border-purple-200 focus:ring-purple-400">
                  <SelectValue placeholder="בחר לקוח" />
                </SelectTrigger>
                <SelectContent>
                  {clientTabs.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* תאריך */}
            <div className="space-y-1">
              <Label className="text-purple-700">תאריך</Label>
              <Input
                type="date"
                value={form.visit_date}
                onChange={(e) => handleFormChange('visit_date', e.target.value)}
                className="border-purple-200 focus-visible:ring-purple-400"
              />
            </div>

            {/* שעות */}
            <div className="space-y-1">
              <Label className="text-purple-700">שעות</Label>
              <Input
                type="number"
                step={0.5}
                min={0.5}
                value={form.hours}
                onChange={(e) => handleFormChange('hours', Number(e.target.value))}
                className="border-purple-200 focus-visible:ring-purple-400"
              />
            </div>

            {/* תיאור */}
            <div className="space-y-1">
              <Label className="text-purple-700">תיאור</Label>
              <Input
                value={form.description}
                onChange={(e) => handleFormChange('description', e.target.value)}
                className="border-purple-200 focus-visible:ring-purple-400"
                placeholder="תיאור הביקור..."
              />
            </div>

            {/* קטגוריה (אופציונלי) */}
            <div className="space-y-1">
              <Label className="text-purple-700">קטגוריה (אופציונלי)</Label>
              <Input
                value={form.hours_category}
                onChange={(e) => handleFormChange('hours_category', e.target.value)}
                className="border-purple-200 focus-visible:ring-purple-400"
                placeholder="קטגוריה..."
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
                onClick={handleSaveVisit}
                disabled={saveStatus === 'saving' || saveStatus === 'success' || !form.client_name}
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

      {/* Confirm Close Month Dialog */}
      <Dialog open={!!closingClient} onOpenChange={(open) => !open && setClosingClient(null)}>
        <DialogContent className="max-w-sm" dir="rtl">
          <DialogHeader>
            <DialogTitle className="text-purple-900 text-right flex items-center gap-2">
              <Lock className="w-5 h-5 text-amber-500" />
              סגירת חודש
            </DialogTitle>
          </DialogHeader>

          <div className="py-2 space-y-3">
            <p className="text-sm text-gray-700">
              האם לסגור את חודש{' '}
              <strong>
                {HEBREW_MONTHS[selectedMonth - 1]} {selectedYear}
              </strong>{' '}
              עבור לקוח <strong>{closingClient}</strong>?
            </p>
            {closingClient && (
              <div className="bg-purple-50 border border-purple-200 rounded p-3 text-sm">
                <span className="text-purple-700 font-medium">סה"כ שעות: </span>
                <span className="text-purple-900 font-bold">
                  {totalHours(closingClient).toLocaleString('he-IL')} ש'
                </span>
              </div>
            )}
            <p className="text-xs text-gray-500">
              פעולה זו תיצור או תעדכן רשומת עסקה מסוג ריטיינר עבור חודש זה.
            </p>
          </div>

          <DialogFooter className="flex flex-col gap-2">
            {closeStatus === 'success' && (
              <p className="text-green-600 font-medium text-sm text-right">החודש נסגר בהצלחה ✓</p>
            )}
            {closeStatus === 'error' && (
              <p className="text-red-600 font-medium text-sm text-right">שגיאה בסגירת החודש, נסה שנית</p>
            )}
            <div className="flex gap-2 flex-row-reverse">
              <Button
                onClick={confirmCloseMonth}
                disabled={closeStatus === 'saving' || closeStatus === 'success'}
                className="bg-amber-500 hover:bg-amber-600 text-white"
              >
                {closeStatus === 'saving' ? 'מעבד...' : 'אשר סגירה'}
              </Button>
              <Button
                variant="outline"
                onClick={() => setClosingClient(null)}
                disabled={closeStatus === 'saving'}
                className="border-purple-300 text-purple-700 hover:bg-purple-50"
              >
                ביטול
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
