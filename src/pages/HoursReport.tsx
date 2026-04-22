import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FileText, Download, Plus } from 'lucide-react'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { supabase } from '@/lib/supabase'
import type { Client, HoursLog, Profile } from '@/lib/types'
import TransactionDialog from '@/components/TransactionDialog'
import type { DialogInitial } from '@/components/TransactionDialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

type EligibleProfile = Pick<Profile, 'id' | 'full_name' | 'role'>

export default function HoursReport() {
  const today = new Date().toISOString().slice(0, 10)

  const [clientId, setClientId] = useState<string>('')
  const [periodStart, setPeriodStart] = useState<string>(
    new Date(new Date().setDate(1)).toISOString().slice(0, 10),
  )
  const [periodEnd, setPeriodEnd] = useState<string>(today)
  const [selectedEmployees, setSelectedEmployees] = useState<Set<string>>(new Set())
  const [wizardOpen, setWizardOpen] = useState(false)
  const [wizardInitial, setWizardInitial] = useState<DialogInitial | undefined>(undefined)

  const { data: clients = [] } = useQuery<Client[]>({
    queryKey: ['clients'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clients')
        .select('*')
        .eq('time_log_enabled', true)
        .order('name', { ascending: true })
      if (error) throw error
      return data as Client[]
    },
  })

  const selectedClient = useMemo(
    () => clients.find((c) => c.id === clientId) ?? null,
    [clients, clientId],
  )

  const { data: permittedProfiles = [] } = useQuery<EligibleProfile[]>({
    queryKey: ['permitted-profiles', clientId],
    enabled: !!clientId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('client_time_log_permissions')
        .select('profile_id, profiles(id, full_name, role)')
        .eq('client_id', clientId)
      if (error) throw error
      const rows = (data as unknown as Array<{ profiles: EligibleProfile | EligibleProfile[] | null }> | null) ?? []
      return rows
        .flatMap((r) =>
          Array.isArray(r.profiles) ? r.profiles : r.profiles ? [r.profiles] : [],
        )
        .filter(Boolean)
    },
  })

  const { data: entries = [] } = useQuery<HoursLog[]>({
    queryKey: ['report-entries', clientId, periodStart, periodEnd, Array.from(selectedEmployees).sort().join(',')],
    enabled: !!clientId,
    queryFn: async () => {
      let q = supabase
        .from('hours_log')
        .select('*')
        .eq('client_id', clientId)
        .gte('visit_date', periodStart)
        .lte('visit_date', periodEnd)
        .order('visit_date', { ascending: true })
      if (selectedEmployees.size > 0) {
        q = q.in('profile_id', Array.from(selectedEmployees))
      }
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

  const totalHours = entries.reduce((s, e) => s + (e.hours ?? 0), 0)
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

  const formatCurrency = (n: number) =>
    new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS' }).format(n)

  const generatePdf = (): jsPDF => {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' })
    const label = (s: string) => s.split('').reverse().join('')

    // Header
    doc.setFontSize(18)
    doc.text('BHR Console', 40, 50)
    doc.setFontSize(12)
    doc.text(label('דוח שעות'), 555, 50, { align: 'right' })
    doc.setFontSize(10)
    doc.text(`${label('לקוח')}: ${selectedClient?.name ?? ''}`, 555, 72, { align: 'right' })
    doc.text(
      `${label('תקופה')}: ${periodStart} — ${periodEnd}`,
      555, 88, { align: 'right' },
    )
    doc.text(`${label('תאריך הפקה')}: ${today}`, 555, 104, { align: 'right' })

    autoTable(doc, {
      startY: 130,
      head: [[
        label('תאריך'),
        label('משעה'),
        label('עד שעה'),
        label('שעות'),
        label('תיאור'),
        label('עובד/ת'),
      ]],
      body: entries.map((e) => [
        e.visit_date,
        (e as unknown as { start_time?: string | null }).start_time ?? '—',
        (e as unknown as { end_time?: string | null }).end_time ?? '—',
        String(e.hours ?? 0),
        e.description ?? '—',
        e.profile_id ? profileNameById.get(e.profile_id) ?? '—' : '—',
      ]),
      styles: { font: 'helvetica', fontSize: 9, halign: 'right' },
      headStyles: { fillColor: [147, 51, 234], textColor: 255 },
    })

    // Footer totals
    const pageHeight = doc.internal.pageSize.getHeight()
    doc.setFontSize(11)
    doc.text(
      `${label('סה"כ שעות')}: ${totalHours.toFixed(2)}`,
      555, pageHeight - 80, { align: 'right' },
    )
    doc.text(
      `${label('תעריף שעה')}: ${formatCurrency(hourlyRate)}`,
      555, pageHeight - 64, { align: 'right' },
    )
    doc.setFontSize(13)
    doc.text(
      `${label('סך לתשלום')}: ${formatCurrency(totalAmount)}`,
      555, pageHeight - 44, { align: 'right' },
    )

    return doc
  }

  const handleDownload = () => {
    if (!selectedClient) return
    const doc = generatePdf()
    doc.save(`hours-report-${selectedClient.name}-${periodStart}-${periodEnd}.pdf`)
  }

  const handleCreateTransaction = () => {
    if (!selectedClient) return
    setWizardInitial({
      kind: 'time_period',
      client_id: selectedClient.id,
      client_name: selectedClient.name,
      period_start: periodStart,
      period_end: periodEnd,
      hours_total: totalHours,
      hourly_rate_used: hourlyRate,
    })
    setWizardOpen(true)
  }

  return (
    <div dir="rtl" className="p-6 space-y-4">
      <div className="flex items-center gap-2">
        <FileText className="w-6 h-6 text-purple-600" />
        <h1 className="text-2xl font-bold text-purple-900">הפקת דוח שעות</h1>
      </div>

      <Card className="p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="space-y-1">
            <Label className="text-purple-700">לקוח</Label>
            <Select value={clientId} onValueChange={(v) => setClientId(v ?? '')}>
              <SelectTrigger><SelectValue placeholder="בחר לקוח" /></SelectTrigger>
              <SelectContent>
                {clients.length === 0 ? (
                  <div className="p-2 text-xs text-muted-foreground">
                    אין לקוחות עם דיווח שעות מופעל
                  </div>
                ) : (
                  clients.map((c) => (<SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>))
                )}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-purple-700">מתאריך</Label>
            <Input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-purple-700">עד תאריך</Label>
            <Input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
          </div>
        </div>

        {permittedProfiles.length > 0 && (
          <div className="space-y-1">
            <Label className="text-purple-700">עובדים (ברירת מחדל: הכל)</Label>
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

        <div className="flex gap-2">
          <Button onClick={handleDownload} disabled={!selectedClient || entries.length === 0} className="bg-purple-600 hover:bg-purple-700 text-white">
            <Download className="w-4 h-4 ml-1" />
            שמור PDF
          </Button>
          <Button onClick={handleCreateTransaction} disabled={!selectedClient || entries.length === 0} variant="outline" className="border-purple-300 text-purple-700">
            <Plus className="w-4 h-4 ml-1" />
            צור עסקה מהדוח
          </Button>
        </div>
      </Card>

      {selectedClient && (
        <Card>
          <div className="p-4 border-b flex flex-wrap gap-6 text-sm">
            <div><span className="text-muted-foreground">לקוח:</span> <span className="font-semibold">{selectedClient.name}</span></div>
            <div><span className="text-muted-foreground">תעריף שעה:</span> <span className="font-semibold">{formatCurrency(hourlyRate)}</span></div>
            <div><span className="text-muted-foreground">סה"כ שעות:</span> <span className="font-semibold">{totalHours.toFixed(2)}</span></div>
            <div><span className="text-muted-foreground">סך לתשלום:</span> <span className="font-semibold">{formatCurrency(totalAmount)}</span></div>
          </div>
          {entries.length === 0 ? (
            <div className="p-8 text-center text-gray-400">אין דיווחי שעות בתקופה שנבחרה</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-purple-50">
                  <TableHead className="text-right text-purple-800 font-semibold">תאריך</TableHead>
                  <TableHead className="text-right text-purple-800 font-semibold">משעה</TableHead>
                  <TableHead className="text-right text-purple-800 font-semibold">עד שעה</TableHead>
                  <TableHead className="text-right text-purple-800 font-semibold">שעות</TableHead>
                  <TableHead className="text-right text-purple-800 font-semibold">תיאור</TableHead>
                  <TableHead className="text-right text-purple-800 font-semibold">עובד/ת</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="font-medium">{e.visit_date}</TableCell>
                    <TableCell dir="ltr">{(e as unknown as { start_time?: string | null }).start_time ?? '—'}</TableCell>
                    <TableCell dir="ltr">{(e as unknown as { end_time?: string | null }).end_time ?? '—'}</TableCell>
                    <TableCell>{e.hours}</TableCell>
                    <TableCell>{e.description ?? '—'}</TableCell>
                    <TableCell>{e.profile_id ? profileNameById.get(e.profile_id) ?? '—' : '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      )}

      <TransactionDialog
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        editing={null}
        initial={wizardInitial}
      />
    </div>
  )
}
