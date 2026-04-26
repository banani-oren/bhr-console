import { useEffect, useMemo, useState } from 'react'
import { DateInput } from '@/components/ui/date-input'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Clock, RefreshCw } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import type { Client, HoursLog, Profile, Transaction, TransactionKind } from '@/lib/types'
import {
  type ServiceField,
  type ServiceType,
  evalDerived,
} from '@/lib/serviceTypes'
import ClientPicker from '@/components/ClientPicker'
import LabeledToggle from '@/components/LabeledToggle'
import { DateCell } from '@/components/ui/date-cell'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
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

const HEBREW_MONTHS = [
  'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
]

const MIRRORED_KEYS = new Set([
  'position_name',
  'candidate_name',
  'commission_percent',
  'salary',
  'net_invoice_amount',
  'commission_amount',
  'service_lead',
])

export type DialogInitial = {
  kind?: TransactionKind
  service_type_id?: string | null
  client_id?: string | null
  client_name?: string
  period_start?: string
  period_end?: string
  hours_total?: number
  hourly_rate_used?: number
  custom?: Record<string, unknown>
}

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  editing: Transaction | null
  initial?: DialogInitial
  onSaved?: (id: string) => void
}

type DialogState = {
  kind: TransactionKind
  service_type_id: string | null
  service_type_name: string
  client_id: string | null
  client_name: string
  service_lead: string
  entry_date: string
  close_date: string | null
  payment_status: string
  is_billable: boolean
  invoice_number_transaction: string | null
  invoice_number_receipt: string | null
  work_start_date: string | null
  warranty_end_date: string | null
  invoice_sent_date: string | null
  payment_due_date: string | null
  payment_date: string | null
  notes: string | null
  custom: Record<string, unknown>

  // time_period-specific
  period_start: string | null
  period_end: string | null
  hours_total: number | null
  hourly_rate_used: number | null
  net_invoice_amount: number | null
  selectedHoursIds: Set<string>
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function parsePaymentTermDays(terms: string | null): number | null {
  if (!terms) return null
  const m = /([0-9]+)/.exec(terms)
  if (!m) return terms.includes('שוטף') ? 0 : null
  return Number(m[1])
}

function addDays(iso: string | null, days: number | null): string | null {
  if (!iso || days == null) return null
  const d = new Date(iso)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

function monthOf(iso: string | null): number | null {
  if (!iso) return null
  return new Date(iso).getMonth() + 1
}

function yearOf(iso: string | null): number | null {
  if (!iso) return null
  return new Date(iso).getFullYear()
}

function emptyState(profileName: string): DialogState {
  return {
    kind: 'service',
    service_type_id: null,
    service_type_name: '',
    client_id: null,
    client_name: '',
    service_lead: profileName || '',
    entry_date: today(),
    close_date: null,
    payment_status: 'ממתין',
    is_billable: true,
    invoice_number_transaction: null,
    invoice_number_receipt: null,
    work_start_date: null,
    warranty_end_date: null,
    invoice_sent_date: null,
    payment_due_date: null,
    payment_date: null,
    notes: null,
    custom: {},
    period_start: null,
    period_end: null,
    hours_total: null,
    hourly_rate_used: null,
    net_invoice_amount: null,
    selectedHoursIds: new Set(),
  }
}

function fmt(n: number | null | undefined): string {
  if (n == null) return '—'
  return new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS' }).format(n)
}

export default function TransactionDialog({
  open,
  onOpenChange,
  editing,
  initial,
  onSaved,
}: Props) {
  const queryClient = useQueryClient()
  const { profile } = useAuth()

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
      const { data, error } = await supabase.from('service_types').select('*').order('display_order', { ascending: true })
      if (error) throw error
      return data as ServiceType[]
    },
  })

  const { data: employees = [] } = useQuery<Profile[]>({
    queryKey: ['employees-picker'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .in('role', ['admin', 'recruiter', 'administration'])
        .order('full_name', { ascending: true })
      if (error) throw error
      return data as Profile[]
    },
  })

  const [state, setState] = useState<DialogState>(() => emptyState(profile?.full_name ?? ''))
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle')

  const selectedClient = useMemo(
    () => clients.find((c) => c.id === state.client_id) ?? null,
    [clients, state.client_id],
  )

  const selectedServiceType = useMemo(
    () => serviceTypes.find((s) => s.id === state.service_type_id) ?? null,
    [serviceTypes, state.service_type_id],
  )

  // Initialize when dialog opens.
  useEffect(() => {
    if (!open) return
    setSaveStatus('idle')
    if (editing) {
      const custom = typeof editing.custom_fields === 'object' && editing.custom_fields
        ? { ...(editing.custom_fields as Record<string, unknown>) }
        : {}
      for (const k of MIRRORED_KEYS) {
        const col = (editing as unknown as Record<string, unknown>)[k]
        if (col != null && custom[k] == null) custom[k] = col
      }
      setState({
        kind: editing.kind ?? 'service',
        service_type_id: editing.service_type_id,
        service_type_name: editing.service_type ?? '',
        client_id: clients.find((c) => c.name === editing.client_name)?.id ?? null,
        client_name: editing.client_name ?? '',
        service_lead: editing.service_lead ?? profile?.full_name ?? '',
        entry_date: editing.entry_date ?? today(),
        close_date: editing.close_date,
        payment_status: editing.payment_status ?? 'ממתין',
        is_billable: editing.is_billable ?? true,
        invoice_number_transaction: editing.invoice_number_transaction ?? editing.invoice_number ?? null,
        invoice_number_receipt: editing.invoice_number_receipt,
        work_start_date: editing.work_start_date,
        warranty_end_date: editing.warranty_end_date,
        invoice_sent_date: editing.invoice_sent_date,
        payment_due_date: editing.payment_due_date,
        payment_date: editing.payment_date,
        notes: editing.notes,
        custom,
        period_start: editing.period_start,
        period_end: editing.period_end,
        hours_total: editing.hours_total,
        hourly_rate_used: editing.hourly_rate_used,
        net_invoice_amount: editing.net_invoice_amount,
        selectedHoursIds: new Set(),
      })
    } else {
      const s = emptyState(profile?.full_name ?? '')
      if (initial) {
        s.kind = initial.kind ?? s.kind
        s.service_type_id = initial.service_type_id ?? null
        s.client_id = initial.client_id ?? null
        s.client_name = initial.client_name ?? ''
        s.period_start = initial.period_start ?? null
        s.period_end = initial.period_end ?? null
        s.hours_total = initial.hours_total ?? null
        s.hourly_rate_used = initial.hourly_rate_used ?? null
        if (initial.custom) s.custom = { ...s.custom, ...initial.custom }
      }
      setState(s)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing?.id])

  // Hydrate from client selection.
  useEffect(() => {
    if (!selectedClient) return
    setState((s) => {
      const next = { ...s, client_name: selectedClient.name }
      if (next.custom.commission_percent == null && selectedClient.commission_percent != null) {
        next.custom = { ...next.custom, commission_percent: selectedClient.commission_percent }
      }
      if (
        next.kind === 'time_period' &&
        next.hourly_rate_used == null &&
        selectedClient.hourly_rate != null
      ) {
        next.hourly_rate_used = selectedClient.hourly_rate
      }
      return next
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClient?.id])

  // Derived fields recompute when sources change.
  useEffect(() => {
    if (!selectedServiceType) return
    setState((s) => {
      let custom = { ...s.custom }
      let changed = false
      for (const f of selectedServiceType.fields) {
        if (!f.derived) continue
        const val = evalDerived(
          f.derived,
          custom as Record<string, unknown>,
          selectedClient as unknown as Record<string, unknown> | null,
        )
        if (val != null && custom[f.key] !== val) {
          custom = { ...custom, [f.key]: val as unknown }
          changed = true
        }
      }
      // Warranty end date derived from work_start_date + client.warranty_days.
      if (s.work_start_date && selectedClient?.warranty_days) {
        const d = addDays(s.work_start_date, selectedClient.warranty_days)
        if (d && s.warranty_end_date !== d) {
          return { ...s, custom, warranty_end_date: d }
        }
      }
      return changed ? { ...s, custom } : s
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selectedServiceType?.id,
    JSON.stringify(state.custom),
    state.work_start_date,
    selectedClient?.warranty_days,
  ])

  // Payment-due derived from invoice_sent_date + client.payment_terms.
  useEffect(() => {
    if (!state.invoice_sent_date || !selectedClient?.payment_terms) return
    const days = parsePaymentTermDays(selectedClient.payment_terms)
    if (days == null) return
    const due = addDays(state.invoice_sent_date, days)
    if (due && state.payment_due_date !== due) {
      setState((s) => ({ ...s, payment_due_date: due }))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.invoice_sent_date, selectedClient?.payment_terms])

  // --- time_period: unbilled hours preview ---
  const shouldFetchHours =
    state.kind === 'time_period' && !!state.client_id && !!state.period_start && !!state.period_end
  const { data: unbilledHours = [] } = useQuery<HoursLog[]>({
    queryKey: ['unbilled-hours', state.client_id, state.period_start, state.period_end, editing?.id],
    enabled: shouldFetchHours,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('hours_log')
        .select('*')
        .eq('client_id', state.client_id)
        .gte('visit_date', state.period_start!)
        .lte('visit_date', state.period_end!)
        .or(`billed_transaction_id.is.null${editing?.id ? `,billed_transaction_id.eq.${editing.id}` : ''}`)
        .order('visit_date', { ascending: true })
      if (error) throw error
      return data as HoursLog[]
    },
  })

  useEffect(() => {
    if (state.kind !== 'time_period') return
    // Default all unbilled hours checked; editing: default to currently-billed rows + any unbilled.
    setState((s) => {
      if (unbilledHours.length === 0 && s.selectedHoursIds.size === 0) return s
      const next = new Set<string>(s.selectedHoursIds)
      let changed = false
      for (const h of unbilledHours) {
        if (!next.has(h.id)) {
          next.add(h.id)
          changed = true
        }
      }
      return changed ? { ...s, selectedHoursIds: next } : s
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unbilledHours.length, state.kind])

  // Recompute hours_total + amount when selection or rate changes.
  useEffect(() => {
    if (state.kind !== 'time_period') return
    const rows = unbilledHours.filter((h) => state.selectedHoursIds.has(h.id))
    const total = rows.reduce((s, h) => s + (h.hours ?? 0), 0)
    const amount = state.hourly_rate_used != null ? total * state.hourly_rate_used : null
    setState((s) => {
      if (s.hours_total === total && s.net_invoice_amount === amount) return s
      return { ...s, hours_total: total, net_invoice_amount: amount }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.kind, state.hourly_rate_used, state.selectedHoursIds, unbilledHours])

  const setCustom = (key: string, val: unknown) => {
    setState((s) => ({ ...s, custom: { ...s.custom, [key]: val } }))
  }

  const pickKind = (kind: TransactionKind, serviceTypeId?: string | null) => {
    setState((s) => ({
      ...s,
      kind,
      service_type_id: kind === 'service' ? (serviceTypeId ?? null) : null,
      service_type_name: kind === 'service'
        ? serviceTypes.find((st) => st.id === serviceTypeId)?.name ?? ''
        : '',
    }))
  }

  const missingFields = (): string[] => {
    const m: string[] = []
    if (!state.client_id) m.push('לקוח')
    if (state.kind === 'service') {
      if (!state.service_type_id) m.push('סוג שירות')
      if (selectedServiceType) {
        for (const f of selectedServiceType.fields) {
          if (f.required && (state.custom[f.key] == null || state.custom[f.key] === '')) {
            m.push(f.label)
          }
        }
      }
    }
    if (state.kind === 'time_period') {
      if (!state.period_start) m.push('תחילת תקופה')
      if (!state.period_end) m.push('סוף תקופה')
      if (state.hourly_rate_used == null) m.push('תעריף שעה')
    }
    return m
  }
  const missing = missingFields()

  const handleSave = async () => {
    if (missing.length > 0) return
    setSaveStatus('saving')
    try {
      const mirrored: Record<string, unknown> = {}
      for (const k of MIRRORED_KEYS) {
        if (state.custom[k] !== undefined) mirrored[k] = state.custom[k]
      }
      const payload: Record<string, unknown> = {
        kind: state.kind,
        client_name: state.client_name,
        service_type: state.service_type_name,
        service_type_id: state.service_type_id,
        service_lead: state.service_lead || null,
        entry_date: state.entry_date,
        billing_month: monthOf(state.entry_date) ?? 1,
        billing_year: yearOf(state.entry_date) ?? new Date().getFullYear(),
        close_date: state.close_date,
        closing_month: monthOf(state.close_date),
        closing_year: yearOf(state.close_date),
        payment_date: state.payment_date,
        payment_status: state.payment_status,
        is_billable: state.is_billable,
        invoice_number: state.invoice_number_transaction,
        invoice_number_transaction: state.invoice_number_transaction,
        invoice_number_receipt: state.invoice_number_receipt,
        work_start_date: state.work_start_date,
        warranty_end_date: state.warranty_end_date,
        invoice_sent_date: state.invoice_sent_date,
        payment_due_date: state.payment_due_date,
        notes: state.notes,
        custom_fields: state.custom,
        ...mirrored,
      }
      if (state.kind === 'time_period') {
        payload.period_start = state.period_start
        payload.period_end = state.period_end
        payload.hours_total = state.hours_total
        payload.hourly_rate_used = state.hourly_rate_used
        payload.net_invoice_amount = state.net_invoice_amount
        // close_date defaults to period_end.
        if (!payload.close_date) payload.close_date = state.period_end
        if (!payload.closing_month) payload.closing_month = monthOf(state.period_end)
        if (!payload.closing_year) payload.closing_year = yearOf(state.period_end)
      }
      for (const k of ['commission_percent', 'salary', 'net_invoice_amount', 'commission_amount']) {
        if (payload[k] !== undefined && payload[k] !== null && payload[k] !== '') {
          payload[k] = Number(payload[k])
        }
      }

      let txnId: string | null = editing?.id ?? null
      if (editing) {
        const { error } = await supabase.from('transactions').update(payload).eq('id', editing.id)
        if (error) throw error
      } else {
        const { data, error } = await supabase.from('transactions').insert(payload).select('id').single()
        if (error) throw error
        txnId = (data as { id: string } | null)?.id ?? null
      }

      // time_period: mark selected hours_log rows as billed.
      if (state.kind === 'time_period' && txnId) {
        // First, clear prior billing for rows no longer selected (edit scenario).
        if (editing?.id) {
          const stillSelected = Array.from(state.selectedHoursIds)
          await supabase
            .from('hours_log')
            .update({ billed_transaction_id: null })
            .eq('billed_transaction_id', editing.id)
            .not('id', 'in', `(${stillSelected.map((i) => `"${i}"`).join(',') || `""`})`)
        }
        const ids = Array.from(state.selectedHoursIds)
        if (ids.length > 0) {
          await supabase.from('hours_log').update({ billed_transaction_id: txnId }).in('id', ids)
        }
      }

      queryClient.invalidateQueries({ queryKey: ['transactions'] })
      queryClient.invalidateQueries({ queryKey: ['hours_log'] })
      queryClient.invalidateQueries({ queryKey: ['unbilled-hours'] })
      setSaveStatus('success')
      setTimeout(() => {
        setSaveStatus('idle')
        onOpenChange(false)
        if (txnId) onSaved?.(txnId)
      }, 1200)
    } catch (err) {
      console.error('TransactionDialog save error:', err)
      setSaveStatus('error')
    }
  }

  const renderField = (f: ServiceField) => {
    const value = state.custom[f.key]
    const widthCls = f.width === 'full' ? 'md:col-span-2' : ''
    const label = `${f.label}${f.required ? ' *' : ''}${f.derived ? ' 🔄' : ''}`
    const wrap = (child: React.ReactNode) => (
      <div key={f.key} className={`space-y-1 ${widthCls}`}>
        <Label className="text-purple-700">{label}</Label>
        {child}
      </div>
    )
    const inputProps = {
      disabled: !!f.derived,
    }
    switch (f.type) {
      case 'text':
        return wrap(
          <Input value={(value as string) ?? ''} onChange={(e) => setCustom(f.key, e.target.value)} {...inputProps} />,
        )
      case 'textarea':
        return wrap(
          <Textarea value={(value as string) ?? ''} onChange={(e) => setCustom(f.key, e.target.value)} rows={2} {...inputProps} />,
        )
      case 'number':
      case 'currency':
      case 'percent':
        return wrap(
          <Input
            type="number"
            dir="ltr"
            value={(value as number | string | undefined) ?? ''}
            onChange={(e) => setCustom(f.key, e.target.value === '' ? null : Number(e.target.value))}
            {...inputProps}
          />,
        )
      case 'date':
        return wrap(
          <DateInput
            value={(value as string) ?? ''}
            onChange={(e) => setCustom(f.key, e.target.value || null)}
            {...inputProps}
          />,
        )
      case 'month':
        return wrap(
          <Select
            value={value != null ? String(value) : 'none'}
            onValueChange={(v) => setCustom(f.key, v === 'none' ? null : Number(v))}
            disabled={!!f.derived}
          >
            <SelectTrigger><SelectValue placeholder="בחר חודש" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">לא נבחר</SelectItem>
              {HEBREW_MONTHS.map((n, i) => <SelectItem key={i + 1} value={String(i + 1)}>{n}</SelectItem>)}
            </SelectContent>
          </Select>,
        )
      case 'year':
        return wrap(
          <Input
            type="number"
            dir="ltr"
            value={(value as number | string | undefined) ?? ''}
            onChange={(e) => setCustom(f.key, e.target.value === '' ? null : Number(e.target.value))}
            {...inputProps}
          />,
        )
      case 'select':
        return wrap(
          <Select value={(value as string) ?? ''} onValueChange={(v) => setCustom(f.key, v)} disabled={!!f.derived}>
            <SelectTrigger><SelectValue placeholder="בחר" /></SelectTrigger>
            <SelectContent>
              {(f.options ?? []).map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
            </SelectContent>
          </Select>,
        )
      case 'boolean':
        return wrap(
          <div className="flex items-center gap-2 pt-1">
            <Switch checked={!!value} onCheckedChange={(v) => setCustom(f.key, v)} disabled={!!f.derived} />
            <span className="text-sm text-gray-600">{value ? 'כן' : 'לא'}</span>
          </div>,
        )
      case 'employee':
        return wrap(
          <Select value={(value as string) ?? ''} onValueChange={(v) => setCustom(f.key, v)}>
            <SelectTrigger><SelectValue placeholder="בחר עובד/ת" /></SelectTrigger>
            <SelectContent>
              {employees.map((e) => (
                <SelectItem key={e.id} value={e.full_name}>{e.full_name}</SelectItem>
              ))}
            </SelectContent>
          </Select>,
        )
    }
  }

  const isTimePeriod = state.kind === 'time_period'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-6xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {editing ? 'עריכת עסקה' : 'הוספת עסקה'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          {/* Kind pills */}
          <section className="space-y-2">
            <Label className="text-purple-700 text-sm">סוג</Label>
            <div className="flex items-center gap-2 flex-wrap">
              {serviceTypes.map((st) => {
                const active = state.kind === 'service' && state.service_type_id === st.id
                return (
                  <button
                    key={st.id}
                    type="button"
                    onClick={() => pickKind('service', st.id)}
                    className={`px-4 py-1.5 rounded-full border text-sm ${
                      active
                        ? 'bg-purple-600 text-white border-purple-600'
                        : 'bg-white text-purple-700 border-purple-200 hover:bg-purple-50'
                    }`}
                  >
                    {st.name}
                  </button>
                )
              })}
              <div className="w-px h-6 bg-purple-200 mx-1" />
              <button
                type="button"
                onClick={() => pickKind('time_period')}
                className={`px-4 py-1.5 rounded-full border text-sm flex items-center gap-1 ${
                  isTimePeriod
                    ? 'bg-amber-500 text-white border-amber-500'
                    : 'bg-amber-50 text-amber-700 border-amber-300 hover:bg-amber-100'
                }`}
              >
                <Clock className="h-4 w-4" />
                דיווח שעות
              </button>
            </div>
          </section>

          {/* Client autocomplete (Batch 4 A1: centralized ClientPicker) */}
          <section className="space-y-2">
            <Label className="text-purple-700 text-sm">לקוח</Label>
            <ClientPicker
              value={state.client_id}
              onChange={(id, c) =>
                setState((s) => ({ ...s, client_id: id, client_name: c?.name ?? '' }))
              }
              placeholder="חיפוש לקוח לפי שם או ח.פ. ..."
            />
            {selectedClient && (
              <p className="text-[11px] text-muted-foreground">
                מתוך פרטי הלקוח:{' '}
                {selectedClient.commission_percent != null && <span>עמלה {selectedClient.commission_percent}% · </span>}
                {selectedClient.warranty_days != null && <span>אחריות {selectedClient.warranty_days} ימים · </span>}
                {selectedClient.payment_terms && <span>תנאי תשלום {selectedClient.payment_terms} · </span>}
                {selectedClient.hourly_rate != null && <span>תעריף שעה {fmt(selectedClient.hourly_rate)}</span>}
              </p>
            )}
          </section>

          {/* Auto-fields */}
          <Card className="p-3">
            <h3 className="text-sm font-semibold text-purple-700 mb-2">שדות אוטומטיים (ניתן לערוך)</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">מוביל שירות</Label>
                <Select value={state.service_lead ?? ''} onValueChange={(v) => setState((s) => ({ ...s, service_lead: v ?? '' }))}>
                  <SelectTrigger><SelectValue placeholder="בחר" /></SelectTrigger>
                  <SelectContent>
                    {employees.map((e) => (
                      <SelectItem key={e.id} value={e.full_name}>{e.full_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">תאריך פתיחה</Label>
                <DateInput
                  value={state.entry_date}
                  onChange={(e) => setState((s) => ({ ...s, entry_date: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">תאריך סגירה</Label>
                <DateInput
                  value={state.close_date ?? ''}
                  onChange={(e) => setState((s) => ({ ...s, close_date: e.target.value || null }))}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">סטטוס תשלום</Label>
                <Select value={state.payment_status} onValueChange={(v) => setState((s) => ({ ...s, payment_status: v ?? 'ממתין' }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ממתין">ממתין</SelectItem>
                    <SelectItem value="שולם">שולם</SelectItem>
                    <SelectItem value="פיגור">פיגור</SelectItem>
                    <SelectItem value="ללא חיוב">ללא חיוב</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1 flex flex-col justify-center">
                <LabeledToggle
                  label="חיוב"
                  checked={state.is_billable}
                  onCheckedChange={(v) => setState((s) => ({ ...s, is_billable: v }))}
                  offText="ללא חיוב"
                  onText="לחיוב"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">תאריך תחילת עבודה</Label>
                <DateInput
                  value={state.work_start_date ?? ''}
                  onChange={(e) => setState((s) => ({ ...s, work_start_date: e.target.value || null }))}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs flex items-center gap-1">
                  תאריך תום אחריות
                  <button
                    type="button"
                    onClick={() => {
                      const d = addDays(state.work_start_date, selectedClient?.warranty_days ?? null)
                      setState((s) => ({ ...s, warranty_end_date: d }))
                    }}
                    className="text-purple-500 hover:text-purple-700"
                    title="חשב מחדש מתאריך תחילת עבודה + תקופת אחריות"
                  >
                    <RefreshCw className="h-3 w-3" />
                  </button>
                </Label>
                <DateInput
                  value={state.warranty_end_date ?? ''}
                  onChange={(e) => setState((s) => ({ ...s, warranty_end_date: e.target.value || null }))}
                />
              </div>
            </div>
          </Card>

          {/* Kind-specific fields */}
          <Card className="p-3">
            <h3 className="text-sm font-semibold text-purple-700 mb-2">שדות ייחודיים</h3>
            {!isTimePeriod && selectedServiceType && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {selectedServiceType.fields.map(renderField)}
              </div>
            )}
            {!isTimePeriod && !selectedServiceType && (
              <p className="text-sm text-muted-foreground">בחר סוג שירות כדי להציג שדות.</p>
            )}
            {isTimePeriod && (
              <TimePeriodForm
                state={state}
                setState={setState}
                unbilledHours={unbilledHours}
                selectedClient={selectedClient}
                employees={employees}
              />
            )}
          </Card>

          {/* Invoicing & payment */}
          <Card className="p-3">
            <h3 className="text-sm font-semibold text-purple-700 mb-2">חשבונית ותשלום</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">חשבונית עסקה</Label>
                <Input
                  value={state.invoice_number_transaction ?? ''}
                  onChange={(e) =>
                    setState((s) => ({ ...s, invoice_number_transaction: e.target.value || null }))
                  }
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">חשבונית מס קבלה</Label>
                <Input
                  value={state.invoice_number_receipt ?? ''}
                  onChange={(e) =>
                    setState((s) => ({ ...s, invoice_number_receipt: e.target.value || null }))
                  }
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">תאריך שליחת חשבונית</Label>
                <DateInput
                  value={state.invoice_sent_date ?? ''}
                  onChange={(e) => setState((s) => ({ ...s, invoice_sent_date: e.target.value || null }))}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs flex items-center gap-1">
                  מועד לתשלום
                  <button
                    type="button"
                    onClick={() => {
                      const days = parsePaymentTermDays(selectedClient?.payment_terms ?? null)
                      const d = addDays(state.invoice_sent_date, days)
                      setState((s) => ({ ...s, payment_due_date: d }))
                    }}
                    className="text-purple-500 hover:text-purple-700"
                    title="חשב מחדש מתאריך שליחה + תנאי תשלום"
                  >
                    <RefreshCw className="h-3 w-3" />
                  </button>
                </Label>
                <DateInput
                  value={state.payment_due_date ?? ''}
                  onChange={(e) => setState((s) => ({ ...s, payment_due_date: e.target.value || null }))}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">תאריך תשלום בפועל</Label>
                <DateInput
                  value={state.payment_date ?? ''}
                  onChange={(e) => setState((s) => ({ ...s, payment_date: e.target.value || null }))}
                />
              </div>
              <div className="space-y-1 md:col-span-2">
                <Label className="text-xs">הערות</Label>
                <Textarea
                  value={state.notes ?? ''}
                  onChange={(e) => setState((s) => ({ ...s, notes: e.target.value || null }))}
                  rows={2}
                />
              </div>
            </div>
          </Card>
        </div>

        <DialogFooter className="flex flex-col gap-2">
          {saveStatus === 'success' && <p className="text-green-600 text-sm text-right">נשמר ✓</p>}
          {saveStatus === 'error' && <p className="text-red-600 text-sm text-right">שגיאה בשמירה</p>}
          {saveStatus !== 'saving' && saveStatus !== 'success' && missing.length > 0 && (
            <p className="text-amber-700 text-sm text-right">
              לא ניתן לשמור — חסר: {missing.join(', ')}
            </p>
          )}
          <div className="flex gap-2 flex-row-reverse">
            <Button
              onClick={handleSave}
              disabled={saveStatus === 'saving' || saveStatus === 'success'}
              title={missing.length > 0 ? `חסר: ${missing.join(', ')}` : undefined}
              className="bg-purple-600 hover:bg-purple-700 text-white"
            >
              {saveStatus === 'saving' ? 'שומר...' : 'שמור'}
            </Button>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saveStatus === 'saving'}>
              ביטול
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function TimePeriodForm({
  state,
  setState,
  unbilledHours,
  selectedClient,
  employees,
}: {
  state: DialogState
  setState: React.Dispatch<React.SetStateAction<DialogState>>
  unbilledHours: HoursLog[]
  selectedClient: Client | null
  employees: Profile[]
}) {
  const firstOfMonth = new Date()
  firstOfMonth.setDate(1)
  const lastOfMonth = new Date(firstOfMonth.getFullYear(), firstOfMonth.getMonth() + 1, 0)

  const setPeriodThisMonth = () => {
    setState((s) => ({
      ...s,
      period_start: firstOfMonth.toISOString().slice(0, 10),
      period_end: lastOfMonth.toISOString().slice(0, 10),
    }))
  }

  const profileNameById = useMemo(() => {
    const m = new Map<string, string>()
    for (const e of employees) m.set(e.id, e.full_name)
    return m
  }, [employees])

  const toggleHourRow = (id: string) => {
    setState((s) => {
      const next = new Set(s.selectedHoursIds)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return { ...s, selectedHoursIds: next }
    })
  }

  const allChecked = unbilledHours.length > 0 && unbilledHours.every((h) => state.selectedHoursIds.has(h.id))
  const toggleAll = () => {
    setState((s) => {
      if (allChecked) return { ...s, selectedHoursIds: new Set() }
      return { ...s, selectedHoursIds: new Set(unbilledHours.map((h) => h.id)) }
    })
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">תחילת תקופה</Label>
          <DateInput
            value={state.period_start ?? ''}
            onChange={(e) => setState((s) => ({ ...s, period_start: e.target.value || null }))}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">סוף תקופה</Label>
          <DateInput
            value={state.period_end ?? ''}
            onChange={(e) => setState((s) => ({ ...s, period_end: e.target.value || null }))}
          />
        </div>
        <div className="space-y-1 flex flex-col justify-end">
          <Button variant="outline" size="sm" onClick={setPeriodThisMonth}>החודש</Button>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">
            תעריף שעה (₪)
            {selectedClient?.hourly_rate != null && state.hourly_rate_used !== selectedClient.hourly_rate && (
              <span className="text-[10px] text-amber-600 ms-1">
                ≠ {fmt(selectedClient.hourly_rate)} של הלקוח
              </span>
            )}
          </Label>
          <Input
            type="number"
            dir="ltr"
            value={state.hourly_rate_used ?? ''}
            onChange={(e) =>
              setState((s) => ({ ...s, hourly_rate_used: e.target.value === '' ? null : Number(e.target.value) }))
            }
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">סה"כ שעות</Label>
          <Input dir="ltr" value={state.hours_total?.toFixed(2) ?? ''} readOnly />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">סכום נטו (מחושב)</Label>
          <Input dir="ltr" value={state.net_invoice_amount != null ? fmt(state.net_invoice_amount) : ''} readOnly />
        </div>
      </div>

      <div className="rounded-md border">
        <div className="flex items-center justify-between px-3 py-2 border-b bg-purple-50">
          <span className="text-xs font-semibold text-purple-800">
            דיווחי שעות לא מחויבים ({unbilledHours.length})
          </span>
          {unbilledHours.length > 0 && (
            <button type="button" className="text-xs text-purple-700 hover:underline" onClick={toggleAll}>
              {allChecked ? 'בטל בחירה' : 'בחר הכל'}
            </button>
          )}
        </div>
        {unbilledHours.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground text-center">
            אין דיווחים בתקופה שנבחרה ללקוח זה.
          </p>
        ) : (
          <div className="max-h-64 overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8"></TableHead>
                  <TableHead className="text-right text-xs">תאריך</TableHead>
                  <TableHead className="text-right text-xs">משעה</TableHead>
                  <TableHead className="text-right text-xs">עד</TableHead>
                  <TableHead className="text-right text-xs">שעות</TableHead>
                  <TableHead className="text-right text-xs">עובד/ת</TableHead>
                  <TableHead className="text-right text-xs">תיאור</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {unbilledHours.map((h) => (
                  <TableRow key={h.id}>
                    <TableCell className="w-8">
                      <input
                        type="checkbox"
                        checked={state.selectedHoursIds.has(h.id)}
                        onChange={() => toggleHourRow(h.id)}
                      />
                    </TableCell>
                    <TableCell className="text-xs"><DateCell value={h.visit_date} /></TableCell>
                    <TableCell className="text-xs" dir="ltr">{h.start_time ?? '—'}</TableCell>
                    <TableCell className="text-xs" dir="ltr">{h.end_time ?? '—'}</TableCell>
                    <TableCell className="text-xs">{h.hours}</TableCell>
                    <TableCell className="text-xs">
                      {h.profile_id ? profileNameById.get(h.profile_id) ?? '—' : '—'}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{h.description ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  )
}
