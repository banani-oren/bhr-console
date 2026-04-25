import { useMemo, useState, useEffect } from 'react'
import { DateInput } from '@/components/ui/date-input'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, FileText, Plus, TriangleAlert } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import type { BillingReport, Client, HoursLog, Transaction } from '@/lib/types'
import type { ServiceType } from '@/lib/serviceTypes'
import {
  buildBillingReportPdf,
  uploadBillingReportPdf,
  signedUrl,
  formatCurrency,
} from '@/lib/pdf'
import ClientPicker from '@/components/ClientPicker'
import { DateCell } from '@/components/ui/date-cell'
import { formatDate } from '@/lib/dates'
import LabeledToggle from '@/components/LabeledToggle'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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

const WARN_ROW_THRESHOLD = 200

export default function BillingReports() {
  const queryClient = useQueryClient()
  const { profile } = useAuth()

  // Filter state (no required fields — every combination is valid).
  const [clientId, setClientId] = useState<string | null>(null)
  const [periodStart, setPeriodStart] = useState<string>('')
  const [periodEnd, setPeriodEnd] = useState<string>('')
  const [paymentStatusFilter, setPaymentStatusFilter] = useState<string>('all')
  const [includeService, setIncludeService] = useState<boolean>(true)
  const [includeTimePeriod, setIncludeTimePeriod] = useState<boolean>(true)
  const [showCandidates, setShowCandidates] = useState(false)
  const [selectedTxnIds, setSelectedTxnIds] = useState<Set<string>>(new Set())
  const [issueStatus, setIssueStatus] = useState<'idle' | 'issuing' | 'success' | 'error'>('idle')
  const [issueError, setIssueError] = useState<string | null>(null)
  const [broadWarningOpen, setBroadWarningOpen] = useState(false)

  const { data: clients = [] } = useQuery<Client[]>({
    queryKey: ['clients'],
    queryFn: async () => {
      const { data, error } = await supabase.from('clients').select('*').order('name', { ascending: true })
      if (error) throw error
      return data as Client[]
    },
  })
  const clientNameById = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of clients) m.set(c.id, c.name)
    return m
  }, [clients])
  const selectedClient = useMemo(
    () => clients.find((c) => c.id === clientId) ?? null,
    [clients, clientId],
  )

  const { data: serviceTypes = [] } = useQuery<ServiceType[]>({
    queryKey: ['service_types'],
    queryFn: async () => {
      const { data, error } = await supabase.from('service_types').select('*')
      if (error) throw error
      return data as ServiceType[]
    },
  })
  const serviceTypeNames = useMemo(() => {
    const m = new Map<string, string>()
    for (const s of serviceTypes) m.set(s.id, s.name)
    return m
  }, [serviceTypes])

  const { data: pastReports = [] } = useQuery<BillingReport[]>({
    queryKey: ['billing_reports'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('billing_reports')
        .select('*')
        .order('issued_at', { ascending: false })
      if (error) throw error
      return data as BillingReport[]
    },
  })

  // Candidate transactions based on the filter strip.
  const { data: candidates = [] } = useQuery<Transaction[]>({
    queryKey: [
      'br-candidates',
      clientId,
      periodStart || 'any',
      periodEnd || 'any',
      paymentStatusFilter,
      includeService,
      includeTimePeriod,
    ],
    enabled: showCandidates,
    queryFn: async () => {
      let q = supabase
        .from('transactions')
        .select('*')
        .eq('is_billable', true)
      if (clientId) q = q.eq('client_name', selectedClient?.name ?? '')
      if (paymentStatusFilter !== 'all') q = q.eq('payment_status', paymentStatusFilter)
      const { data, error } = await q
      if (error) throw error
      return (data as Transaction[]).filter((t) => {
        if (t.kind === 'service' && !includeService) return false
        if (t.kind === 'time_period' && !includeTimePeriod) return false
        if (periodStart || periodEnd) {
          const d = t.kind === 'service'
            ? (t.close_date ?? t.entry_date ?? null)
            : (t.period_end ?? null)
          if (!d) return false
          if (periodStart && d < periodStart) return false
          if (periodEnd && d > periodEnd) return false
        }
        return true
      })
    },
  })

  // IDs already included in earlier reports for the same scope. De-dup when
  // a single client is selected; for multi-client reports the admin can
  // still re-issue, so we skip the grey-out.
  const priorBilledIds = useMemo(() => {
    const ids = new Set<string>()
    if (!clientId) return ids
    for (const r of pastReports) {
      if (r.client_id !== clientId && r.filter_client_id !== clientId) continue
      for (const id of r.transaction_ids ?? []) ids.add(id)
    }
    return ids
  }, [pastReports, clientId])

  const selectableCandidates = useMemo(
    () => candidates.filter((t) => !priorBilledIds.has(t.id)),
    [candidates, priorBilledIds],
  )

  const onLoadCandidates = () => {
    setShowCandidates(true)
    setSelectedTxnIds(new Set())
    setIssueStatus('idle')
    setIssueError(null)
  }

  const toggleTxn = (id: string) => {
    setSelectedTxnIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  useEffect(() => {
    if (!showCandidates) return
    if (selectableCandidates.length === 0) return
    if (selectedTxnIds.size > 0) return
    setSelectedTxnIds(new Set(selectableCandidates.map((t) => t.id)))
  }, [selectableCandidates, showCandidates, selectedTxnIds.size])

  const totalSelected = useMemo(() => {
    return candidates
      .filter((t) => selectedTxnIds.has(t.id))
      .reduce((s, t) => s + (Number(t.net_invoice_amount) || 0), 0)
  }, [candidates, selectedTxnIds])

  const describeTxn = (t: Transaction): string => {
    if (t.kind === 'time_period') {
      return `דוח שעות ${t.period_start ?? ''} → ${t.period_end ?? ''}`
    }
    const sn = serviceTypeNames.get(t.service_type_id ?? '') ?? t.service_type ?? ''
    const extras = [t.position_name, t.candidate_name].filter(Boolean).join(' · ')
    return extras ? `${sn} · ${extras}` : sn
  }

  const handleIssueReportConfirmed = async () => {
    if (selectedTxnIds.size === 0) return
    setIssueStatus('issuing')
    setIssueError(null)
    try {
      const selected = candidates.filter((t) => selectedTxnIds.has(t.id))
      const total = selected.reduce((s, t) => s + (Number(t.net_invoice_amount) || 0), 0)

      const periodStartActual = periodStart || null
      const periodEndActual = periodEnd || null

      const { data: inserted, error: insErr } = await supabase
        .from('billing_reports')
        .insert({
          client_id: clientId,
          period_start: periodStartActual,
          period_end: periodEndActual,
          issued_by: profile?.id ?? null,
          transaction_ids: selected.map((t) => t.id),
          total_amount: total,
          filter_client_id: clientId,
          filter_period_start: periodStartActual,
          filter_period_end: periodEndActual,
          filter_payment_status: paymentStatusFilter === 'all' ? null : paymentStatusFilter,
          filter_include_service: includeService,
          filter_include_time_period: includeTimePeriod,
        })
        .select()
        .single()
      if (insErr || !inserted) throw insErr ?? new Error('insert failed')

      const report = inserted as BillingReport

      const timeIds = selected.filter((t) => t.kind === 'time_period').map((t) => t.id)
      const hoursByTxn = new Map<string, HoursLog[]>()
      if (timeIds.length > 0) {
        const { data: hours } = await supabase
          .from('hours_log')
          .select('*')
          .in('billed_transaction_id', timeIds)
          .order('visit_date', { ascending: true })
        for (const h of (hours as HoursLog[] | null) ?? []) {
          const arr = hoursByTxn.get(h.billed_transaction_id!) ?? []
          arr.push(h)
          hoursByTxn.set(h.billed_transaction_id!, arr)
        }
      }
      const { data: profiles } = await supabase.from('profiles').select('id, full_name')
      const profileNameById = new Map<string, string>()
      for (const p of (profiles as Array<{ id: string; full_name: string }> | null) ?? []) {
        profileNameById.set(p.id, p.full_name)
      }

      const doc = buildBillingReportPdf({
        report,
        client: selectedClient,
        clientNameById,
        transactions: selected,
        serviceTypeNames,
        hoursByTransaction: hoursByTxn,
        profileNameById,
      })
      const path = await uploadBillingReportPdf(report.id, doc)
      await supabase.from('billing_reports').update({ pdf_storage_path: path }).eq('id', report.id)

      queryClient.invalidateQueries({ queryKey: ['billing_reports'] })
      setIssueStatus('success')
      setSelectedTxnIds(new Set())
      setShowCandidates(false)

      const url = await signedUrl('billing-reports', path, 120)
      if (url) window.open(url, '_blank', 'noopener')
    } catch (err) {
      console.error('issue billing report error:', err)
      setIssueStatus('error')
      setIssueError(err instanceof Error ? err.message : 'שגיאה')
    }
  }

  const handleIssueReport = () => {
    // Broad-scope warning: neither client nor period set AND >200 rows.
    const broad = !clientId && !periodStart && !periodEnd
    if (broad && selectedTxnIds.size > WARN_ROW_THRESHOLD) {
      setBroadWarningOpen(true)
      return
    }
    handleIssueReportConfirmed()
  }

  const openReportPdf = async (r: BillingReport) => {
    if (!r.pdf_storage_path) return
    const url = await signedUrl('billing-reports', r.pdf_storage_path, 120)
    if (url) window.open(url, '_blank', 'noopener')
  }

  const kindBadge = (t: Transaction) =>
    t.kind === 'time_period' ? (
      <Badge className="bg-amber-50 text-amber-700 border-amber-200">שעות</Badge>
    ) : (
      <Badge className="bg-purple-50 text-purple-700 border-purple-200">שירות</Badge>
    )

  return (
    <div dir="rtl" className="p-6 space-y-4">
      <div className="flex items-center gap-2">
        <FileText className="w-6 h-6 text-purple-600" />
        <h1 className="text-2xl font-bold text-purple-900">דוחות חיוב</h1>
      </div>

      <Card className="p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
          <div className="space-y-1 lg:col-span-2">
            <Label className="text-purple-700 text-sm">לקוח</Label>
            <ClientPicker
              value={clientId}
              onChange={(id) => setClientId(id)}
              allSentinelLabel="כל הלקוחות"
              placeholder="חיפוש לקוח (אופציונלי)..."
            />
          </div>
          <div className="space-y-1">
            <Label className="text-purple-700 text-sm">מתאריך</Label>
            <DateInput value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-purple-700 text-sm">עד תאריך</Label>
            <DateInput value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="space-y-1">
            <Label className="text-purple-700 text-sm">סטטוס חיוב</Label>
            <Select value={paymentStatusFilter} onValueChange={(v) => setPaymentStatusFilter(v ?? 'all')}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">הכל</SelectItem>
                <SelectItem value="ממתין">ממתין</SelectItem>
                <SelectItem value="שולם">שולם</SelectItem>
                <SelectItem value="פיגור">פיגור</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <LabeledToggle
            label="שירותים"
            checked={includeService}
            onCheckedChange={setIncludeService}
            offText="לא"
            onText="כלול"
          />
          <LabeledToggle
            label="דיווחי שעות"
            checked={includeTimePeriod}
            onCheckedChange={setIncludeTimePeriod}
            offText="לא"
            onText="כלול"
          />
        </div>
        <Button
          onClick={onLoadCandidates}
          disabled={!includeService && !includeTimePeriod}
          className="bg-purple-600 hover:bg-purple-700 text-white"
        >
          הצג חיובים
        </Button>
      </Card>

      {showCandidates && (
        <Card>
          <div className="px-4 py-2 bg-purple-50 border-b text-sm font-semibold text-purple-800 flex items-center justify-between flex-wrap gap-2">
            <span>
              {selectedClient ? selectedClient.name : 'כל הלקוחות'} ·{' '}
              {periodStart || periodEnd
                ? `${formatDate(periodStart) || '—'} → ${formatDate(periodEnd) || '—'}`
                : 'כל התקופות'}
            </span>
            <span>
              {candidates.length === 0
                ? 'אין חיובים'
                : `${selectableCandidates.length} חיובים זמינים מתוך ${candidates.length}`}
            </span>
          </div>
          {candidates.length === 0 ? (
            <p className="p-6 text-center text-muted-foreground">אין חיובים שמתאימים לסינון.</p>
          ) : (
            <div className="max-h-[60vh] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8"></TableHead>
                    <TableHead className="text-right">לקוח</TableHead>
                    <TableHead className="text-right">סוג</TableHead>
                    <TableHead className="text-right">תיאור</TableHead>
                    <TableHead className="text-right">סטטוס</TableHead>
                    <TableHead className="text-right">תאריך</TableHead>
                    <TableHead className="text-right">סכום</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {candidates.map((t) => {
                    const prior = priorBilledIds.has(t.id)
                    const checked = selectedTxnIds.has(t.id)
                    const date = t.close_date ?? t.period_end ?? t.entry_date ?? ''
                    return (
                      <TableRow key={t.id} className={prior ? 'opacity-50 bg-muted/30' : ''}>
                        <TableCell className="w-8">
                          <input
                            type="checkbox"
                            checked={checked && !prior}
                            disabled={prior}
                            onChange={() => toggleTxn(t.id)}
                          />
                        </TableCell>
                        <TableCell className="font-medium">{t.client_name}</TableCell>
                        <TableCell>{kindBadge(t)}</TableCell>
                        <TableCell>
                          {describeTxn(t)}
                          {prior && (
                            <span className="ms-2 text-[10px] text-muted-foreground">(כלול בדוח קודם)</span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs">{t.payment_status}</TableCell>
                        <TableCell><DateCell value={date} /></TableCell>
                        <TableCell>{formatCurrency(Number(t.net_invoice_amount) || 0)}</TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
          {candidates.length > 0 && (
            <div className="p-3 border-t flex items-center justify-between flex-wrap gap-2">
              <div className="text-sm">
                <span className="text-muted-foreground">סך הכל לדוח:</span>{' '}
                <span className="font-semibold">{formatCurrency(totalSelected)}</span>
              </div>
              <div className="flex items-center gap-2">
                {issueStatus === 'success' && <span className="text-green-600 text-sm">דוח הופק ✓</span>}
                {issueStatus === 'error' && (
                  <span className="text-red-600 text-sm">{issueError ?? 'שגיאה'}</span>
                )}
                <Button
                  onClick={handleIssueReport}
                  disabled={selectedTxnIds.size === 0 || issueStatus === 'issuing'}
                  className="bg-purple-600 hover:bg-purple-700 text-white"
                >
                  <Plus className="h-4 w-4 ml-1" />
                  {issueStatus === 'issuing' ? 'מפיק...' : 'הפק דוח חיוב'}
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}

      <Card>
        <div className="px-4 py-2 bg-muted/40 border-b text-sm font-semibold">דוחות שהופקו</div>
        {pastReports.length === 0 ? (
          <p className="p-6 text-center text-muted-foreground text-sm">אין דוחות.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-right">לקוח</TableHead>
                <TableHead className="text-right">תקופה</TableHead>
                <TableHead className="text-right">פריטים</TableHead>
                <TableHead className="text-right">סכום</TableHead>
                <TableHead className="text-right">הופק</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pastReports.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">
                    {r.client_id ? clientNameById.get(r.client_id) ?? '—' : 'כל הלקוחות'}
                  </TableCell>
                  <TableCell>
                    {r.period_start || r.period_end
                      ? `${formatDate(r.period_start) || '—'} → ${formatDate(r.period_end) || '—'}`
                      : 'כל התקופות'}
                  </TableCell>
                  <TableCell>{r.transaction_ids?.length ?? 0}</TableCell>
                  <TableCell>{formatCurrency(r.total_amount)}</TableCell>
                  <TableCell><DateCell value={r.issued_at} /></TableCell>
                  <TableCell>
                    {r.pdf_storage_path && (
                      <Button size="sm" variant="ghost" onClick={() => openReportPdf(r)}>
                        <Download className="h-4 w-4 ml-1" /> הורד
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {/* Broad-scope warning */}
      <Dialog open={broadWarningOpen} onOpenChange={setBroadWarningOpen}>
        <DialogContent dir="rtl" className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <TriangleAlert className="w-5 h-5 text-amber-500" />
              דוח רחב היקף
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            אתה עומד להפיק דוח עם יותר מ-{WARN_ROW_THRESHOLD} שורות, ללא סינון לפי
            לקוח או תקופה. להמשיך?
          </p>
          <DialogFooter className="flex gap-2 flex-row-reverse">
            <Button
              onClick={() => {
                setBroadWarningOpen(false)
                handleIssueReportConfirmed()
              }}
              className="bg-purple-600 hover:bg-purple-700 text-white"
            >
              המשך
            </Button>
            <Button variant="outline" onClick={() => setBroadWarningOpen(false)}>ביטול</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
