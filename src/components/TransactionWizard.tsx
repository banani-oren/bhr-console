import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { Client, Transaction, Profile } from '@/lib/types'
import type { ServiceField, ServiceType } from '@/lib/serviceTypes'
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

const HEBREW_MONTHS = [
  'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
]

// Keys mirrored into dedicated transactions columns so filters/queries stay fast.
const MIRRORED_KEYS = new Set([
  'position_name',
  'candidate_name',
  'commission_percent',
  'salary',
  'net_invoice_amount',
  'commission_amount',
  'service_lead',
])

export type WizardValues = {
  client_name: string
  client_id: string | null
  service_type_id: string | null
  service_type_name: string
  entry_date: string
  billing_month: number
  billing_year: number
  close_date: string | null
  closing_month: number | null
  closing_year: number | null
  payment_date: string | null
  payment_status: string
  is_billable: boolean
  invoice_number: string | null
  notes: string | null
  custom: Record<string, unknown>
}

const emptyWizard = (): WizardValues => ({
  client_name: '',
  client_id: null,
  service_type_id: null,
  service_type_name: '',
  entry_date: new Date().toISOString().slice(0, 10),
  billing_month: new Date().getMonth() + 1,
  billing_year: new Date().getFullYear(),
  close_date: null,
  closing_month: null,
  closing_year: null,
  payment_date: null,
  payment_status: 'ממתין',
  is_billable: true,
  invoice_number: null,
  notes: null,
  custom: {},
})

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  editing: Transaction | null
  initial?: Partial<WizardValues>
  initialStep?: 1 | 2 | 3
  onSaved?: () => void
}

export default function TransactionWizard({
  open,
  onOpenChange,
  editing,
  initial,
  initialStep = 1,
  onSaved,
}: Props) {
  const queryClient = useQueryClient()

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
        .in('role', ['recruiter', 'administration'])
        .order('full_name', { ascending: true })
      if (error) throw error
      return data as Profile[]
    },
  })

  const [step, setStep] = useState<1 | 2 | 3>(initialStep)
  const [values, setValues] = useState<WizardValues>(emptyWizard())
  const [clientSearch, setClientSearch] = useState('')
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle')

  // Reset / load values when dialog opens
  useEffect(() => {
    if (!open) return
    setStep(initialStep)
    setSaveStatus('idle')
    setClientSearch('')
    if (editing) {
      const custom =
        typeof editing.custom_fields === 'object' && editing.custom_fields
          ? { ...(editing.custom_fields as Record<string, unknown>) }
          : {}
      // Mirror dedicated columns back into custom so the dynamic form pre-fills.
      for (const k of MIRRORED_KEYS) {
        const col = (editing as unknown as Record<string, unknown>)[k]
        if (col != null && custom[k] == null) custom[k] = col
      }
      setValues({
        client_name: editing.client_name ?? '',
        client_id: (clients.find((c) => c.name === editing.client_name)?.id) ?? null,
        service_type_id: editing.service_type_id,
        service_type_name: editing.service_type ?? '',
        entry_date: editing.entry_date ?? new Date().toISOString().slice(0, 10),
        billing_month: editing.billing_month ?? new Date().getMonth() + 1,
        billing_year: editing.billing_year ?? new Date().getFullYear(),
        close_date: editing.close_date,
        closing_month: editing.closing_month,
        closing_year: editing.closing_year,
        payment_date: editing.payment_date,
        payment_status: editing.payment_status ?? 'ממתין',
        is_billable: editing.is_billable ?? true,
        invoice_number: editing.invoice_number,
        notes: editing.notes,
        custom,
      })
    } else {
      setValues({ ...emptyWizard(), ...(initial ?? {}) })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing?.id])

  const selectedClient = useMemo(
    () => clients.find((c) => c.id === values.client_id) ?? null,
    [clients, values.client_id],
  )

  const selectedServiceType = useMemo(
    () => serviceTypes.find((s) => s.id === values.service_type_id) ?? null,
    [serviceTypes, values.service_type_id],
  )

  const pickClient = (client: Client) => {
    setValues((v) => ({
      ...v,
      client_id: client.id,
      client_name: client.name,
      // Pre-fill universal agreement-derived fields if empty.
      custom: {
        ...v.custom,
        commission_percent:
          v.custom.commission_percent ?? client.commission_percent ?? null,
      },
      // Also mirror payment terms / split onto values if not yet set — these
      // don't have dedicated wizard UI but are carried as hints in notes/etc.
    }))
  }

  const pickServiceType = (st: ServiceType) => {
    setValues((v) => {
      const nextCustom = { ...v.custom }
      for (const f of st.fields) {
        if (nextCustom[f.key] === undefined && f.default != null) {
          nextCustom[f.key] = f.default as unknown
        }
      }
      return {
        ...v,
        service_type_id: st.id,
        service_type_name: st.name,
        custom: nextCustom,
      }
    })
  }

  const setCustom = (key: string, val: unknown) => {
    setValues((v) => ({ ...v, custom: { ...v.custom, [key]: val } }))
  }

  const canAdvance = () => {
    if (step === 1) return !!values.client_id
    if (step === 2) return !!values.service_type_id
    if (step === 3) {
      if (!selectedServiceType) return false
      for (const f of selectedServiceType.fields) {
        if (f.required) {
          const v = values.custom[f.key]
          if (v == null || v === '') return false
        }
      }
    }
    return true
  }

  const filteredClients = useMemo(() => {
    const q = clientSearch.trim().toLowerCase()
    if (!q) return clients
    return clients.filter((c) => c.name.toLowerCase().includes(q))
  }, [clients, clientSearch])

  const handleSave = async () => {
    if (!selectedServiceType) return
    setSaveStatus('saving')
    try {
      const mirrored: Record<string, unknown> = {}
      for (const k of MIRRORED_KEYS) {
        if (values.custom[k] !== undefined) mirrored[k] = values.custom[k]
      }
      const payload: Record<string, unknown> = {
        client_name: values.client_name,
        service_type: values.service_type_name,
        service_type_id: values.service_type_id,
        entry_date: values.entry_date,
        billing_month: values.billing_month,
        billing_year: values.billing_year,
        close_date: values.close_date,
        closing_month: values.closing_month,
        closing_year: values.closing_year,
        payment_date: values.payment_date,
        payment_status: values.payment_status,
        is_billable: values.is_billable,
        invoice_number: values.invoice_number,
        notes: values.notes,
        custom_fields: values.custom,
        ...mirrored,
      }
      // Coerce mirrored numeric keys if they came in as strings.
      for (const k of ['commission_percent', 'salary', 'net_invoice_amount', 'commission_amount']) {
        if (payload[k] !== undefined && payload[k] !== null && payload[k] !== '') {
          payload[k] = Number(payload[k])
        }
      }
      if (editing) {
        const { error } = await supabase.from('transactions').update(payload).eq('id', editing.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('transactions').insert(payload)
        if (error) throw error
      }
      queryClient.invalidateQueries({ queryKey: ['transactions'] })
      setSaveStatus('success')
      setTimeout(() => {
        setSaveStatus('idle')
        onOpenChange(false)
        onSaved?.()
      }, 1200)
    } catch (err) {
      console.error('Wizard save error:', err)
      setSaveStatus('error')
    }
  }

  const renderField = (f: ServiceField) => {
    const value = values.custom[f.key]
    const widthCls = f.width === 'full' ? 'md:col-span-2' : ''
    const label = `${f.label}${f.required ? ' *' : ''}`
    const common = (child: React.ReactNode) => (
      <div key={f.key} className={`space-y-1 ${widthCls}`}>
        <Label className="text-purple-700">{label}</Label>
        {child}
      </div>
    )
    switch (f.type) {
      case 'text':
        return common(
          <Input
            value={(value as string) ?? ''}
            onChange={(e) => setCustom(f.key, e.target.value)}
          />,
        )
      case 'textarea':
        return common(
          <Textarea
            value={(value as string) ?? ''}
            onChange={(e) => setCustom(f.key, e.target.value)}
            rows={3}
          />,
        )
      case 'number':
      case 'currency':
      case 'percent':
        return common(
          <Input
            type="number"
            dir="ltr"
            value={(value as number | string | undefined) ?? ''}
            onChange={(e) => setCustom(f.key, e.target.value === '' ? null : Number(e.target.value))}
          />,
        )
      case 'date':
        return common(
          <Input
            type="date"
            value={(value as string) ?? ''}
            onChange={(e) => setCustom(f.key, e.target.value || null)}
          />,
        )
      case 'month':
        return common(
          <Select
            value={value != null ? String(value) : 'none'}
            onValueChange={(v) => setCustom(f.key, v === 'none' ? null : Number(v))}
          >
            <SelectTrigger><SelectValue placeholder="בחר חודש" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">לא נבחר</SelectItem>
              {HEBREW_MONTHS.map((n, i) => <SelectItem key={i + 1} value={String(i + 1)}>{n}</SelectItem>)}
            </SelectContent>
          </Select>,
        )
      case 'year':
        return common(
          <Input
            type="number"
            dir="ltr"
            value={(value as number | string | undefined) ?? ''}
            onChange={(e) => setCustom(f.key, e.target.value === '' ? null : Number(e.target.value))}
          />,
        )
      case 'select':
        return common(
          <Select
            value={(value as string) ?? ''}
            onValueChange={(v) => setCustom(f.key, v)}
          >
            <SelectTrigger><SelectValue placeholder="בחר" /></SelectTrigger>
            <SelectContent>
              {(f.options ?? []).map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
            </SelectContent>
          </Select>,
        )
      case 'boolean':
        return common(
          <div className="flex items-center gap-2 pt-1">
            <Switch
              checked={!!value}
              onCheckedChange={(v) => setCustom(f.key, v)}
            />
            <span className="text-sm text-gray-600">{value ? 'כן' : 'לא'}</span>
          </div>,
        )
      case 'employee':
        return common(
          <Select
            value={(value as string) ?? ''}
            onValueChange={(v) => setCustom(f.key, v)}
          >
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {editing ? 'עריכת עסקה' : 'הוספת עסקה'} · שלב {step} / 3
          </DialogTitle>
        </DialogHeader>

        {/* Stepper */}
        <div className="flex items-center gap-2 text-xs mb-2">
          {[1, 2, 3].map((n) => (
            <div
              key={n}
              className={`flex-1 text-center px-2 py-1 rounded border ${
                step === n ? 'bg-purple-600 text-white border-purple-600' : 'bg-muted/30 text-muted-foreground border-muted'
              }`}
            >
              {n === 1 ? 'לקוח' : n === 2 ? 'סוג שירות' : 'פרטים'}
            </div>
          ))}
        </div>

        {/* Step 1: Client */}
        {step === 1 && (
          <div className="space-y-3">
            <Input
              placeholder="חיפוש לקוח..."
              value={clientSearch}
              onChange={(e) => setClientSearch(e.target.value)}
            />
            <div className="max-h-[50vh] overflow-y-auto border rounded">
              {filteredClients.length === 0 ? (
                <div className="p-4 text-center text-muted-foreground text-sm">לא נמצאו לקוחות</div>
              ) : (
                <ul>
                  {filteredClients.map((c) => (
                    <li
                      key={c.id}
                      onClick={() => pickClient(c)}
                      className={`px-3 py-2 cursor-pointer border-b last:border-0 text-sm flex items-center justify-between ${
                        values.client_id === c.id ? 'bg-purple-100' : 'hover:bg-purple-50'
                      }`}
                    >
                      <span className="font-medium">{c.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {c.agreement_type ?? '—'}
                        {c.commission_percent != null ? ` · ${c.commission_percent}%` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {selectedClient && (
              <Card className="p-3 text-xs text-muted-foreground">
                נבחר: <span className="font-semibold text-foreground">{selectedClient.name}</span>
              </Card>
            )}
          </div>
        )}

        {/* Step 2: Service type */}
        {step === 2 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {serviceTypes.map((st) => {
              const active = values.service_type_id === st.id
              return (
                <button
                  key={st.id}
                  type="button"
                  onClick={() => pickServiceType(st)}
                  className={`p-3 text-right rounded border transition-colors ${
                    active ? 'bg-purple-600 text-white border-purple-600' : 'bg-muted/30 hover:bg-purple-50 border-muted'
                  }`}
                >
                  <div className="font-semibold">{st.name}</div>
                  <div className={`text-xs mt-1 ${active ? 'text-white/80' : 'text-muted-foreground'}`}>
                    {st.fields.length} שדות
                  </div>
                </button>
              )
            })}
          </div>
        )}

        {/* Step 3: Details */}
        {step === 3 && selectedServiceType && (
          <div className="space-y-5">
            {/* Universal fields */}
            <section>
              <h3 className="text-sm font-semibold text-purple-700 mb-2">שדות כלליים</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-purple-700">תאריך כניסה</Label>
                  <Input
                    type="date"
                    value={values.entry_date}
                    onChange={(e) => setValues((v) => ({ ...v, entry_date: e.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-purple-700">חודש כניסה</Label>
                  <Select
                    value={String(values.billing_month)}
                    onValueChange={(v) => setValues((s) => ({ ...s, billing_month: Number(v) }))}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {HEBREW_MONTHS.map((n, i) => <SelectItem key={i + 1} value={String(i + 1)}>{n}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-purple-700">שנת כניסה</Label>
                  <Input
                    type="number"
                    dir="ltr"
                    value={values.billing_year}
                    onChange={(e) => setValues((s) => ({ ...s, billing_year: Number(e.target.value) }))}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-purple-700">תאריך סגירה</Label>
                  <Input
                    type="date"
                    value={values.close_date ?? ''}
                    onChange={(e) => setValues((s) => ({ ...s, close_date: e.target.value || null }))}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-purple-700">חודש סגירה</Label>
                  <Select
                    value={values.closing_month != null ? String(values.closing_month) : 'none'}
                    onValueChange={(v) =>
                      setValues((s) => ({ ...s, closing_month: v === 'none' ? null : Number(v) }))
                    }
                  >
                    <SelectTrigger><SelectValue placeholder="לא נבחר" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">לא נבחר</SelectItem>
                      {HEBREW_MONTHS.map((n, i) => <SelectItem key={i + 1} value={String(i + 1)}>{n}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-purple-700">שנת סגירה</Label>
                  <Input
                    type="number"
                    dir="ltr"
                    value={values.closing_year ?? ''}
                    onChange={(e) =>
                      setValues((s) => ({ ...s, closing_year: e.target.value === '' ? null : Number(e.target.value) }))
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-purple-700">תאריך תשלום</Label>
                  <Input
                    type="date"
                    value={values.payment_date ?? ''}
                    onChange={(e) => setValues((s) => ({ ...s, payment_date: e.target.value || null }))}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-purple-700">סטטוס תשלום</Label>
                  <Input
                    value={values.payment_status}
                    onChange={(e) => setValues((s) => ({ ...s, payment_status: e.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-purple-700">מספר חשבונית</Label>
                  <Input
                    value={values.invoice_number ?? ''}
                    onChange={(e) => setValues((s) => ({ ...s, invoice_number: e.target.value || null }))}
                  />
                </div>
                <div className="space-y-1 flex flex-col justify-center">
                  <Label className="text-purple-700">חיוב</Label>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={values.is_billable}
                      onCheckedChange={(v) => setValues((s) => ({ ...s, is_billable: v }))}
                    />
                    <span className="text-sm text-gray-600">{values.is_billable ? 'כן' : 'לא'}</span>
                  </div>
                </div>
                <div className="space-y-1 md:col-span-2">
                  <Label className="text-purple-700">הערות</Label>
                  <Textarea
                    value={values.notes ?? ''}
                    onChange={(e) => setValues((s) => ({ ...s, notes: e.target.value || null }))}
                    rows={2}
                  />
                </div>
              </div>
            </section>

            {/* Custom fields */}
            <section>
              <h3 className="text-sm font-semibold text-purple-700 mb-2">
                שדות {selectedServiceType.name}
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {selectedServiceType.fields.map(renderField)}
              </div>
            </section>
          </div>
        )}

        <DialogFooter className="flex flex-col gap-2">
          {saveStatus === 'success' && <p className="text-green-600 text-sm text-right">נשמר ✓</p>}
          {saveStatus === 'error' && <p className="text-red-600 text-sm text-right">שגיאה בשמירה</p>}
          <div className="flex justify-between gap-2">
            <div>
              {step > 1 && (
                <Button
                  variant="outline"
                  onClick={() => setStep((s) => (s - 1) as 1 | 2 | 3)}
                  disabled={saveStatus === 'saving'}
                >
                  <ChevronRight className="h-4 w-4 ml-1" />
                  חזרה
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saveStatus === 'saving'}>
                ביטול
              </Button>
              {step < 3 ? (
                <Button
                  onClick={() => setStep((s) => (s + 1) as 1 | 2 | 3)}
                  disabled={!canAdvance()}
                  className="bg-purple-600 hover:bg-purple-700 text-white"
                >
                  המשך
                  <ChevronLeft className="h-4 w-4 mr-1" />
                </Button>
              ) : (
                <Button
                  onClick={handleSave}
                  disabled={!canAdvance() || saveStatus === 'saving'}
                  className="bg-purple-600 hover:bg-purple-700 text-white"
                >
                  {saveStatus === 'saving' ? 'שומר...' : 'שמור'}
                </Button>
              )}
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
