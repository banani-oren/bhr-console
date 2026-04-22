import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronsUpDown, Download, FileText, Plus, X } from 'lucide-react'
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
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

export default function BillingReports() {
  const queryClient = useQueryClient()
  const { profile } = useAuth()

  const todayIso = new Date().toISOString().slice(0, 10)
  const firstOfMonth = new Date()
  firstOfMonth.setDate(1)

  const [clientId, setClientId] = useState<string>('')
  const [clientQuery, setClientQuery] = useState('')
  const [clientOpen, setClientOpen] = useState(false)
  const [periodStart, setPeriodStart] = useState<string>(firstOfMonth.toISOString().slice(0, 10))
  const [periodEnd, setPeriodEnd] = useState<string>(todayIso)
  const [showCandidates, setShowCandidates] = useState(false)
  const [selectedTxnIds, setSelectedTxnIds] = useState<Set<string>>(new Set())
  const [issueStatus, setIssueStatus] = useState<'idle' | 'issuing' | 'success' | 'error'>('idle')
  const [issueError, setIssueError] = useState<string | null>(null)

  const { data: clients = [] } = useQuery<Client[]>({
    queryKey: ['clients'],
    queryFn: async () => {
      const { data, error } = await supabase.from('clients').select('*').order('name', { ascending: true })
      if (error) throw error
      return data as Client[]
    },
  })

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

  const selectedClient = useMemo(
    () => clients.find((c) => c.id === clientId) ?? null,
    [clients, clientId],
  )

  const filteredClients = useMemo(() => {
    const q = clientQuery.trim().toLowerCase()
    if (!q) return clients.slice(0, 10)
    return clients
      .filter((c) => c.name.toLowerCase().includes(q) || (c.company_id ?? '').toLowerCase().includes(q))
      .slice(0, 10)
  }, [clients, clientQuery])

  // Past reports for the list at the bottom.
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

  // Transactions eligible for this client + period.
  const { data: candidates = [] } = useQuery<Transaction[]>({
    queryKey: ['br-candidates', clientId, periodStart, periodEnd],
    enabled: showCandidates && !!clientId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('transactions')
        .select('*')
        .eq('client_name', selectedClient?.name ?? '')
        .eq('is_billable', true)
      if (error) throw error
      return (data as Transaction[]).filter((t) => {
        if (t.kind === 'service') {
          const d = t.close_date ?? t.entry_date
          return !!d && d >= periodStart && d <= periodEnd
        }
        if (t.kind === 'time_period') {
          return !!t.period_end && t.period_end >= periodStart && t.period_end <= periodEnd
        }
        return false
      })
    },
  })

  // IDs already included in earlier reports for this client.
  const priorBilledIds = useMemo(() => {
    const ids = new Set<string>()
    for (const r of pastReports) {
      if (r.client_id !== clientId) continue
      for (const id of r.transaction_ids ?? []) ids.add(id)
    }
    return ids
  }, [pastReports, clientId])

  const selectableCandidates = useMemo(
    () => candidates.filter((t) => !priorBilledIds.has(t.id)),
    [candidates, priorBilledIds],
  )

  // Auto-select all new candidates when candidates list loads.
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

  // When candidates first arrive, default all selectable to checked.
  useMemo(() => {
    if (!showCandidates) return
    if (selectableCandidates.length === 0) return
    if (selectedTxnIds.size > 0) return
    setSelectedTxnIds(new Set(selectableCandidates.map((t) => t.id)))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectableCandidates.length, showCandidates])

  const totalSelected = useMemo(() => {
    return candidates
      .filter((t) => selectedTxnIds.has(t.id))
      .reduce((s, t) => s + (Number(t.net_invoice_amount) || 0), 0)
  }, [candidates, selectedTxnIds])

  const kindBadge = (t: Transaction) =>
    t.kind === 'time_period' ? (
      <Badge className="bg-amber-50 text-amber-700 border-amber-200">שעות</Badge>
    ) : (
      <Badge className="bg-purple-50 text-purple-700 border-purple-200">שירות</Badge>
    )

  const describeTxn = (t: Transaction): string => {
    if (t.kind === 'time_period') {
      return `דוח שעות ${t.period_start ?? ''} → ${t.period_end ?? ''}`
    }
    const sn = serviceTypeNames.get(t.service_type_id ?? '') ?? t.service_type ?? ''
    const extras = [t.position_name, t.candidate_name].filter(Boolean).join(' · ')
    return extras ? `${sn} · ${extras}` : sn
  }

  const handleIssueReport = async () => {
    if (!selectedClient || selectedTxnIds.size === 0) return
    setIssueStatus('issuing')
    setIssueError(null)
    try {
      const selected = candidates.filter((t) => selectedTxnIds.has(t.id))
      const total = selected.reduce((s, t) => s + (Number(t.net_invoice_amount) || 0), 0)
      // Insert billing_reports row first to obtain an id.
      const { data: inserted, error: insErr } = await supabase
        .from('billing_reports')
        .insert({
          client_id: selectedClient.id,
          period_start: periodStart,
          period_end: periodEnd,
          issued_by: profile?.id ?? null,
          transaction_ids: selected.map((t) => t.id),
          total_amount: total,
        })
        .select()
        .single()
      if (insErr || !inserted) throw insErr ?? new Error('insert failed')

      const report = inserted as BillingReport

      // Fetch hours for any time_period transactions.
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

  const openReportPdf = async (r: BillingReport) => {
    if (!r.pdf_storage_path) return
    const url = await signedUrl('billing-reports', r.pdf_storage_path, 120)
    if (url) window.open(url, '_blank', 'noopener')
  }

  const clientNameById = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of clients) m.set(c.id, c.name)
    return m
  }, [clients])

  return (
    <div dir="rtl" className="p-6 space-y-4">
      <div className="flex items-center gap-2">
        <FileText className="w-6 h-6 text-purple-600" />
        <h1 className="text-2xl font-bold text-purple-900">דוחות חיוב</h1>
      </div>

      <Card className="p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
          <div className="space-y-1 md:col-span-2">
            <Label className="text-purple-700 text-sm">לקוח</Label>
            <div className="relative">
              <div className="flex items-center gap-2 border rounded-md px-3 py-2">
                <Input
                  className="border-0 focus-visible:ring-0 p-0 flex-1"
                  placeholder="חיפוש לקוח..."
                  value={clientId ? selectedClient?.name ?? '' : clientQuery}
                  onChange={(e) => {
                    setClientId('')
                    setClientQuery(e.target.value)
                    setClientOpen(true)
                  }}
                  onFocus={() => setClientOpen(true)}
                />
                {clientId ? (
                  <button
                    type="button"
                    onClick={() => { setClientId(''); setClientQuery(''); setClientOpen(true) }}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                ) : (
                  <ChevronsUpDown className="h-4 w-4 text-muted-foreground" />
                )}
              </div>
              {clientOpen && !clientId && (
                <div className="absolute z-10 left-0 right-0 mt-1 rounded-md border bg-popover shadow-md max-h-60 overflow-y-auto">
                  {filteredClients.length === 0 ? (
                    <div className="p-3 text-sm text-muted-foreground text-center">לא נמצאו לקוחות</div>
                  ) : (
                    filteredClients.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => { setClientId(c.id); setClientOpen(false); setClientQuery('') }}
                        className="w-full text-right px-3 py-2 hover:bg-purple-50"
                      >
                        <div className="text-sm font-medium">{c.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {c.company_id ?? '—'}
                        </div>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-purple-700 text-sm">מתאריך</Label>
            <Input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-purple-700 text-sm">עד תאריך</Label>
            <Input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
          </div>
        </div>
        <Button
          onClick={onLoadCandidates}
          disabled={!clientId}
          className="bg-purple-600 hover:bg-purple-700 text-white"
        >
          הצג חיובים
        </Button>
      </Card>

      {showCandidates && selectedClient && (
        <Card>
          <div className="px-4 py-2 bg-purple-50 border-b text-sm font-semibold text-purple-800 flex items-center justify-between">
            <span>{selectedClient.name} · {periodStart} → {periodEnd}</span>
            <span>
              {candidates.length === 0
                ? 'אין חיובים בתקופה שנבחרה'
                : `${selectableCandidates.length} חיובים זמינים מתוך ${candidates.length}`}
            </span>
          </div>
          {candidates.length === 0 ? (
            <p className="p-6 text-center text-muted-foreground">אין חיובים.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8"></TableHead>
                  <TableHead className="text-right">סוג</TableHead>
                  <TableHead className="text-right">תיאור</TableHead>
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
                    <TableRow
                      key={t.id}
                      className={prior ? 'opacity-50 bg-muted/30' : ''}
                    >
                      <TableCell className="w-8">
                        <input
                          type="checkbox"
                          checked={checked && !prior}
                          disabled={prior}
                          onChange={() => toggleTxn(t.id)}
                        />
                      </TableCell>
                      <TableCell>{kindBadge(t)}</TableCell>
                      <TableCell>
                        {describeTxn(t)}
                        {prior && (
                          <span className="ms-2 text-[10px] text-muted-foreground">(כלול בדוח קודם)</span>
                        )}
                      </TableCell>
                      <TableCell>{date}</TableCell>
                      <TableCell>{formatCurrency(Number(t.net_invoice_amount) || 0)}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
          {candidates.length > 0 && (
            <div className="p-3 border-t flex items-center justify-between">
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
                  <TableCell className="font-medium">{clientNameById.get(r.client_id) ?? '—'}</TableCell>
                  <TableCell>{r.period_start} → {r.period_end}</TableCell>
                  <TableCell>{r.transaction_ids?.length ?? 0}</TableCell>
                  <TableCell>{formatCurrency(r.total_amount)}</TableCell>
                  <TableCell>{new Date(r.issued_at).toISOString().slice(0, 10)}</TableCell>
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
    </div>
  )
}
