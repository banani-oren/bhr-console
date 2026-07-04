import { useEffect, useMemo, useRef, useState } from 'react'
import { DateInput } from '@/components/ui/date-input'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw, Trash2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { useSaveWatchdog } from '@/hooks/useSaveWatchdog'
import type {
  BillingEvent,
  Client,
  Profile,
  Supplier,
  Transaction,
  TransactionKind,
} from '@/lib/types'
import {
  type ServiceField,
  type ServiceType,
  evalDerived,
} from '@/lib/serviceTypes'
import {
  addDays,
  calculateTaxInvoiceDate,
  cancelFutureBillingEvents,
  generateServiceBillingEvents,
  parsePaymentTermDays,
  reconcileFinalSalaryBillingEvents,
  resolveAdvanceAmount,
  upsertBillingEvents,
} from '@/lib/billingEvents'
import ClientPicker from '@/components/ClientPicker'
import AdvanceEditor, { type AdvanceType } from '@/components/AdvanceEditor'
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
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const MIRRORED_KEYS = new Set([
  'position_name',
  'candidate_name',
  'commission_percent',
  'salary',
  'net_invoice_amount',
  'commission_amount',
  'service_lead',
])

// Fields managed by Section 2 ("תאריכים") — skip in renderField to avoid duplicates.
// sign_date is a legacy custom field on placement service types that mapped to close_date.
const SECTION2_MANAGED_KEYS = new Set([
  'close_date',
  'sign_date',
  'work_start_date',
  'work_end_date',
  'warranty_end_date',
])

type ExecutionDate = { date: string; hours: number }

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
  notes: string | null
  custom: Record<string, unknown>

  work_start_date: string | null
  work_end_date: string | null
  warranty_end_date: string | null

  advance_type_override: AdvanceType
  advance_amount_override: string

  supplier_id: string | null
  supplier_percent: number | null

  // time_period read-only state for editing existing time_period transactions
  period_start: string | null
  period_end: string | null
  hours_total: number | null
  hourly_rate_used: number | null
  net_invoice_amount: number | null
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function monthOf(iso: string | null): number | null {
  if (!iso) return null
  return new Date(iso).getMonth() + 1
}

function yearOf(iso: string | null): number | null {
  if (!iso) return null
  return new Date(iso).getFullYear()
}

function fmt(n: number | null | undefined): string {
  if (n == null) return '—'
  return new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 }).format(n)
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
    notes: null,
    custom: {},
    work_start_date: null,
    work_end_date: null,
    warranty_end_date: null,
    advance_type_override: '',
    advance_amount_override: '',
    supplier_id: null,
    supplier_percent: null,
    period_start: null,
    period_end: null,
    hours_total: null,
    hourly_rate_used: null,
    net_invoice_amount: null,
  }
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

  const { data: suppliers = [] } = useQuery<Supplier[]>({
    queryKey: ['suppliers'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('suppliers')
        .select('*')
        .order('last_name', { ascending: true })
      if (error) throw error
      return data as Supplier[]
    },
  })

  const [state, setState] = useState<DialogState>(() => emptyState(profile?.full_name ?? ''))
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)
  // Snapshot of final_salary as loaded, so handleSave can tell whether the admin
  // actually changed it (vs. just re-saving other fields) before offering to
  // recalculate billing events.
  const originalFinalSalaryRef = useRef<number>(0)

  // Last-resort safety net backing up handleSave's own 10s abort timeout.
  useSaveWatchdog(saveStatus === 'saving', () => {
    setSaveStatus('error')
    setSaveError('השמירה לא הושלמה — פג זמן. בדוק חיבור לאינטרנט ונסה שנית.')
  })

  const selectedClient = useMemo(
    () => clients.find((c) => c.id === state.client_id) ?? null,
    [clients, state.client_id],
  )

  const selectedServiceType = useMemo(
    () => serviceTypes.find((s) => s.id === state.service_type_id) ?? null,
    [serviceTypes, state.service_type_id],
  )

  // Billing events for the editing transaction
  const { data: txnBillingEvents = [], refetch: refetchEvents } = useQuery<BillingEvent[]>({
    queryKey: ['billing_events', editing?.id ?? 'none'],
    enabled: !!editing?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('billing_events')
        .select('*')
        .eq('transaction_id', editing!.id)
        .order('event_index', { ascending: true })
      if (error) throw error
      return data as BillingEvent[]
    },
  })

  useEffect(() => {
    if (!open) return
    setSaveStatus('idle')
    setSaveError(null)
    if (editing) {
      const custom = typeof editing.custom_fields === 'object' && editing.custom_fields
        ? { ...(editing.custom_fields as Record<string, unknown>) }
        : {}
      for (const k of MIRRORED_KEYS) {
        const col = (editing as unknown as Record<string, unknown>)[k]
        if (col != null && custom[k] == null) custom[k] = col
      }
      const legacySignDate =
        editing.close_date ??
        (typeof custom.sign_date === 'string' ? (custom.sign_date as string) : null)
      originalFinalSalaryRef.current = Number(custom.final_salary) || 0
      setState({
        kind: editing.kind ?? 'service',
        service_type_id: editing.service_type_id,
        service_type_name: editing.service_type ?? '',
        client_id: editing.client_id ?? clients.find((c) => c.name === editing.client_name)?.id ?? null,
        client_name: editing.client_name ?? '',
        service_lead: editing.service_lead ?? profile?.full_name ?? '',
        entry_date: editing.entry_date ?? today(),
        close_date: legacySignDate,
        notes: editing.notes,
        custom,
        work_start_date: editing.work_start_date,
        work_end_date: editing.work_end_date,
        warranty_end_date: editing.warranty_end_date,
        advance_type_override: '',
        advance_amount_override: '',
        supplier_id: editing.supplier_id ?? null,
        supplier_percent: editing.supplier_percent ?? null,
        period_start: editing.period_start,
        period_end: editing.period_end,
        hours_total: editing.hours_total,
        hourly_rate_used: editing.hourly_rate_used,
        net_invoice_amount: editing.net_invoice_amount,
      })
    } else {
      originalFinalSalaryRef.current = 0
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

  // Hydrate from client selection: auto-fill commission_percent if empty.
  useEffect(() => {
    if (!selectedClient) return
    setState((s) => {
      const next = { ...s, client_name: selectedClient.name }
      if (next.custom.commission_percent == null && selectedClient.commission_percent != null) {
        next.custom = { ...next.custom, commission_percent: selectedClient.commission_percent }
      }
      return next
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClient?.id])

  // Derived custom fields per service type definition.
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

  const setCustom = (key: string, val: unknown) => {
    setState((s) => ({ ...s, custom: { ...s.custom, [key]: val } }))
  }

  const handleServiceTypePick = (serviceTypeId: string) => {
    const st = serviceTypes.find((s) => s.id === serviceTypeId)
    setState((s) => ({
      ...s,
      kind: 'service',
      service_type_id: serviceTypeId,
      service_type_name: st?.name ?? '',
    }))
  }

  // Effective advance source: override (non-empty) or client default
  const effectiveAdvanceType: AdvanceType =
    state.advance_type_override !== '' || state.advance_amount_override !== ''
      ? state.advance_type_override
      : ((selectedClient?.advance_type ?? '') as AdvanceType)
  const effectiveAdvanceAmount =
    state.advance_type_override !== '' || state.advance_amount_override !== ''
      ? state.advance_amount_override
      : selectedClient?.advance_amount != null
      ? String(selectedClient.advance_amount)
      : ''

  const transactionApproved = !!editing?.approved_at || !editing?.needs_approval

  const handleSave = async () => {
    // Ask BEFORE starting the abort timer — window.confirm() blocks the thread,
    // and a slow decision here must not eat into the network request's timeout
    // budget (which would fire the moment the dialog closes).
    const isGiyusNow = state.service_type_name === 'גיוס'
    const finalSalaryNow = Number(state.custom.final_salary) || 0
    const finalSalaryChanged = isGiyusNow && finalSalaryNow !== originalFinalSalaryRef.current
    const hasExistingEvents = !!editing && txnBillingEvents.length > 0
    if (finalSalaryChanged && hasExistingEvents) {
      const proceed = window.confirm('שכר סופי עודכן. לעדכן את אירועי החיוב בהתאם?')
      if (!proceed) return
    }
    const shouldReconcile = finalSalaryChanged && hasExistingEvents

    setSaveStatus('saving')
    setSaveError(null)

    const controller = new AbortController()
    const timeoutId = setTimeout(() => {
      controller.abort(new DOMException('timeout', 'AbortError'))
    }, 10000)

    try {
      const mirrored: Record<string, unknown> = {}
      for (const k of MIRRORED_KEYS) {
        if (state.custom[k] !== undefined) mirrored[k] = state.custom[k]
      }
      // Keep legacy custom.sign_date in sync with close_date column.
      const customWithDates = { ...state.custom, sign_date: state.close_date }

      const isRecruiter = profile?.role === 'recruiter'
      const nowIso = new Date().toISOString()
      const approvalFields: Record<string, unknown> = editing
        ? {} // don't reset approval on edit
        : isRecruiter
        ? { needs_approval: true, created_by: profile!.id }
        : {
            needs_approval: false,
            created_by: profile!.id,
            approved_by: profile!.id,
            approved_at: nowIso,
          }

      const payload: Record<string, unknown> = {
        kind: state.kind,
        client_id: state.client_id,
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
        work_start_date: state.work_start_date,
        work_end_date: state.work_end_date,
        warranty_end_date: state.warranty_end_date,
        notes: state.notes,
        custom_fields: customWithDates,
        supplier_id: state.supplier_id,
        supplier_percent: state.supplier_percent,
        ...mirrored,
        ...approvalFields,
      }

      // For service kind: compute net_invoice_amount from salary × commission% (no billing_percent).
      // For גיוס, final_salary (once set) is the more accurate figure and takes priority.
      if (state.kind === 'service') {
        const expectedSalary = Number(state.custom.salary) || 0
        const finalSalaryVal = Number(state.custom.final_salary) || 0
        const isGiyusNow = state.service_type_name === 'גיוס'
        const effectiveSalaryForInvoice = isGiyusNow && finalSalaryVal > 0 ? finalSalaryVal : expectedSalary
        const commPct = Number(state.custom.commission_percent) || 0
        if (effectiveSalaryForInvoice > 0 && commPct > 0) {
          const totalCommission = Math.round(effectiveSalaryForInvoice * (commPct / 100) * 100) / 100
          payload.net_invoice_amount = totalCommission
          payload.commission_amount = totalCommission
        }
      }

      for (const k of ['commission_percent', 'salary', 'net_invoice_amount', 'commission_amount']) {
        if (payload[k] !== undefined && payload[k] !== null && payload[k] !== '') {
          payload[k] = Number(payload[k])
        }
      }

      let txnId: string | null = editing?.id ?? null
      if (editing) {
        const { error } = await supabase.from('transactions').update(payload).eq('id', editing.id).abortSignal(controller.signal)
        if (error) throw error
      } else {
        const { data, error } = await supabase.from('transactions').insert(payload).select('id').abortSignal(controller.signal).single()
        if (error) throw error
        txnId = (data as { id: string } | null)?.id ?? null
      }

      // Generate billing events for service transactions when work_start_date is set.
      if (state.kind === 'service' && state.work_start_date && txnId) {
        const expectedSalary = Number(state.custom.salary) || 0
        const finalSalaryVal = Number(state.custom.final_salary) || 0
        const effectiveSalary = isGiyusNow && finalSalaryVal > 0 ? finalSalaryVal : expectedSalary
        const commissionPct = Number(state.custom.commission_percent) || 0
        const supplierPct = state.supplier_percent ?? 0
        const paymentSplit = selectedClient?.payment_split_json ?? []
        const advType: AdvanceType = effectiveAdvanceType
        const advAmount = effectiveAdvanceAmount ? Number(effectiveAdvanceAmount) : null
        // Advance is always derived from expected salary — locked once generated,
        // never recalculated from final_salary.
        const advance = resolveAdvanceAmount(advType || null, advAmount, expectedSalary, commissionPct)

        if (shouldReconcile) {
          const { toUpsert, warning } = reconcileFinalSalaryBillingEvents({
            transactionId: txnId,
            existingEvents: txnBillingEvents,
            finalSalary: effectiveSalary,
            commissionPercent: commissionPct,
            workStartDate: state.work_start_date,
            paymentSplit,
            advanceAmount: advance,
            supplierPercent: supplierPct,
            candidateName: String(state.custom.candidate_name ?? ''),
            serviceType: state.service_type_name,
          })
          await upsertBillingEvents(txnId, toUpsert, controller.signal)
          if (warning) window.alert(warning)
        } else {
          const events = generateServiceBillingEvents({
            transactionId: txnId,
            salary: effectiveSalary,
            commissionPercent: commissionPct,
            workStartDate: state.work_start_date,
            paymentSplit,
            advanceAmount: advance,
            supplierPercent: supplierPct,
            candidateName: String(state.custom.candidate_name ?? ''),
            serviceType: state.service_type_name,
          })
          await upsertBillingEvents(txnId, events, controller.signal)
        }

        // Auto-flip pending → to_bill for past-dated events when the transaction is approved.
        const txnApproved = approvalFields.approved_at != null || (editing && editing.approved_at)
        if (txnApproved) {
          const todayIso = new Date().toISOString().slice(0, 10)
          await supabase
            .from('billing_events')
            .update({ status: 'to_bill' })
            .eq('transaction_id', txnId)
            .eq('status', 'pending')
            .lte('billing_date', todayIso)
            .abortSignal(controller.signal)
        }
      }

      // Cancel future billing events when work_end_date is set.
      if (state.work_end_date && txnId) {
        await cancelFutureBillingEvents(txnId, state.work_end_date, controller.signal)
      }

      // Email approval recipients if a recruiter created a new transaction.
      // Wired to the same abort signal/budget as the rest of handleSave so a hung
      // edge-function call can't leave saveStatus stuck at 'saving' forever.
      if (!editing && isRecruiter && txnId) {
        try {
          await supabase.functions.invoke('send-approval-email', {
            body: {
              transactionId: txnId,
              createdByName: profile!.full_name,
              clientName: state.client_name,
              serviceType: state.service_type_name,
              amount: payload.net_invoice_amount ?? 0,
            },
            signal: controller.signal,
          })
        } catch (e) {
          console.warn('approval email skipped:', e)
        }
      }

      queryClient.invalidateQueries({ queryKey: ['transactions'] })
      queryClient.invalidateQueries({ queryKey: ['billing_events'] })
      setSaveStatus('success')
      setTimeout(() => {
        setSaveStatus('idle')
        onOpenChange(false)
        if (txnId) onSaved?.(txnId)
      }, 1000)
    } catch (err) {
      console.error('TransactionDialog save error:', err)
      const isAbort = err instanceof DOMException && err.name === 'AbortError'
      const isTimeout = isAbort && err.message === 'timeout'
      setSaveError(
        isTimeout
          ? 'השמירה לא הושלמה — פג זמן. בדוק חיבור לאינטרנט ונסה שנית.'
          : err instanceof Error ? err.message : 'שגיאה',
      )
      setSaveStatus('error')
    } finally {
      clearTimeout(timeoutId)
    }
  }

  const isGiyus = state.service_type_name === 'גיוס'
  const isHadracha = state.service_type_name === 'הדרכה'

  // הדרכה pricing: מחיר (custom.price) × number of execution dates + travel.
  const executionDates = (state.custom.execution_dates as ExecutionDate[] | undefined) ?? []
  const hadrachaPrice = Number(state.custom.price) || 0
  const hadrachaTravelEnabled = !!state.custom.travel_billing_enabled
  const hadrachaTravelAmount = hadrachaTravelEnabled ? Number(state.custom.travel_billing_amount) || 0 : 0
  const hadrachaTotal = hadrachaPrice * executionDates.length + hadrachaTravelAmount

  const setExecutionDates = (dates: ExecutionDate[]) => setCustom('execution_dates', dates)

  // Always keep at least one (blank) execution-date row while on הדרכה.
  useEffect(() => {
    if (isHadracha && executionDates.length === 0) {
      setCustom('execution_dates', [{ date: '', hours: 0 }])
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHadracha, executionDates.length])

  // Keep net_invoice_amount (and its custom_fields mirror) in sync with the
  // live הדרכה total so both the on-screen total and the saved amount match.
  useEffect(() => {
    if (!isHadracha) return
    setCustom('net_invoice_amount', Math.round(hadrachaTotal * 100) / 100)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHadracha, hadrachaPrice, executionDates.length, hadrachaTravelEnabled, hadrachaTravelAmount])

  const renderField = (f: ServiceField) => {
    if (SECTION2_MANAGED_KEYS.has(f.key)) return null
    const value = state.custom[f.key]
    const widthCls = f.width === 'full' ? 'md:col-span-2' : ''
    const label = `${f.label}${f.derived ? ' 🔄' : ''}`
    const wrap = (child: React.ReactNode, labelOverride?: string) => (
      <div key={f.key} className={`space-y-1 ${widthCls}`}>
        <Label className="text-purple-700">{labelOverride ?? label}</Label>
        {child}
      </div>
    )
    const inputProps = { disabled: !!f.derived }

    // גיוס gets two salary fields (expected + final) instead of the usual one.
    if (f.key === 'salary' && isGiyus) {
      return [
        <div key="salary" className={`space-y-1 ${widthCls}`}>
          <Label className="text-purple-700">שכר משוער</Label>
          <Input
            type="number"
            dir="ltr"
            value={(value as number | string | undefined) ?? ''}
            onChange={(e) => setCustom('salary', e.target.value === '' ? null : Number(e.target.value))}
            {...inputProps}
          />
        </div>,
        <div key="final_salary" className={`space-y-1 ${widthCls}`}>
          <Label className="text-purple-700">שכר סופי</Label>
          <Input
            type="number"
            dir="ltr"
            placeholder="אופציונלי — עד לאישור המשרה"
            value={(state.custom.final_salary as number | string | undefined) ?? ''}
            onChange={(e) => setCustom('final_salary', e.target.value === '' ? null : Number(e.target.value))}
          />
        </div>,
      ]
    }

    // גיוס gets an optional candidate number right below the candidate name, so
    // billing can reference a number instead of exposing the candidate's name.
    if (f.key === 'candidate_name' && isGiyus) {
      return [
        <div key="candidate_name" className={`space-y-1 ${widthCls}`}>
          <Label className="text-purple-700">{label}</Label>
          <Input value={(value as string) ?? ''} onChange={(e) => setCustom(f.key, e.target.value)} {...inputProps} />
        </div>,
        <div key="candidate_number" className={`space-y-1 ${widthCls}`}>
          <Label className="text-purple-700">מספר מועמד</Label>
          <Input
            value={(state.custom.candidate_number as string) ?? ''}
            onChange={(e) => setCustom('candidate_number', e.target.value)}
            placeholder="אופציונלי"
          />
        </div>,
      ]
    }

    // הדרכה: relabel the flat-fee "מחיר" field for clarity (still custom.price).
    if (f.key === 'price' && isHadracha) {
      return wrap(
        <Input
          type="number"
          dir="ltr"
          value={(value as number | string | undefined) ?? ''}
          onChange={(e) => setCustom(f.key, e.target.value === '' ? null : Number(e.target.value))}
          {...inputProps}
        />,
        'מחיר הדרכה',
      )
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
      default:
        return null
    }
  }

  const isTimePeriod = state.kind === 'time_period'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="sm:max-w-5xl w-[90vw] max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? 'עריכת עסקה' : 'הוספת עסקה'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-2">
          {/* Section 1 — פרטי עסקה */}
          <div>
            <h3 className="text-sm font-semibold text-purple-700 mb-3">פרטי עסקה</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5 md:col-span-2">
                <Label>לקוח *</Label>
                <ClientPicker
                  value={state.client_id}
                  onChange={(id, c) =>
                    setState((s) => ({ ...s, client_id: id, client_name: c?.name ?? '' }))
                  }
                  placeholder="חיפוש לקוח לפי שם או ח.פ. ..."
                />
                {selectedClient && (
                  <p className="text-[11px] text-muted-foreground">
                    {selectedClient.commission_percent != null && <span>עמלה {selectedClient.commission_percent}% · </span>}
                    {selectedClient.warranty_days != null && <span>אחריות {selectedClient.warranty_days} ימים · </span>}
                    {selectedClient.payment_terms && <span>תנאי תשלום {selectedClient.payment_terms} · </span>}
                    {selectedClient.hourly_rate != null && <span>תעריף שעה {fmt(selectedClient.hourly_rate)}</span>}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>סוג שירות *</Label>
                <Select
                  value={state.service_type_id ?? ''}
                  onValueChange={(v) => v && handleServiceTypePick(v)}
                  disabled={isTimePeriod}
                >
                  <SelectTrigger>
                    <span className="truncate text-sm">
                      {isTimePeriod
                        ? 'דיווח שעות'
                        : state.service_type_name || 'בחר סוג שירות'}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    {serviceTypes.map((st) => (
                      <SelectItem key={st.id} value={st.id}>{st.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>תאריך פתיחה</Label>
                <DateInput
                  value={state.entry_date}
                  onChange={(e) => setState((s) => ({ ...s, entry_date: e.target.value }))}
                />
              </div>
            </div>

            {!isTimePeriod && selectedServiceType && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                {selectedServiceType.fields.map(renderField)}
              </div>
            )}
            {!isTimePeriod && !selectedServiceType && (
              <p className="text-sm text-muted-foreground mt-3">בחר סוג שירות להצגת שדות.</p>
            )}

            {isHadracha && (
              <div className="space-y-4 mt-4">
                <div className="space-y-2">
                  <Label className="text-purple-700">תאריכי ביצוע</Label>
                  {executionDates.map((ed, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <DateInput
                        value={ed.date}
                        onChange={(e) => {
                          const next = [...executionDates]
                          next[i] = { ...next[i], date: e.target.value }
                          setExecutionDates(next)
                        }}
                      />
                      <Input
                        type="number"
                        dir="ltr"
                        min={0}
                        max={24}
                        className="w-24"
                        placeholder="שעות"
                        value={ed.hours ?? ''}
                        onChange={(e) => {
                          const next = [...executionDates]
                          next[i] = { ...next[i], hours: e.target.value === '' ? 0 : Number(e.target.value) }
                          setExecutionDates(next)
                        }}
                      />
                      <span className="text-xs text-muted-foreground shrink-0">שע&apos;</span>
                      <button
                        type="button"
                        disabled={executionDates.length <= 1}
                        onClick={() => setExecutionDates(executionDates.filter((_, idx) => idx !== i))}
                        className="text-muted-foreground hover:text-red-500 disabled:opacity-30 transition-colors"
                        title="הסר תאריך"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => setExecutionDates([...executionDates, { date: '', hours: 0 }])}
                    className="text-sm text-purple-700 underline"
                  >
                    + הוסף תאריך
                  </button>
                </div>

                <div className="flex items-center gap-3">
                  <Switch
                    checked={hadrachaTravelEnabled}
                    onCheckedChange={(v) => setCustom('travel_billing_enabled', v)}
                  />
                  <Label>חיוב נסיעות</Label>
                  {hadrachaTravelEnabled && (
                    <Input
                      type="number"
                      dir="ltr"
                      className="w-32"
                      placeholder="סכום ₪"
                      value={(state.custom.travel_billing_amount as number | string | undefined) ?? ''}
                      onChange={(e) =>
                        setCustom('travel_billing_amount', e.target.value === '' ? null : Number(e.target.value))
                      }
                    />
                  )}
                </div>

                <div className="rounded-lg bg-purple-50 p-3 text-sm">
                  <p className="font-semibold text-purple-900">סה&quot;כ לחיוב: {fmt(hadrachaTotal)}</p>
                  <p className="text-xs text-muted-foreground">
                    ({fmt(hadrachaPrice)} × {executionDates.length} תאריכים
                    {hadrachaTravelEnabled ? ` + ${fmt(hadrachaTravelAmount)} נסיעות` : ''})
                  </p>
                </div>
              </div>
            )}
            {isTimePeriod && (
              <Card className="p-3 mt-4 bg-amber-50/50">
                <h4 className="text-xs font-semibold text-amber-800 mb-2">דיווח שעות</h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                  <div>
                    <Label className="text-xs">תקופה</Label>
                    <p>{state.period_start ?? '—'} → {state.period_end ?? '—'}</p>
                  </div>
                  <div>
                    <Label className="text-xs">סה"כ שעות</Label>
                    <p>{state.hours_total ?? 0}</p>
                  </div>
                  <div>
                    <Label className="text-xs">סכום נטו</Label>
                    <p>{fmt(state.net_invoice_amount)}</p>
                  </div>
                </div>
              </Card>
            )}
          </div>

          <Separator />

          {/* Section 2 — תאריכים. The date sub-fields don't apply to הדרכה
              (no work-start/end, warranty, or close date for a training
              session) — הערות stays visible for every service type. */}
          <div>
            <h3 className="text-sm font-semibold text-purple-700 mb-3">תאריכים</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {!isHadracha && (
                <>
                  <div className="space-y-1.5">
                    <Label>תאריך התחלת עבודה</Label>
                    <DateInput
                      value={state.work_start_date ?? ''}
                      onChange={(e) => setState((s) => ({ ...s, work_start_date: e.target.value || null }))}
                    />
                    <p className="text-[11px] text-muted-foreground">בעת שמירה — נוצרים אירועי חיוב לפי פיצול התשלום של הלקוח.</p>
                  </div>
                  <div className="space-y-1.5">
                    <Label>תאריך סיום עבודה</Label>
                    <DateInput
                      value={state.work_end_date ?? ''}
                      onChange={(e) => setState((s) => ({ ...s, work_end_date: e.target.value || null }))}
                    />
                    <p className="text-[11px] text-muted-foreground">בעת שמירה — אירועי חיוב עתידיים מבוטלים.</p>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="flex items-center gap-1">
                      תקופת אחריות מסתיימת
                      <button
                        type="button"
                        onClick={() => {
                          const days = selectedClient?.warranty_days ?? null
                          if (state.work_start_date && days != null) {
                            setState((s) => ({ ...s, warranty_end_date: addDays(state.work_start_date!, days) }))
                          }
                        }}
                        className="text-purple-500 hover:text-purple-700"
                        title="חשב מחדש מתחילת עבודה + תקופת אחריות"
                      >
                        <RefreshCw className="h-3 w-3" />
                      </button>
                    </Label>
                    <DateInput
                      value={state.warranty_end_date ?? ''}
                      onChange={(e) => setState((s) => ({ ...s, warranty_end_date: e.target.value || null }))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>תאריך סגירה</Label>
                    <DateInput
                      value={state.close_date ?? ''}
                      onChange={(e) => setState((s) => ({ ...s, close_date: e.target.value || null }))}
                    />
                  </div>
                </>
              )}
              <div className="space-y-1.5 md:col-span-2">
                <Label>הערות</Label>
                <Textarea
                  value={state.notes ?? ''}
                  onChange={(e) => setState((s) => ({ ...s, notes: e.target.value || null }))}
                  rows={2}
                />
              </div>
            </div>
          </div>

          {/* Section 3 — מקדמה (only for service when client has advance configured OR override set) */}
          {!isTimePeriod && (selectedClient?.advance_type || state.advance_type_override) && (
            <>
              <Separator />
              <div>
                <h3 className="text-sm font-semibold text-purple-700 mb-3">מקדמה</h3>
                <p className="text-[11px] text-muted-foreground mb-2">
                  ברירת מחדל לפי הסכם לקוח — ניתן לשנות לעסקה זו
                </p>
                <AdvanceEditor
                  advanceType={effectiveAdvanceType}
                  advanceAmount={effectiveAdvanceAmount}
                  onTypeChange={(t) => setState((s) => ({ ...s, advance_type_override: t }))}
                  onAmountChange={(v) => setState((s) => ({ ...s, advance_amount_override: v }))}
                />
              </div>
            </>
          )}

          {/* Section 4 — ספק (supplier) */}
          <Separator />
          <div>
            <h3 className="text-sm font-semibold text-purple-700 mb-3">ספק</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>ספק</Label>
                <Select
                  value={state.supplier_id ?? '__none__'}
                  onValueChange={(v) =>
                    setState((s) => ({ ...s, supplier_id: v === '__none__' ? null : v }))
                  }
                >
                  <SelectTrigger>
                    <span className="truncate text-sm">
                      {state.supplier_id == null
                        ? 'ללא ספק'
                        : (() => {
                            const sp = suppliers.find((s) => s.id === state.supplier_id)
                            return sp ? `${sp.last_name} ${sp.first_name}` : '—'
                          })()}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">ללא ספק</SelectItem>
                    {suppliers.map((sp) => (
                      <SelectItem key={sp.id} value={sp.id}>
                        {sp.last_name} {sp.first_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>עמלת ספק %</Label>
                <Input
                  type="number"
                  dir="ltr"
                  value={state.supplier_percent ?? ''}
                  onChange={(e) =>
                    setState((s) => ({
                      ...s,
                      supplier_percent: e.target.value === '' ? null : Number(e.target.value),
                    }))
                  }
                  disabled={!state.supplier_id}
                  placeholder={state.supplier_id ? '' : 'בחר ספק קודם'}
                />
              </div>
            </div>
          </div>

          {/* Section 5 — חיובים ותשלומים (only when editing) */}
          {editing && (
            <>
              <Separator />
              <BillingEventsPanel
                events={txnBillingEvents}
                approved={transactionApproved}
                onChange={() => refetchEvents()}
                transaction={editing}
                selectedClient={selectedClient}
              />
            </>
          )}

          {!editing && (
            <p className="text-xs text-muted-foreground">
              פרטי החיוב יחושבו לאחר שמירת העסקה
            </p>
          )}
        </div>

        <DialogFooter className="flex flex-col gap-2">
          {saveStatus === 'success' && <p className="text-green-600 text-sm text-right">נשמר ✓</p>}
          {saveStatus === 'error' && (
            <p className="text-red-600 text-sm text-right">{saveError ?? 'שגיאה בשמירה'}</p>
          )}
          <div className="flex gap-2 flex-row-reverse">
            <Button
              onClick={handleSave}
              disabled={saveStatus === 'saving' || saveStatus === 'success' || !state.client_id}
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

// ─────────────────────────────────────────────────────────────────────────────
// Billing events read + inline edit (when editing existing transaction)
// ─────────────────────────────────────────────────────────────────────────────

function BillingEventsPanel({
  events,
  approved,
  onChange,
  transaction,
  selectedClient,
}: {
  events: BillingEvent[]
  approved: boolean
  onChange: () => void
  transaction: Transaction
  selectedClient: Client | null
}) {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const paymentTermsDays = parsePaymentTermDays(selectedClient?.payment_terms)
  const nextEventIndex = events.reduce((m, e) => Math.max(m, e.event_index), 0) + 1

  return (
    <div>
      <h3 className="text-sm font-semibold text-purple-700 mb-3">
        חיובים ותשלומים{!approved && <span className="text-amber-600 text-xs ms-2">(העסקה ממתינה לאישור)</span>}
      </h3>
      {events.length === 0 ? (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">אין אירועי חיוב לעסקה זו.</p>
          {transaction.kind === 'service' && transaction.work_start_date && (
            <GenerateBillingEventsButton
              transaction={transaction}
              selectedClient={selectedClient}
              onGenerated={onChange}
            />
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {events.map((e) => (
            <BillingEventRow
              key={e.id}
              event={e}
              paymentTermsDays={paymentTermsDays}
              onSaved={onChange}
              onDeleted={onChange}
            />
          ))}
        </div>
      )}
      {isAdmin && (
        <div className="mt-3">
          <AddBillingEventButton
            transactionId={transaction.id}
            nextEventIndex={nextEventIndex}
            onAdded={onChange}
          />
        </div>
      )}
    </div>
  )
}

function AddBillingEventButton({
  transactionId,
  nextEventIndex,
  onAdded,
}: {
  transactionId: string
  nextEventIndex: number
  onAdded: () => void
}) {
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState('')
  const [billingDate, setBillingDate] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!open) {
    return (
      <Button
        size="sm"
        variant="outline"
        className="text-purple-700 border-purple-300"
        onClick={() => setOpen(true)}
      >
        + הוסף אירוע
      </Button>
    )
  }

  const handleAdd = async () => {
    const amountNum = Number(amount)
    if (amount === '' || isNaN(amountNum) || !billingDate) {
      setError('יש למלא סכום ותאריך חשבון')
      return
    }
    setSaving(true)
    setError(null)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new DOMException('timeout', 'AbortError')), 10000)
    try {
      const { error: insertErr } = await supabase
        .from('billing_events')
        .insert({
          transaction_id: transactionId,
          event_index: nextEventIndex,
          amount: amountNum,
          billing_date: billingDate,
          description: description.trim() || 'תשלום ידני',
          status: 'pending',
          invoice_number: null,
          payment_date: null,
          receipt_number: null,
          advance_applied: 0,
          supplier_amount: 0,
        })
        .abortSignal(controller.signal)
      if (insertErr) throw insertErr
      setOpen(false)
      setAmount('')
      setBillingDate('')
      setDescription('')
      onAdded()
    } catch (err) {
      const isTimeout = err instanceof DOMException && err.name === 'AbortError'
      setError(isTimeout ? 'פג זמן — נסה שנית' : 'שגיאה בהוספת האירוע')
    } finally {
      clearTimeout(timer)
      setSaving(false)
    }
  }

  return (
    <Card className="p-3 space-y-2">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">סכום</Label>
          <Input
            type="number"
            dir="ltr"
            className="h-8 text-sm"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">תאריך חשבון</Label>
          <DateInput value={billingDate} onChange={(e) => setBillingDate(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">תיאור</Label>
          <Input
            className="h-8 text-sm"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="תשלום ידני"
          />
        </div>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={saving}
          onClick={() => void handleAdd()}
          className="bg-purple-600 hover:bg-purple-700 text-white"
        >
          {saving ? 'שומר...' : 'שמור'}
        </Button>
        <Button size="sm" variant="outline" onClick={() => setOpen(false)} disabled={saving}>
          ביטול
        </Button>
      </div>
    </Card>
  )
}

function GenerateBillingEventsButton({
  transaction,
  selectedClient,
  onGenerated,
}: {
  transaction: Transaction
  selectedClient: Client | null
  onGenerated: () => void
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleGenerate = async () => {
    setLoading(true)
    setError(null)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new DOMException('timeout', 'AbortError')), 10000)
    try {
      const cf = (transaction.custom_fields ?? {}) as Record<string, unknown>
      const salary = Number(cf.salary ?? transaction.salary ?? 0)
      const commissionPct = Number(cf.commission_percent ?? transaction.commission_percent ?? 0)
      const supplierPct = transaction.supplier_percent ?? 0
      const paymentSplit = selectedClient?.payment_split_json ?? []
      const candidateName = String(cf.candidate_name ?? transaction.candidate_name ?? '')
      const serviceType = transaction.service_type ?? ''

      const events = generateServiceBillingEvents({
        transactionId: transaction.id,
        salary,
        commissionPercent: commissionPct,
        workStartDate: transaction.work_start_date!,
        paymentSplit,
        advanceAmount: 0,
        supplierPercent: supplierPct,
        candidateName,
        serviceType,
      })
      await upsertBillingEvents(transaction.id, events, controller.signal)

      const isApproved = !transaction.needs_approval || !!transaction.approved_at
      if (isApproved) {
        const todayIso = new Date().toISOString().slice(0, 10)
        await supabase
          .from('billing_events')
          .update({ status: 'to_bill' })
          .eq('transaction_id', transaction.id)
          .eq('status', 'pending')
          .lte('billing_date', todayIso)
          .abortSignal(controller.signal)
      }

      onGenerated()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'שגיאה')
    } finally {
      clearTimeout(timer)
      setLoading(false)
    }
  }

  return (
    <div className="space-y-1">
      <p className="text-xs text-amber-700">
        עסקה זו נוצרה לפני מערכת החיובים האוטומטית. לחץ ליצירת אירועי חיוב.
      </p>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <Button
        size="sm"
        variant="outline"
        className="text-purple-700 border-purple-300"
        disabled={loading}
        onClick={handleGenerate}
      >
        {loading ? 'יוצר...' : 'צור אירועי חיוב'}
      </Button>
    </div>
  )
}

// Color scheme: gray = not yet actionable, blue = ready to invoice,
// amber = invoiced & awaiting payment, emerald/green = money received, red = cancelled.
// Green ALWAYS means "paid" — billed must not be green.
const STATUS_COLOR: Record<BillingEvent['status'], string> = {
  pending:   'bg-gray-400',
  to_bill:   'bg-blue-500',
  billed:    'bg-amber-400',
  paid:      'bg-emerald-600',
  cancelled: 'bg-red-400',
}

const STATUS_LABEL: Record<BillingEvent['status'], string> = {
  pending:   'ממתין',
  to_bill:   'לחיוב',
  billed:    'חויב',
  paid:      'שולם',
  cancelled: 'מבוטל',
}

function BillingEventRow({
  event,
  paymentTermsDays,
  onSaved,
  onDeleted,
}: {
  event: BillingEvent
  paymentTermsDays: number
  onSaved: () => void
  onDeleted: () => void
}) {
  const [invoiceNumber, setInvoiceNumber] = useState(event.invoice_number ?? '')
  const [receiptNumber, setReceiptNumber] = useState(event.receipt_number ?? '')
  const [taxInvoiceDateOverride, setTaxInvoiceDateOverride] = useState(event.payment_date ?? '')
  const [amountOverride, setAmountOverride] = useState(String(event.amount))
  const [billingDateOverride, setBillingDateOverride] = useState(event.billing_date ?? '')
  const [savingField, setSavingField] = useState<string | null>(null)
  const [rowError, setRowError] = useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const handleDelete = async () => {
    setDeleting(true)
    setRowError(null)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new DOMException('timeout', 'AbortError')), 10000)
    try {
      const { error } = await supabase.from('billing_events').delete().eq('id', event.id).abortSignal(controller.signal)
      if (error) throw error
      onDeleted()
    } catch (err) {
      console.error('BillingEventRow delete error:', err)
      const isTimeout = err instanceof DOMException && err.name === 'AbortError'
      setRowError(isTimeout ? 'פג זמן — נסה שנית' : 'שגיאה במחיקה')
    } finally {
      clearTimeout(timer)
      setDeleting(false)
    }
  }

  useEffect(() => {
    setInvoiceNumber(event.invoice_number ?? '')
    setReceiptNumber(event.receipt_number ?? '')
    setTaxInvoiceDateOverride(event.payment_date ?? '')
    setAmountOverride(String(event.amount))
    setBillingDateOverride(event.billing_date ?? '')
  }, [event.id, event.invoice_number, event.receipt_number, event.payment_date, event.amount, event.billing_date])

  const calculatedTaxDate = event.billing_date
    ? calculateTaxInvoiceDate(event.billing_date, paymentTermsDays)
    : null

  const taxDateDisplay = taxInvoiceDateOverride || calculatedTaxDate || ''

  const saveField = async (
    field: 'invoice_number' | 'payment_date' | 'receipt_number' | 'amount' | 'billing_date',
    value: string | number,
  ) => {
    setSavingField(field)
    setRowError(null)
    const patch: Record<string, unknown> = { [field]: value === '' ? null : value }

    if (field === 'invoice_number') {
      if (value && event.status !== 'billed' && event.status !== 'paid') {
        patch.status = 'billed'
      } else if (!value && event.status === 'billed') {
        patch.status = 'to_bill'
      }
    }
    if (field === 'receipt_number') {
      if (value) {
        patch.status = 'paid'
        if (!event.payment_date && calculatedTaxDate) {
          patch.payment_date = calculatedTaxDate
        }
      } else if (event.status === 'paid') {
        patch.status = event.invoice_number ? 'billed' : 'to_bill'
      }
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new DOMException('timeout', 'AbortError')), 10000)
    try {
      const { error } = await supabase.from('billing_events').update(patch).eq('id', event.id).abortSignal(controller.signal)
      if (error) throw error
      onSaved()
    } catch (err) {
      console.error('BillingEventRow save error:', err)
      const isTimeout = err instanceof DOMException && err.name === 'AbortError'
      setRowError(isTimeout ? 'פג זמן — נסה שנית' : 'שגיאה בשמירה')
    } finally {
      clearTimeout(timer)
      setSavingField(null)
    }
  }

  const ILS = new Intl.NumberFormat('he-IL', {
    style: 'currency',
    currency: 'ILS',
    maximumFractionDigits: 0,
  })

  return (
    <Card className="p-3 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span className={`inline-block w-2.5 h-2.5 rounded-full flex-shrink-0 ${STATUS_COLOR[event.status]}`} />
          <span className="text-sm font-medium">{event.description ?? '—'}</span>
          <Badge variant="outline" className="text-xs">{STATUS_LABEL[event.status]}</Badge>
        </div>
        <div className="flex items-center gap-2">
          <Input
            type="number"
            dir="ltr"
            className="h-7 w-28 text-sm font-bold text-purple-900"
            value={amountOverride}
            onChange={(e) => setAmountOverride(e.target.value)}
            onBlur={() => {
              const n = Number(amountOverride)
              if (amountOverride !== '' && !isNaN(n) && n !== event.amount) {
                void saveField('amount', n)
              }
            }}
            title={ILS.format(event.amount)}
          />
          {!deleteConfirm ? (
            <button
              type="button"
              onClick={() => setDeleteConfirm(true)}
              className="text-muted-foreground hover:text-red-500 transition-colors"
              title="מחק שורת חיוב"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          ) : (
            <div className="flex items-center gap-1 text-xs">
              <span className="text-red-600">מחק?</span>
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="text-red-600 hover:text-red-800 font-medium"
              >
                {deleting ? '...' : 'כן'}
              </button>
              <button
                type="button"
                onClick={() => setDeleteConfirm(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                ביטול
              </button>
            </div>
          )}
        </div>
      </div>

      {rowError && <p className="text-xs text-destructive text-right" dir="rtl">{rowError}</p>}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2 border border-blue-100 rounded-lg p-3 bg-blue-50/30">
          <h4 className="text-xs font-semibold text-blue-800 flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-full bg-blue-400" />
            חשבון עסקה
          </h4>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">תאריך חשבון</Label>
              <Input
                type="date"
                className="h-7 text-sm"
                value={billingDateOverride}
                onChange={(e) => setBillingDateOverride(e.target.value)}
                onBlur={() => {
                  if (billingDateOverride && billingDateOverride !== (event.billing_date ?? '')) {
                    void saveField('billing_date', billingDateOverride)
                  }
                }}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">מספר חשבון עסקה</Label>
              <Input
                className="h-7 text-sm"
                value={invoiceNumber}
                onChange={(e) => setInvoiceNumber(e.target.value)}
                onBlur={() => {
                  if (invoiceNumber !== (event.invoice_number ?? '')) {
                    void saveField('invoice_number', invoiceNumber)
                  }
                }}
                placeholder={savingField === 'invoice_number' ? 'שומר...' : 'מספר חשבון'}
              />
            </div>
          </div>
        </div>

        <div className="space-y-2 border border-green-100 rounded-lg p-3 bg-green-50/30">
          <h4 className="text-xs font-semibold text-green-800 flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />
            חשבונית מס קבלה
          </h4>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">
                תאריך פירעון
                {calculatedTaxDate && !taxInvoiceDateOverride && (
                  <span className="text-purple-600 mr-1">(מחושב)</span>
                )}
                {taxInvoiceDateOverride && (
                  <span className="text-amber-600 mr-1">(ידני)</span>
                )}
              </Label>
              <div className="flex gap-1 items-center">
                <Input
                  type="date"
                  className="h-7 text-sm"
                  value={taxDateDisplay}
                  onChange={(e) => setTaxInvoiceDateOverride(e.target.value)}
                  onBlur={() => {
                    const newVal = taxInvoiceDateOverride || calculatedTaxDate || ''
                    if (newVal !== (event.payment_date ?? '')) {
                      void saveField('payment_date', newVal)
                    }
                  }}
                />
                {taxInvoiceDateOverride && (
                  <button
                    type="button"
                    className="text-xs text-muted-foreground hover:text-foreground"
                    title="אפס לתאריך מחושב"
                    onClick={() => {
                      setTaxInvoiceDateOverride('')
                      if (calculatedTaxDate) {
                        void saveField('payment_date', calculatedTaxDate)
                      }
                    }}
                  >
                    ↩
                  </button>
                )}
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">מספר חשבונית מס קבלה</Label>
              <Input
                className="h-7 text-sm"
                value={receiptNumber}
                onChange={(e) => setReceiptNumber(e.target.value)}
                onBlur={() => {
                  if (receiptNumber !== (event.receipt_number ?? '')) {
                    void saveField('receipt_number', receiptNumber)
                  }
                }}
                placeholder={savingField === 'receipt_number' ? 'שומר...' : 'מספר חשבונית'}
              />
            </div>
          </div>
        </div>
      </div>
    </Card>
  )
}
