import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, Receipt, FileText } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import type { Client, HoursLog } from '@/lib/types'
import { addDays, parsePaymentTermDays } from '@/lib/billingEvents'
import { useSafeMutation } from '@/hooks/useSafeMutation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger,
} from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import ClientPicker from '@/components/ClientPicker'
import { DateCell } from '@/components/ui/date-cell'
import {
  SortableHead,
  toggleSortKey,
  compareBySort,
  type SortState,
} from '@/components/SortableHead'
import HoursEntryDialog from './HoursEntryDialog'
import HoursReportDialog from './HoursReportDialog'
import {
  HEBREW_MONTHS, CURRENT_MONTH, CURRENT_YEAR, YEAR_OPTIONS, monthLabel,
} from './common'

const ALL_EMPLOYEES = '__all__'

type EligibleProfile = { id: string; full_name: string; role: string }

export default function MyHoursView() {
  const { profile } = useAuth()
  const queryClient = useQueryClient()
  // Admin + administration see every employee's hours and get the employee
  // filter. Recruiters see only their own hours (no employee filter).
  const canSeeAll = profile?.role === 'admin' || profile?.role === 'administration'
  const isAdmin = profile?.role === 'admin'

  const [clientId, setClientId] = useState<string | null>(null)
  const [employeeId, setEmployeeId] = useState<string>(ALL_EMPLOYEES)
  const [month, setMonth] = useState<number>(CURRENT_MONTH)
  const [year, setYear] = useState<number>(CURRENT_YEAR)
  const [entryOpen, setEntryOpen] = useState(false)
  const [editing, setEditing] = useState<HoursLog | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<HoursLog | null>(null)
  const [billingDialogOpen, setBillingDialogOpen] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const [sort, setSort] = useState<SortState>({ key: 'visit_date', dir: 'desc' })
  const toggleSort = (key: string) => setSort((prev) => toggleSortKey(prev, key))

  // Permitted clients for this user.
  // canSeeAll: every time_log_enabled client.
  // recruiter: intersection of client_time_log_permissions + time_log_enabled.
  const { data: permittedClients = [] } = useQuery<Client[]>({
    queryKey: ['hours-permitted-clients', profile?.id, canSeeAll],
    enabled: !!profile?.id,
    queryFn: async () => {
      if (canSeeAll) {
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

  // Employee names + employee-filter options (canSeeAll only).
  // profiles RLS forbids administration from reading the table directly, so we
  // go through the SECURITY DEFINER list_profiles_for_attendance() helper,
  // which returns id/full_name/role for admin + administration callers.
  const { data: employees = [] } = useQuery<EligibleProfile[]>({
    queryKey: ['hours-employee-list'],
    enabled: canSeeAll,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('list_profiles_for_attendance')
      if (error) throw error
      return (data as EligibleProfile[] | null) ?? []
    },
  })
  const profileNameById = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of employees) m.set(p.id, p.full_name)
    return m
  }, [employees])

  const { data: hoursData = [], isLoading } = useQuery<HoursLog[]>({
    queryKey: ['hours-log-view', canSeeAll, profile?.id, month, year, clientId ?? 'all', canSeeAll ? employeeId : 'self'],
    enabled: !!profile?.id,
    queryFn: async () => {
      let q = supabase
        .from('hours_log')
        .select('*')
        .eq('month', month)
        .eq('year', year)
        .order('visit_date', { ascending: true })
      if (canSeeAll) {
        if (employeeId !== ALL_EMPLOYEES) q = q.eq('profile_id', employeeId)
      } else {
        q = q.eq('profile_id', profile!.id)
      }
      if (clientId) q = q.eq('client_id', clientId)
      const { data, error } = await q
      if (error) throw error
      return data as HoursLog[]
    },
  })

  const selectedClient = useMemo(
    () => permittedClients.find((c) => c.id === clientId) ?? null,
    [permittedClients, clientId],
  )

  const unbilledHours = useMemo(
    () => hoursData.filter((h) => !h.billed_transaction_id),
    [hoursData],
  )
  const totalHours = useMemo(
    () => hoursData.reduce((s, h) => s + (Number(h.hours) || 0), 0),
    [hoursData],
  )

  // Rows enriched with the employee display name so the עובד/ת column can sort
  // by name (not raw profile_id), then sorted by the active column.
  const sortedRows = useMemo(() => {
    const withNames = hoursData.map((h) => ({
      ...h,
      _employeeName: profileNameById.get(h.profile_id ?? '') ?? '',
    }))
    withNames.sort((a, b) => compareBySort(a, b, sort, (row, key) => (row as Record<string, unknown>)[key]))
    return withNames
  }, [hoursData, profileNameById, sort])
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
    mutationFn: async ({ id }, signal) => {
      const { error } = await supabase.from('hours_log').delete().eq('id', id).abortSignal(signal)
      if (error) throw error
    },
    invalidate: [['hours-log-view'], ['hours_log']],
    successHoldMs: 800,
    onSuccess: () => {
      setDeleteTarget(null)
      queryClient.invalidateQueries({ queryKey: ['hours-log-view'] })
    },
  })

  // Generate a time-period billing transaction + billing event from the
  // unbilled hours of the selected client (admin only — preserved from the
  // old ניהול שעות tab).
  const hoursBillingMut = useSafeMutation<void, void>({
    timeoutMs: 20000,
    mutationFn: async (_args, signal) => {
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
        .abortSignal(signal)
        .single()
      if (txnErr || !txn) throw txnErr ?? new Error('שגיאה ביצירת עסקה')

      const txnId = (txn as { id: string }).id

      const hourIds = unbilledHours.map((h) => h.id)
      if (hourIds.length > 0) {
        const { error: linkErr } = await supabase
          .from('hours_log')
          .update({ billed_transaction_id: txnId })
          .in('id', hourIds)
          .abortSignal(signal)
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
      }).abortSignal(signal)
      if (evtErr) throw evtErr
    },
    invalidate: [['transactions'], ['billing_events'], ['hours-log-view']],
    onSuccess: () => {
      setTimeout(() => setBillingDialogOpen(false), 1000)
    },
  })

  const clientFilter = (c: Client) => permittedClients.some((p) => p.id === c.id)

  return (
    <div className="space-y-4">
      <Card className="p-4 overflow-visible">
        <div className="flex items-end gap-3 flex-wrap">
          <div className="space-y-1 min-w-60 flex-1 relative z-50">
            <Label className="text-xs text-purple-700">לקוח</Label>
            <ClientPicker
              value={clientId}
              onChange={(id) => setClientId(id)}
              filter={clientFilter}
              placeholder={canSeeAll ? 'כל הלקוחות' : 'כל הלקוחות שלי'}
              allSentinelLabel={canSeeAll ? 'כל הלקוחות' : 'כל הלקוחות שלי'}
              emptyLabel="אין לקוחות מורשים"
            />
          </div>
          {canSeeAll && (
            <div className="space-y-1">
              <Label className="text-xs text-purple-700">עובד/ת</Label>
              <Select value={employeeId} onValueChange={(v) => setEmployeeId(v ?? ALL_EMPLOYEES)}>
                <SelectTrigger className="w-44">
                  <span className="line-clamp-1">
                    {employeeId === ALL_EMPLOYEES
                      ? 'כל העובדים'
                      : profileNameById.get(employeeId) ?? 'כל העובדים'}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_EMPLOYEES}>כל העובדים</SelectItem>
                  {employees.map((e) => (
                    <SelectItem key={e.id} value={e.id}>{e.full_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1">
            <Label className="text-xs text-purple-700">חודש</Label>
            <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
              <SelectTrigger className="w-32">
                <span className="text-sm truncate">{HEBREW_MONTHS[month - 1]}</span>
              </SelectTrigger>
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
              <SelectTrigger className="w-24">
                <span className="text-sm truncate">{year}</span>
              </SelectTrigger>
              <SelectContent>
                {YEAR_OPTIONS.map((y) => (
                  <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            onClick={() => { setEditing(null); setEntryOpen(true) }}
            className="bg-purple-600 hover:bg-purple-700 text-white"
            disabled={permittedClients.length === 0}
          >
            <Plus className="w-4 h-4 ml-1" />
            הוסף דיווח
          </Button>
          {isAdmin && clientId && (
            <Button
              onClick={() => setBillingDialogOpen(true)}
              variant="outline"
              className="border-amber-300 text-amber-700 hover:bg-amber-50"
              disabled={unbilledHours.length === 0 || !selectedClient?.hourly_rate}
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
            הפק דוח
          </Button>
        </div>
      </Card>

      <Card>
        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground">טוען...</div>
        ) : hoursData.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">אין דיווחים בחודש זה</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-purple-50">
                <SortableHead col="visit_date" label="תאריך" sort={sort} onToggle={toggleSort} />
                <SortableHead col="client_name" label="לקוח" sort={sort} onToggle={toggleSort} />
                {canSeeAll && <SortableHead col="_employeeName" label="עובד/ת" sort={sort} onToggle={toggleSort} />}
                <TableHead className="text-right text-purple-800">משעה</TableHead>
                <TableHead className="text-right text-purple-800">עד שעה</TableHead>
                <SortableHead col="hours" label="שעות" sort={sort} onToggle={toggleSort} />
                <TableHead className="text-right text-purple-800">תיאור</TableHead>
                <TableHead className="text-right text-purple-800">פעולות</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedRows.map((entry) => {
                const billed = !!entry.billed_transaction_id
                return (
                  <TableRow key={entry.id} className={billed ? 'bg-green-50/30' : 'hover:bg-purple-50/40'}>
                    <TableCell><DateCell value={entry.visit_date} /></TableCell>
                    <TableCell>{entry.client_name}</TableCell>
                    {canSeeAll && (
                      <TableCell>{entry.profile_id ? profileNameById.get(entry.profile_id) ?? '—' : '—'}</TableCell>
                    )}
                    <TableCell dir="ltr" className="text-right">{entry.start_time ?? '—'}</TableCell>
                    <TableCell dir="ltr" className="text-right">{entry.end_time ?? '—'}</TableCell>
                    <TableCell>{entry.hours}</TableCell>
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
                          title={billed ? 'נעול — חויב' : 'עריכה'}
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
            סה"כ שעות — {selectedClient ? `${selectedClient.name} · ` : ''}{monthLabel(month, year)}
          </span>
          <span className="text-lg font-bold text-purple-900">{totalHours.toFixed(2)} ש'</span>
        </div>
      </Card>

      <HoursEntryDialog
        open={entryOpen}
        onOpenChange={(open) => { setEntryOpen(open); if (!open) setEditing(null) }}
        clientFilter={clientFilter}
        presetClientId={editing ? null : clientId}
        presetClientName={editing ? null : selectedClient?.name ?? null}
        editing={editing}
        invalidate={[['hours-log-view']]}
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

      {isAdmin && (
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
      )}

      <HoursReportDialog
        open={reportOpen}
        onOpenChange={setReportOpen}
        presetClientId={clientId}
      />
    </div>
  )
}
