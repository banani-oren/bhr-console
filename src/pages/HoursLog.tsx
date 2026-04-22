import { useState, useMemo, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Lock, Clock, FileText } from 'lucide-react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import type { HoursLog as HoursLogType, Transaction, Client } from '@/lib/types'
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

const now = new Date()
const CURRENT_MONTH = now.getMonth() + 1
const CURRENT_YEAR = now.getFullYear()

const YEAR_OPTIONS = Array.from({ length: 5 }, (_, i) => CURRENT_YEAR - 2 + i)

interface AddVisitForm {
  visit_date: string
  hours: number
  description: string
  client_name: string
  client_id: string | null
  hours_category: string
  start_time: string
  end_time: string
}

const EMPTY_FORM: AddVisitForm = {
  visit_date: new Date().toISOString().slice(0, 10),
  hours: 1,
  description: '',
  client_name: '',
  client_id: null,
  hours_category: '',
  start_time: '',
  end_time: '',
}

function computeHours(start: string, end: string): number | null {
  if (!start || !end) return null
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  if ([sh, sm, eh, em].some((n) => Number.isNaN(n))) return null
  const mins = eh * 60 + em - (sh * 60 + sm)
  if (mins <= 0) return null
  return Math.round((mins / 60) * 100) / 100
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
  const [personalClientId, setPersonalClientId] = useState<string | null>(null)
  // Phase B: admins get a ניהול/שלי toggle; non-admins always see personal view.
  const [adminHoursView, setAdminHoursView] = useState<'manage' | 'mine'>('manage')

  // Clients (admin + permitted list for non-admin)
  const { data: allClients = [] } = useQuery<Client[]>({
    queryKey: ['clients'],
    queryFn: async () => {
      const { data, error } = await supabase.from('clients').select('*').order('name', { ascending: true })
      if (error) throw error
      return data as Client[]
    },
  })

  // Non-admin: permitted clients with time_log_enabled.
  // Admin in 'mine' mode (Phase B): all time_log_enabled clients — admins may
  // log time on any client without being explicitly permissioned.
  const { data: permittedClients = [] } = useQuery<Client[]>({
    queryKey: ['permitted-clients', profile?.id, isAdmin],
    enabled: !!profile?.id,
    queryFn: async () => {
      if (isAdmin) {
        const { data, error } = await supabase
          .from('clients')
          .select('*')
          .eq('time_log_enabled', true)
          .order('name', { ascending: true })
        if (error) throw error
        return (data as Client[]) ?? []
      }
      const { data, error } = await supabase
        .from('client_time_log_permissions')
        .select('client_id, clients(*)')
        .eq('profile_id', profile!.id)
      if (error) throw error
      const rows = (data as unknown as Array<{ clients: Client | Client[] | null }> | null) ?? []
      return rows
        .flatMap((r) => (Array.isArray(r.clients) ? r.clients : r.clients ? [r.clients] : []))
        .filter((c) => c && c.time_log_enabled)
    },
  })

  // Fetch hours_log entries for selected month/year. Admin 'mine' mode and
  // non-admin view both filter by profile_id.
  const scopeMine = !isAdmin || adminHoursView === 'mine'
  const { data: hoursData = [], isLoading } = useQuery<HoursLogType[]>({
    queryKey: ['hours_log', selectedMonth, selectedYear, profile?.id, scopeMine],
    queryFn: async () => {
      let q = supabase
        .from('hours_log')
        .select('*')
        .eq('month', selectedMonth)
        .eq('year', selectedYear)
        .order('visit_date', { ascending: true })
      if (scopeMine && profile?.id) q = q.eq('profile_id', profile.id)
      const { data, error } = await q
      if (error) throw error
      return data as HoursLogType[]
    },
  })

  const { data: transactions = [] } = useQuery<Transaction[]>({
    queryKey: ['transactions'],
    queryFn: async () => {
      const { data, error } = await supabase.from('transactions').select('*')
      if (error) throw error
      return data as Transaction[]
    },
  })

  const clientTabs = useMemo(() => {
    const fromData = hoursData.map((h) => h.client_name).filter(Boolean)
    return [...new Set(fromData)].sort((a, b) => a.localeCompare(b, 'he'))
  }, [hoursData])

  const resolvedTab = clientTabs.includes(activeTab) ? activeTab : clientTabs[0] ?? ''

  useEffect(() => {
    if (!isAdmin && !personalClientId && permittedClients.length > 0) {
      setPersonalClientId(permittedClients[0].id)
    }
  }, [isAdmin, personalClientId, permittedClients])

  const insertHours = useMutation({
    mutationFn: async (row: AddVisitForm & { month: number; year: number; computed_hours: number }) => {
      const payload: Record<string, unknown> = {
        client_name: row.client_name,
        client_id: row.client_id,
        visit_date: row.visit_date,
        description: row.description || null,
        hours_category: row.hours_category || null,
        month: row.month,
        year: row.year,
        hours: row.computed_hours,
        start_time: row.start_time || null,
        end_time: row.end_time || null,
      }
      if (profile?.id) payload.profile_id = profile.id
      const { error } = await supabase.from('hours_log').insert(payload)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hours_log'] })
    },
  })

  const closeMonth = useMutation({
    mutationFn: async ({ clientName, totalHours }: { clientName: string; totalHours: number }) => {
      const existing = transactions.find(
        (t) =>
          t.client_name === clientName &&
          t.billing_month === selectedMonth &&
          t.billing_year === selectedYear &&
          t.service_type === 'ריטיינר',
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

  const hoursForClient = (clientName: string) => hoursData.filter((h) => h.client_name === clientName)
  const totalHours = (clientName: string) =>
    hoursForClient(clientName).reduce((sum, h) => sum + (h.hours ?? 0), 0)

  const handleOpenAddDialog = (clientName: string, clientId?: string | null) => {
    setForm({ ...EMPTY_FORM, client_name: clientName, client_id: clientId ?? null })
    setDialogOpen(true)
  }

  const handleFormChange = <K extends keyof AddVisitForm>(field: K, value: AddVisitForm[K]) => {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle')

  const handleSaveVisit = async () => {
    setSaveStatus('saving')
    try {
      const visitDate = new Date(form.visit_date)
      const computed = computeHours(form.start_time, form.end_time) ?? form.hours
      await insertHours.mutateAsync({
        ...form,
        month: visitDate.getMonth() + 1,
        year: visitDate.getFullYear(),
        computed_hours: computed,
      })
      setSaveStatus('success')
      setTimeout(() => {
        setSaveStatus('idle')
        setDialogOpen(false)
      }, 1500)
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

  const isMonthClosed = (clientName: string) =>
    transactions.some(
      (t) =>
        t.client_name === clientName &&
        t.billing_month === selectedMonth &&
        t.billing_year === selectedYear &&
        t.service_type === 'ריטיינר',
    )

  const hasCategory = (clientName: string) =>
    hoursForClient(clientName).some((h) => h.hours_category)

  // Personal view: non-admins always see it; admins see it when toggle is 'mine'.
  if (!isAdmin || adminHoursView === 'mine') {
    const selectedClient = permittedClients.find((c) => c.id === personalClientId) ?? null
    const hoursForSelected = selectedClient
      ? hoursData.filter((h) => h.client_name === selectedClient.name)
      : hoursData
    const totalMine = hoursForSelected.reduce((s, h) => s + (h.hours ?? 0), 0)
    const showCategoryPersonal = hoursForSelected.some((h) => h.hours_category)
    return (
      <div className="p-6 space-y-4" dir="rtl">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Clock className="w-6 h-6 text-purple-600" />
            <h1 className="text-2xl font-bold text-purple-900">יומן שעות</h1>
          </div>
          {isAdmin && (
            <div className="inline-flex rounded-lg border border-purple-200 bg-white p-0.5 text-sm">
              <button
                type="button"
                onClick={() => setAdminHoursView('manage')}
                className={`px-3 py-1.5 rounded-md ${
                  adminHoursView === 'manage'
                    ? 'bg-purple-600 text-white'
                    : 'text-purple-700 hover:bg-purple-50'
                }`}
              >
                ניהול שעות
              </button>
              <button
                type="button"
                onClick={() => setAdminHoursView('mine')}
                className={`px-3 py-1.5 rounded-md ${
                  adminHoursView === 'mine'
                    ? 'bg-purple-600 text-white'
                    : 'text-purple-700 hover:bg-purple-50'
                }`}
              >
                השעות שלי
              </button>
            </div>
          )}
        </div>

        <Card className="p-4">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="space-y-1">
              <Label className="text-xs text-purple-700">לקוח</Label>
              <Select value={personalClientId ?? ''} onValueChange={(v) => setPersonalClientId(v || null)}>
                <SelectTrigger className="w-60 border-purple-200">
                  <SelectValue placeholder="בחר לקוח" />
                </SelectTrigger>
                <SelectContent>
                  {permittedClients.length === 0 ? (
                    <div className="p-2 text-xs text-muted-foreground">אין לקוחות מאושרים</div>
                  ) : (
                    permittedClients.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-purple-700">חודש</Label>
              <Select value={String(selectedMonth)} onValueChange={(v) => setSelectedMonth(Number(v))}>
                <SelectTrigger className="w-36 border-purple-200">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {HEBREW_MONTHS.map((name, i) => <SelectItem key={i + 1} value={String(i + 1)}>{name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-purple-700">שנה</Label>
              <Select value={String(selectedYear)} onValueChange={(v) => setSelectedYear(Number(v))}>
                <SelectTrigger className="w-28 border-purple-200">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {YEAR_OPTIONS.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </Card>

        <div className="flex items-center justify-end">
          <Button
            className="bg-purple-600 hover:bg-purple-700 text-white"
            onClick={() => {
              if (!selectedClient) return
              handleOpenAddDialog(selectedClient.name, selectedClient.id)
            }}
            disabled={!selectedClient}
          >
            <Plus className="w-4 h-4 ml-1" />
            הוסף דיווח
          </Button>
        </div>

        <Card>
          {isLoading ? (
            <div className="p-8 text-center text-purple-400">טוען...</div>
          ) : hoursForSelected.length === 0 ? (
            <div className="p-8 text-center text-gray-400">אין רשומות לחודש זה</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-purple-50">
                    <TableHead className="text-right text-purple-800 font-semibold">תאריך</TableHead>
                    <TableHead className="text-right text-purple-800 font-semibold">לקוח</TableHead>
                    <TableHead className="text-right text-purple-800 font-semibold">משעה</TableHead>
                    <TableHead className="text-right text-purple-800 font-semibold">עד שעה</TableHead>
                    <TableHead className="text-right text-purple-800 font-semibold">שעות</TableHead>
                    <TableHead className="text-right text-purple-800 font-semibold">תיאור</TableHead>
                    {showCategoryPersonal && (
                      <TableHead className="text-right text-purple-800 font-semibold">קטגוריה</TableHead>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {hoursForSelected.map((entry) => (
                    <TableRow key={entry.id} className="hover:bg-purple-50/50 transition-colors">
                      <TableCell className="text-right font-medium">{entry.visit_date}</TableCell>
                      <TableCell className="text-right">{entry.client_name}</TableCell>
                      <TableCell className="text-right" dir="ltr">{(entry as unknown as { start_time?: string | null }).start_time ?? '—'}</TableCell>
                      <TableCell className="text-right" dir="ltr">{(entry as unknown as { end_time?: string | null }).end_time ?? '—'}</TableCell>
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

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-md" dir="rtl">
            <DialogHeader>
              <DialogTitle className="text-purple-900 text-right">הוספת דיווח שעות</DialogTitle>
            </DialogHeader>
            <AddVisitBody form={form} onChange={handleFormChange} disableClient />
            <DialogFooterButtons
              saveStatus={saveStatus}
              onCancel={() => setDialogOpen(false)}
              onSave={handleSaveVisit}
              canSave={!!form.client_name.trim() && !!form.start_time && !!form.end_time}
            />
          </DialogContent>
        </Dialog>
      </div>
    )
  }

  // Admin view
  return (
    <div className="p-6 space-y-4" dir="rtl">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Clock className="w-6 h-6 text-purple-600" />
          <h1 className="text-2xl font-bold text-purple-900">יומן שעות</h1>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-purple-200 bg-white p-0.5 text-sm">
            <button
              type="button"
              onClick={() => setAdminHoursView('manage')}
              className="px-3 py-1.5 rounded-md bg-purple-600 text-white"
            >
              ניהול שעות
            </button>
            <button
              type="button"
              onClick={() => setAdminHoursView('mine')}
              className="px-3 py-1.5 rounded-md text-purple-700 hover:bg-purple-50"
            >
              השעות שלי
            </button>
          </div>
          <Link to="/hours/report">
            <Button variant="outline" className="border-purple-300 text-purple-700 hover:bg-purple-50">
              <FileText className="w-4 h-4 ml-1" />
              הפקת דוח שעות
            </Button>
          </Link>
        </div>
      </div>

      <Card className="p-4">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="space-y-1">
            <Label className="text-xs text-purple-700">חודש</Label>
            <Select value={String(selectedMonth)} onValueChange={(v) => setSelectedMonth(Number(v))}>
              <SelectTrigger className="w-36 border-purple-200"><SelectValue /></SelectTrigger>
              <SelectContent>
                {HEBREW_MONTHS.map((name, i) => <SelectItem key={i + 1} value={String(i + 1)}>{name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-purple-700">שנה</Label>
            <Select value={String(selectedYear)} onValueChange={(v) => setSelectedYear(Number(v))}>
              <SelectTrigger className="w-28 border-purple-200"><SelectValue /></SelectTrigger>
              <SelectContent>
                {YEAR_OPTIONS.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
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

      {isLoading ? (
        <div className="p-8 text-center text-purple-400">טוען...</div>
      ) : clientTabs.length === 0 ? (
        <Card className="p-8 text-center text-gray-400">אין נתוני שעות לחודש זה</Card>
      ) : (
        <Tabs value={resolvedTab} onValueChange={(v) => setActiveTab(v)} dir="rtl">
          <TabsList className="bg-purple-50 border border-purple-200 flex-wrap h-auto gap-1 p-1">
            {clientTabs.map((client) => (
              <TabsTrigger
                key={client}
                value={client}
                className="data-[state=active]:bg-purple-600 data-[state=active]:text-white text-purple-700"
              >
                {client}
                {isMonthClosed(client) && <Lock className="w-3 h-3 mr-1 inline-block opacity-70" />}
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
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {closed ? (
                      <span className="text-sm text-green-700 bg-green-50 border border-green-200 px-3 py-1 rounded-full flex items-center gap-1">
                        <Lock className="w-3 h-3" />החודש נסגר
                      </span>
                    ) : (
                      <Button
                        variant="outline"
                        className="border-amber-300 text-amber-700 hover:bg-amber-50 text-sm"
                        onClick={() => handleCloseMonth(client)}
                        disabled={entries.length === 0}
                      >
                        <Lock className="w-4 h-4 ml-1" />סגור חודש
                      </Button>
                    )}
                  </div>
                  <Button
                    className="bg-purple-600 hover:bg-purple-700 text-white"
                    onClick={() => {
                      const clientId = allClients.find((c) => c.name === client)?.id ?? null
                      handleOpenAddDialog(client, clientId)
                    }}
                  >
                    <Plus className="w-4 h-4 ml-1" />הוסף ביקור
                  </Button>
                </div>

                <Card>
                  {entries.length === 0 ? (
                    <div className="p-8 text-center text-gray-400">אין רשומות לחודש זה</div>
                  ) : (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-purple-50">
                            <TableHead className="text-right text-purple-800 font-semibold">תאריך</TableHead>
                            <TableHead className="text-right text-purple-800 font-semibold">משעה</TableHead>
                            <TableHead className="text-right text-purple-800 font-semibold">עד שעה</TableHead>
                            <TableHead className="text-right text-purple-800 font-semibold">שעות</TableHead>
                            <TableHead className="text-right text-purple-800 font-semibold">תיאור</TableHead>
                            {showCategory && (
                              <TableHead className="text-right text-purple-800 font-semibold">קטגוריה</TableHead>
                            )}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {entries.map((entry) => (
                            <TableRow key={entry.id} className="hover:bg-purple-50/50 transition-colors">
                              <TableCell className="text-right font-medium">{entry.visit_date}</TableCell>
                              <TableCell className="text-right" dir="ltr">{(entry as unknown as { start_time?: string | null }).start_time ?? '—'}</TableCell>
                              <TableCell className="text-right" dir="ltr">{(entry as unknown as { end_time?: string | null }).end_time ?? '—'}</TableCell>
                              <TableCell className="text-right">{entry.hours}</TableCell>
                              <TableCell className="text-right text-gray-600">{entry.description ?? '—'}</TableCell>
                              {showCategory && (
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
                      {total.toLocaleString('he-IL')} ש'
                    </span>
                  </div>
                </Card>
              </TabsContent>
            )
          })}
        </Tabs>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle className="text-purple-900 text-right">הוספת ביקור</DialogTitle>
          </DialogHeader>
          <AddVisitBody
            form={form}
            onChange={handleFormChange}
            disableClient={false}
            clients={allClients}
          />
          <DialogFooterButtons
            saveStatus={saveStatus}
            onCancel={() => setDialogOpen(false)}
            onSave={handleSaveVisit}
            canSave={!!form.client_name.trim() && !!form.start_time && !!form.end_time}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={!!closingClient} onOpenChange={(open) => !open && setClosingClient(null)}>
        <DialogContent className="max-w-sm" dir="rtl">
          <DialogHeader>
            <DialogTitle className="text-purple-900 text-right flex items-center gap-2">
              <Lock className="w-5 h-5 text-amber-500" />סגירת חודש
            </DialogTitle>
          </DialogHeader>
          <div className="py-2 space-y-3">
            <p className="text-sm text-gray-700">
              האם לסגור את חודש <strong>{HEBREW_MONTHS[selectedMonth - 1]} {selectedYear}</strong> עבור לקוח <strong>{closingClient}</strong>?
            </p>
            {closingClient && (
              <div className="bg-purple-50 border border-purple-200 rounded p-3 text-sm">
                <span className="text-purple-700 font-medium">סה"כ שעות: </span>
                <span className="text-purple-900 font-bold">
                  {totalHours(closingClient).toLocaleString('he-IL')} ש'
                </span>
              </div>
            )}
          </div>
          <DialogFooter className="flex flex-col gap-2">
            {closeStatus === 'success' && <p className="text-green-600 text-sm text-right">החודש נסגר ✓</p>}
            {closeStatus === 'error' && <p className="text-red-600 text-sm text-right">שגיאה</p>}
            <div className="flex gap-2 flex-row-reverse">
              <Button
                onClick={confirmCloseMonth}
                disabled={closeStatus === 'saving' || closeStatus === 'success'}
                className="bg-amber-500 hover:bg-amber-600 text-white"
              >
                {closeStatus === 'saving' ? 'מעבד...' : 'אשר סגירה'}
              </Button>
              <Button variant="outline" onClick={() => setClosingClient(null)}>ביטול</Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function AddVisitBody({
  form,
  onChange,
  disableClient,
  clients,
}: {
  form: AddVisitForm
  onChange: <K extends keyof AddVisitForm>(field: K, value: AddVisitForm[K]) => void
  disableClient: boolean
  clients?: Client[]
}) {
  const computed = computeHours(form.start_time, form.end_time)
  return (
    <div className="space-y-3 py-2">
      <div className="space-y-1">
        <Label className="text-purple-700">לקוח</Label>
        {disableClient || !clients ? (
          <Input value={form.client_name} disabled className="border-purple-200" />
        ) : (
          <Select
            value={form.client_id ?? ''}
            onValueChange={(v) => {
              const c = clients.find((x) => x.id === v)
              onChange('client_id', c?.id ?? null)
              onChange('client_name', c?.name ?? '')
            }}
          >
            <SelectTrigger className="border-purple-200"><SelectValue placeholder="בחר לקוח" /></SelectTrigger>
            <SelectContent>
              {clients.map((c) => (<SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>))}
            </SelectContent>
          </Select>
        )}
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1">
          <Label className="text-purple-700">תאריך</Label>
          <Input type="date" value={form.visit_date} onChange={(e) => onChange('visit_date', e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-purple-700">משעה</Label>
          <Input type="time" dir="ltr" value={form.start_time} onChange={(e) => onChange('start_time', e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-purple-700">עד שעה</Label>
          <Input type="time" dir="ltr" value={form.end_time} onChange={(e) => onChange('end_time', e.target.value)} />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {computed != null ? `משך: ${computed} שעות` : 'בחר משעה עד שעה כדי לחשב משך'}
      </p>
      <div className="space-y-1">
        <Label className="text-purple-700">תיאור</Label>
        <Input value={form.description} onChange={(e) => onChange('description', e.target.value)} placeholder="תיאור הביקור..." />
      </div>
    </div>
  )
}

function DialogFooterButtons({
  saveStatus,
  onCancel,
  onSave,
  canSave,
}: {
  saveStatus: 'idle' | 'saving' | 'success' | 'error'
  onCancel: () => void
  onSave: () => void
  canSave: boolean
}) {
  return (
    <DialogFooter className="flex flex-col gap-2">
      {saveStatus === 'success' && <p className="text-green-600 font-medium text-sm text-right">המידע נשמר ✓</p>}
      {saveStatus === 'error' && <p className="text-red-600 font-medium text-sm text-right">שגיאה בשמירה, נסה שנית</p>}
      <div className="flex gap-2 flex-row-reverse">
        <Button onClick={onSave} disabled={saveStatus === 'saving' || !canSave} className="bg-purple-600 hover:bg-purple-700 text-white">
          {saveStatus === 'saving' ? 'שומר...' : 'שמור'}
        </Button>
        <Button variant="outline" onClick={onCancel} disabled={saveStatus === 'saving'}>ביטול</Button>
      </div>
    </DialogFooter>
  )
}
