import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, Receipt, FileText } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import type { Client, HoursLog, Profile } from '@/lib/types'
import { addDays, parsePaymentTermDays } from '@/lib/billingEvents'
import { useSafeMutation } from '@/hooks/useSafeMutation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import ClientPicker from '@/components/ClientPicker'
import { DateCell } from '@/components/ui/date-cell'
import HoursEntryDialog from './HoursEntryDialog'
import HoursReportDialog from './HoursReportDialog'
import {
  HEBREW_MONTHS, CURRENT_MONTH, CURRENT_YEAR, YEAR_OPTIONS, monthLabel,
} from './common'

export default function ManageHoursView() {
  const queryClient = useQueryClient()
  const { profile } = useAuth()

  const [clientId, setClientId] = useState<string | null>(null)
  const [month, setMonth] = useState<number>(CURRENT_MONTH)
  const [year, setYear] = useState<number>(CURRENT_YEAR)
  const [entryOpen, setEntryOpen] = useState(false)
  const [editing, setEditing] = useState<HoursLog | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<HoursLog | null>(null)
  const [billingDialogOpen, setBillingDialogOpen] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)

  const { data: hoursData = [], isLoading } = useQuery<HoursLog[]>({
    queryKey: ['hours-manage', clientId, month, year],
    enabled: !!clientId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('hours_log')
        .select('*')
        .eq('client_id', clientId)
        .eq('month', month)
        .eq('year', year)
        .order('visit_date', { ascending: true })
      if (error) throw error
      return data as HoursLog[]
    },
  })

  const { data: profiles = [] } = useQuery<Profile[]>({
    queryKey: ['profile-names'],
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('id, full_name, role')
      if (error) throw error
      return data as Profile[]
    },
  })
  const profileNameById = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of profiles) m.set(p.id, p.full_name)
    return m
  }, [profiles])

  // Fetch clients once so we can read the selected client's name + close-month context.
  const { data: clients = [] } = useQuery<Client[]>({
    queryKey: ['clients'],
    queryFn: async () => {
      const { data, error } = await supabase.from('clients').select('*').order('name', { ascending: true })
      if (error) throw error
      return (data as Client[]) ?? []
    },
  })
  const selectedClient = clients.find((c) => c.id === clientId) ?? null

  const unbilledHours = useMemo(
    () => hoursData.filter((h) => !h.billed_transaction_id),
    [hoursData],
  )
  const totalHours = useMemo(
    () => hoursData.reduce((s, h) => s + (Number(h.hours) || 0), 0),
    [hoursData],
  )
  const totalUnbilledHours = useMemo(
    () => unbilledHours.reduce((s, h) => s + (Number(h.hours) || 0), 0),
    [unbilledHours],
  )
  const billingAmount = selectedClient?.hourly_rate
    ? Math.round(totalUnbilledHours * selectedClient.hourly_rate * 100) / 100
    : 0
  const termDays = parsePaymentTermDays(selectedClient?.payment_terms ?? null)
  const billingDate = addDays(new Date().toISOString().slice(0, 10), termDays)

  const deleteMut = useSafeMutation<{ id: string }, void>({
    mutationFn: async ({ id }) => {
      const { error } = await supabase.from('hours_log').delete().eq('id', id)
      if (error) throw error
    },
    invalidate: [['hours-manage'], ['hours_log']],
    successHoldMs: 800,
    onSuccess: () => {
      setDeleteTarget(null)
      queryClient.invalidateQueries({ queryKey: ['hours-manage'] })
    },
  })

  const hoursBillingMut = useSafeMutation<void, void>({
    mutationFn: async () => {
      if (!selectedClient || !clientId) throw new Error('לא נבחר לקוח')
      if (!selectedClient.hourly_rate) throw new Error('תעריף שעה לא הוגדר ללקוח')
      if (unbilledHours.length === 0) throw new Error('אין שעות לא מחויבות לתקופה זו')

      const periodStart = unbilledHours[0]?.visit_date ?? ''
      const periodEnd = unbilledHours[unbilledHours.length - 1]?.visit_date ?? ''
      const nowIso = new Date().toISOString()

      const { data: txn, error: txnErr } = await supabase
        .from('transactions')
        .insert({
          kind: 'time_period',
          client_id: clientId,
          client_name: selectedClient.name,
          service_type: 'שעות עבודה',
          period_start: periodStart,
          period_end: periodEnd,
          hours_total: totalUnbilledHours,
          hourly_rate_used: selectedClient.hourly_rate,
          net_invoice_amount: billingAmount,
          billing_month: month,
          billing_year: year,
          entry_date: new Date().toISOString().slice(0, 10),
          payment_status: 'ממתין',
          needs_approval: false,
          approved_at: nowIso,
          approved_by: profile?.id ?? null,
          created_by: profile?.id ?? null,
          position_name: '',
          candidate_name: '',
          salary: 0,
          commission_percent: 0,
          commission_amount: 0,
          service_lead: profile?.full_name ?? '',
        })
        .select('id')
        .single()
      if (txnErr || !txn) throw txnErr ?? new Error('שגיאה ביצירת עסקה')

      const txnId = (txn as { id: string }).id

      const hourIds = unbilledHours.map((h) => h.id)
      if (hourIds.length > 0) {
        const { error: linkErr } = await supabase
          .from('hours_log')
          .update({ billed_transaction_id: txnId })
          .in('id', hourIds)
        if (linkErr) throw linkErr
      }

      const { error: evtErr } = await supabase.from('billing_events').insert({
        transaction_id: txnId,
        event_index: 1,
        amount: billingAmount,
        description: `שעות עבודה · ${selectedClient.name} · ${periodStart} – ${periodEnd}`,
        billing_date: billingDate,
        status: 'pending',
        advance_applied: 0,
        supplier_amount: 0,
      })
      if (evtErr) throw evtErr
    },
    invalidate: [['transactions'], ['billing_events'], ['hours-manage']],
    onSuccess: () => {
      setTimeout(() => setBillingDialogOpen(false), 1000)
    },
  })

  const clientFilter = (c: Client) => c.time_log_enabled

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex items-end gap-3 flex-wrap">
          <div className="space-y-1 min-w-60 flex-1">
            <Label className="text-xs text-purple-700">לקוח</Label>
            <ClientPicker
              value={clientId}
              onChange={(id) => setClientId(id)}
              filter={clientFilter}
              placeholder="חפש לקוח..."
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-purple-700">חודש</Label>
            <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                {HEBREW_MONTHS.map((n, i) => (
                  <SelectItem key={i + 1} value={String(i + 1)}>{n}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-purple-700">שנה</Label>
            <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
              <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
              <SelectContent>
                {YEAR_OPTIONS.map((y) => (
                  <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {clientId && (
            <Button
              onClick={() => { setEditing(null); setEntryOpen(true) }}
              className="bg-purple-600 hover:bg-purple-700 text-white"
            >
              <Plus className="w-4 h-4 ml-1" />
              הוסף דיווח
            </Button>
          )}
          {clientId && (
            <Button
              onClick={() => setBillingDialogOpen(true)}
              variant="outline"
              className="border-amber-300 text-amber-700 hover:bg-amber-50"
              disabled={unbilledHours.length === 0}
              title={
                !selectedClient?.hourly_rate
                  ? 'תעריף שעה לא הוגדר ללקוח'
                  : unbilledHours.length === 0
                  ? 'אין שעות לא מחויבות'
                  : ''
              }
            >
              <Receipt className="w-4 h-4 ml-1" />
              הפק חיוב שעות
            </Button>
          )}
          <Button
            onClick={() => setReportOpen(true)}
            variant="outline"
            className="border-purple-300 text-purple-700 hover:bg-purple-50"
          >
            <FileText className="w-4 h-4 ml-1" />
            הפק דוח שעות
          </Button>
        </div>
      </Card>

      {!clientId ? (
        <Card className="p-8 text-center text-muted-foreground">בחר לקוח כדי להציג דיווחים</Card>
      ) : (
        <Card>
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">טוען...</div>
          ) : hoursData.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">אין דיווחים בחודש זה ללקוח זה</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-purple-50">
                  <TableHead className="text-right text-purple-800">תאריך</TableHead>
                  <TableHead className="text-right text-purple-800">משעה</TableHead>
                  <TableHead className="text-right text-purple-800">עד שעה</TableHead>
                  <TableHead className="text-right text-purple-800">שעות</TableHead>
                  <TableHead className="text-right text-purple-800">עובד</TableHead>
                  <TableHead className="text-right text-purple-800">תיאור</TableHead>
                  <TableHead className="text-right text-purple-800">פעולות</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {hoursData.map((entry) => {
                  const billed = !!entry.billed_transaction_id
                  return (
                    <TableRow key={entry.id} className={billed ? 'bg-green-50/30' : 'hover:bg-purple-50/40'}>
                      <TableCell><DateCell value={entry.visit_date} /></TableCell>
                      <TableCell dir="ltr" className="text-right">{entry.start_time ?? '—'}</TableCell>
                      <TableCell dir="ltr" className="text-right">{entry.end_time ?? '—'}</TableCell>
                      <TableCell>{entry.hours}</TableCell>
                      <TableCell>{entry.profile_id ? profileNameById.get(entry.profile_id) ?? '—' : '—'}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {entry.description ?? '—'}
                        {billed && (
                          <Badge variant="outline" className="ms-2 text-green-700 border-green-300 text-[10px]">
                            חויב ✓
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1 justify-end">
                          <Button
                            size="icon" variant="ghost" className="h-8 w-8 text-purple-600 hover:bg-purple-100"
                            onClick={() => { setEditing(entry); setEntryOpen(true) }}
                            title="עריכה"
                            disabled={billed}
                          >
                            <Pencil className="w-4 h-4" />
                          </Button>
                          <Button
                            size="icon" variant="ghost" className="h-8 w-8 text-red-500 hover:bg-red-50"
                            onClick={() => setDeleteTarget(entry)}
                            title={billed ? 'נעול — חויב' : 'מחיקה'}
                            disabled={billed}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
          <div className="flex items-center justify-between px-4 py-3 border-t border-purple-100 bg-purple-50/60">
            <span className="text-sm font-semibold text-purple-800">
              סה"כ שעות — {selectedClient?.name} · {monthLabel(month, year)}
            </span>
            <span className="text-lg font-bold text-purple-900">{totalHours.toFixed(2)} ש'</span>
          </div>
        </Card>
      )}

      <HoursEntryDialog
        open={entryOpen}
        onOpenChange={(open) => { setEntryOpen(open); if (!open) setEditing(null) }}
        clientFilter={clientFilter}
        presetClientId={editing ? null : clientId}
        editing={editing}
        invalidate={[['hours-manage']]}
      />

      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}>
        <DialogContent dir="rtl" className="max-w-sm">
          <DialogHeader>
            <DialogTitle>מחיקת דיווח</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            האם למחוק את הדיווח של {deleteTarget?.client_name} מתאריך {deleteTarget?.visit_date}?
          </p>
          {deleteMut.saveStatus === 'error' && (
            <p className="text-sm text-destructive">{deleteMut.errorMessage ?? 'שגיאה'}</p>
          )}
          <DialogFooter className="flex gap-2 flex-row-reverse">
            <Button
              variant="destructive"
              disabled={deleteMut.saveStatus === 'saving'}
              onClick={() => deleteTarget && void deleteMut.mutate({ id: deleteTarget.id })}
            >
              {deleteMut.saveStatus === 'saving' ? 'מוחק...' : 'מחק'}
            </Button>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>ביטול</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={billingDialogOpen} onOpenChange={setBillingDialogOpen}>
        <DialogContent dir="rtl" className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Receipt className="w-4 h-4 text-amber-500" />
              הפק חיוב שעות
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <div className="grid grid-cols-2 gap-y-2">
              <span className="text-muted-foreground">לקוח:</span>
              <span className="font-medium">{selectedClient?.name}</span>
              <span className="text-muted-foreground">תקופה:</span>
              <span>{monthLabel(month, year)}</span>
              <span className="text-muted-foreground">סה"כ שעות:</span>
              <span className="font-medium">{totalUnbilledHours.toFixed(2)}</span>
              <span className="text-muted-foreground">תעריף שעה:</span>
              <span>
                {selectedClient?.hourly_rate != null
                  ? new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 }).format(selectedClient.hourly_rate)
                  : '—'}
              </span>
            </div>
            <div className="border-t pt-2 flex justify-between">
              <span className="text-muted-foreground">סכום לחיוב:</span>
              <span className="font-bold text-lg">
                {new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 }).format(billingAmount)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">תאריך חיוב:</span>
              <span>{billingDate}</span>
            </div>
            {hoursBillingMut.saveStatus === 'error' && (
              <p className="text-destructive">{hoursBillingMut.errorMessage ?? 'שגיאה'}</p>
            )}
            {hoursBillingMut.saveStatus === 'success' && (
              <p className="text-green-600">החיוב הופק ✓</p>
            )}
          </div>
          <DialogFooter className="flex gap-2 flex-row-reverse">
            <Button
              className="bg-amber-500 hover:bg-amber-600 text-white"
              onClick={() => void hoursBillingMut.mutate()}
              disabled={
                hoursBillingMut.saveStatus === 'saving' ||
                unbilledHours.length === 0 ||
                !selectedClient?.hourly_rate
              }
            >
              {hoursBillingMut.saveStatus === 'saving' ? 'מעבד...' : 'אשר הפקת חיוב'}
            </Button>
            <Button variant="outline" onClick={() => setBillingDialogOpen(false)}>ביטול</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <HoursReportDialog
        open={reportOpen}
        onOpenChange={setReportOpen}
        presetClientId={clientId}
      />
    </div>
  )
}
