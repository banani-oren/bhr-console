import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Printer, Plus } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { Client, HoursLog, Profile } from '@/lib/types'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import ClientPicker from '@/components/ClientPicker'
import { DateInput } from '@/components/ui/date-input'
import TransactionDialog from '@/components/TransactionDialog'
import type { DialogInitial } from '@/components/TransactionDialog'
import { formatDate } from '@/lib/dates'
import { todayIso } from './common'

type EligibleProfile = Pick<Profile, 'id' | 'full_name' | 'role'>

export type HoursReportDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  presetClientId?: string | null
}

const ILS = (n: number) => new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS' }).format(n)
const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export default function HoursReportDialog({ open, onOpenChange, presetClientId }: HoursReportDialogProps) {
  const today = todayIso()
  const monthStart = new Date(new Date().setDate(1)).toISOString().slice(0, 10)

  const [clientId, setClientId] = useState<string | null>(presetClientId ?? null)
  const [periodStart, setPeriodStart] = useState<string>(monthStart)
  const [periodEnd, setPeriodEnd] = useState<string>(today)
  const [selectedEmployees, setSelectedEmployees] = useState<Set<string>>(new Set())
  const [txnDialogOpen, setTxnDialogOpen] = useState(false)
  const [txnInitial, setTxnInitial] = useState<DialogInitial | undefined>(undefined)

  // Reset to preset whenever dialog opens.
  useEffect(() => {
    if (open) {
      setClientId(presetClientId ?? null)
      setPeriodStart(monthStart)
      setPeriodEnd(today)
      setSelectedEmployees(new Set())
    }
  }, [open, presetClientId, monthStart, today])

  const { data: timeLogClients = [] } = useQuery<Client[]>({
    queryKey: ['hours-report-clients'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clients')
        .select('*')
        .eq('time_log_enabled', true)
        .order('name', { ascending: true })
      if (error) throw error
      return (data as Client[]) ?? []
    },
  })
  const selectedClient = useMemo(
    () => timeLogClients.find((c) => c.id === clientId) ?? null,
    [timeLogClients, clientId],
  )

  const { data: permittedProfiles = [] } = useQuery<EligibleProfile[]>({
    queryKey: ['hours-report-permitted-profiles', clientId],
    enabled: !!clientId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('client_time_log_permissions')
        .select('profile_id, profiles(id, full_name, role)')
        .eq('client_id', clientId)
      if (error) throw error
      const rows = (data as unknown as Array<{ profiles: EligibleProfile | EligibleProfile[] | null }> | null) ?? []
      return rows
        .flatMap((r) => (Array.isArray(r.profiles) ? r.profiles : r.profiles ? [r.profiles] : []))
        .filter(Boolean)
    },
  })

  const { data: entries = [] } = useQuery<HoursLog[]>({
    queryKey: ['hours-report-entries', clientId, periodStart, periodEnd, Array.from(selectedEmployees).sort().join(',')],
    enabled: !!clientId,
    queryFn: async () => {
      let q = supabase
        .from('hours_log')
        .select('*')
        .eq('client_id', clientId)
        .gte('visit_date', periodStart)
        .lte('visit_date', periodEnd)
        .order('visit_date', { ascending: true })
      if (selectedEmployees.size > 0) q = q.in('profile_id', Array.from(selectedEmployees))
      const { data, error } = await q
      if (error) throw error
      return data as HoursLog[]
    },
  })

  const { data: allProfiles = [] } = useQuery<EligibleProfile[]>({
    queryKey: ['profile-names'],
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('id, full_name, role')
      if (error) throw error
      return data as EligibleProfile[]
    },
  })
  const profileNameById = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of allProfiles) m.set(p.id, p.full_name)
    return m
  }, [allProfiles])

  const totalHours = entries.reduce((s, e) => s + (Number(e.hours) || 0), 0)
  const hourlyRate = selectedClient?.hourly_rate ?? 0
  const totalAmount = totalHours * hourlyRate

  const toggleEmployee = (id: string) => {
    setSelectedEmployees((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Browser-native print: open a styled RTL HTML document and auto-trigger the
  // print dialog. Renders Hebrew correctly with zero PDF dependencies.
  const handlePrint = () => {
    if (!selectedClient || entries.length === 0) return

    const rows = entries.map((e) => {
      const name = e.profile_id ? (profileNameById.get(e.profile_id) ?? '—') : '—'
      return `
        <tr>
          <td>${escapeHtml(formatDate(e.visit_date))}</td>
          <td dir="ltr">${escapeHtml(e.start_time ?? '—')}</td>
          <td dir="ltr">${escapeHtml(e.end_time ?? '—')}</td>
          <td>${e.hours ?? 0}</td>
          <td>${escapeHtml(e.description ?? '—')}</td>
          <td>${escapeHtml(name)}</td>
        </tr>`
    }).join('')

    const html = `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
  <meta charset="UTF-8">
  <title>דוח שעות – ${escapeHtml(selectedClient.name)}</title>
  <style>
    body { font-family: Arial, Helvetica, sans-serif; direction: rtl; margin: 32px; color: #111; }
    h1 { font-size: 20px; margin-bottom: 4px; }
    .meta { font-size: 13px; color: #555; margin-bottom: 24px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { background: #7c3aed; color: #fff; padding: 8px 10px; text-align: right; }
    td { border-bottom: 1px solid #e5e7eb; padding: 7px 10px; text-align: right; }
    tr:nth-child(even) td { background: #f9f7ff; }
    .totals { margin-top: 24px; font-size: 14px; text-align: left; }
    .totals strong { font-size: 16px; }
    @media print { body { margin: 16px; } }
  </style>
</head>
<body>
  <h1>דוח שעות</h1>
  <div class="meta">
    <span>לקוח: <strong>${escapeHtml(selectedClient.name)}</strong></span>&nbsp;&nbsp;
    <span>תקופה: ${escapeHtml(formatDate(periodStart))} – ${escapeHtml(formatDate(periodEnd))}</span>&nbsp;&nbsp;
    <span>תאריך הפקה: ${escapeHtml(formatDate(today))}</span>
  </div>
  <table>
    <thead>
      <tr>
        <th>תאריך</th><th>משעה</th><th>עד שעה</th>
        <th>שעות</th><th>תיאור</th><th>עובד/ת</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="totals">
    <div>סה"כ שעות: <strong>${totalHours.toFixed(2)}</strong></div>
    <div>תעריף שעה: <strong>${escapeHtml(ILS(hourlyRate))}</strong></div>
    <div>סך לתשלום: <strong>${escapeHtml(ILS(totalAmount))}</strong></div>
  </div>
  <script>window.onload = function() { window.print(); }<\/script>
</body>
</html>`

    const win = window.open('', '_blank')
    if (!win) return // popup blocked
    win.document.write(html)
    win.document.close()
  }

  const handleCreateTransaction = () => {
    if (!selectedClient) return
    setTxnInitial({
      kind: 'time_period',
      client_id: selectedClient.id,
      client_name: selectedClient.name,
      period_start: periodStart,
      period_end: periodEnd,
      hours_total: totalHours,
      hourly_rate_used: hourlyRate,
    })
    setTxnDialogOpen(true)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>הפק דוח שעות</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1">
            <Label className="text-xs text-purple-700">לקוח</Label>
            <ClientPicker
              value={clientId}
              onChange={(id) => setClientId(id)}
              filter={(c) => c.time_log_enabled}
              placeholder="חפש לקוח..."
              emptyLabel="אין לקוחות עם דיווח שעות"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-purple-700">מתאריך</Label>
              <DateInput value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-purple-700">עד תאריך</Label>
              <DateInput value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
            </div>
          </div>
          {permittedProfiles.length > 0 && (
            <div className="space-y-1">
              <Label className="text-xs text-purple-700">עובדים (ברירת מחדל: כל המורשים)</Label>
              <div className="flex flex-wrap gap-2">
                {permittedProfiles.map((p) => {
                  const active = selectedEmployees.has(p.id)
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => toggleEmployee(p.id)}
                      className={`px-3 py-1 text-xs rounded-full border ${
                        active ? 'bg-purple-600 text-white border-purple-600' : 'bg-muted/30 border-muted text-muted-foreground hover:bg-purple-50'
                      }`}
                    >
                      {p.full_name}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
          {selectedClient && (
            <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs flex flex-wrap gap-x-4 gap-y-1">
              <span><span className="text-muted-foreground">תעריף שעה:</span> <strong>{ILS(hourlyRate)}</strong></span>
              <span><span className="text-muted-foreground">סה"כ שעות:</span> <strong>{totalHours.toFixed(2)}</strong></span>
              <span><span className="text-muted-foreground">סך לתשלום:</span> <strong>{ILS(totalAmount)}</strong></span>
              <span><span className="text-muted-foreground">דיווחים:</span> <strong>{entries.length}</strong></span>
            </div>
          )}
        </div>
        <DialogFooter className="flex gap-2 flex-row-reverse">
          <Button
            onClick={handlePrint}
            disabled={!selectedClient || entries.length === 0}
            className="bg-purple-600 hover:bg-purple-700 text-white"
          >
            <Printer className="w-4 h-4 ml-1" />
            הדפסה / PDF
          </Button>
          <Button
            variant="outline"
            onClick={handleCreateTransaction}
            disabled={!selectedClient || entries.length === 0}
            className="border-purple-300 text-purple-700"
          >
            <Plus className="w-4 h-4 ml-1" />
            צור עסקה מהדוח
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>סגור</Button>
        </DialogFooter>
      </DialogContent>

      <TransactionDialog
        open={txnDialogOpen}
        onOpenChange={setTxnDialogOpen}
        editing={null}
        initial={txnInitial}
      />
    </Dialog>
  )
}
