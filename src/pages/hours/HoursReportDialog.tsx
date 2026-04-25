import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { Download, Plus } from 'lucide-react'
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
const labelHe = (s: string) => s.split('').reverse().join('')

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

  const generatePdf = (): jsPDF => {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' })
    doc.setFontSize(18)
    doc.text('BHR Console', 40, 50)
    doc.setFontSize(12)
    doc.text(labelHe('דוח שעות'), 555, 50, { align: 'right' })
    doc.setFontSize(10)
    doc.text(`${labelHe('לקוח')}: ${selectedClient?.name ?? ''}`, 555, 72, { align: 'right' })
    doc.text(`${labelHe('תקופה')}: ${formatDate(periodStart)} — ${formatDate(periodEnd)}`, 555, 88, { align: 'right' })
    doc.text(`${labelHe('תאריך הפקה')}: ${formatDate(today)}`, 555, 104, { align: 'right' })

    autoTable(doc, {
      startY: 130,
      head: [[
        labelHe('תאריך'), labelHe('משעה'), labelHe('עד שעה'),
        labelHe('שעות'), labelHe('תיאור'), labelHe('עובד/ת'),
      ]],
      body: entries.map((e) => [
        formatDate(e.visit_date),
        e.start_time ?? '—',
        e.end_time ?? '—',
        String(e.hours ?? 0),
        e.description ?? '—',
        e.profile_id ? profileNameById.get(e.profile_id) ?? '—' : '—',
      ]),
      styles: { font: 'helvetica', fontSize: 9, halign: 'right' },
      headStyles: { fillColor: [147, 51, 234], textColor: 255 },
    })

    const ph = doc.internal.pageSize.getHeight()
    doc.setFontSize(11)
    doc.text(`${labelHe('סה"כ שעות')}: ${totalHours.toFixed(2)}`, 555, ph - 80, { align: 'right' })
    doc.text(`${labelHe('תעריף שעה')}: ${ILS(hourlyRate)}`, 555, ph - 64, { align: 'right' })
    doc.setFontSize(13)
    doc.text(`${labelHe('סך לתשלום')}: ${ILS(totalAmount)}`, 555, ph - 44, { align: 'right' })
    return doc
  }

  const handleDownload = () => {
    if (!selectedClient) return
    const doc = generatePdf()
    doc.save(`hours-report-${selectedClient.name}-${periodStart}-${periodEnd}.pdf`)
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
            onClick={handleDownload}
            disabled={!selectedClient || entries.length === 0}
            className="bg-purple-600 hover:bg-purple-700 text-white"
          >
            <Download className="w-4 h-4 ml-1" />
            הפק דוח
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
