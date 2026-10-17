// דוח כספי שנתי (Repair 23) — rendered from Reports.tsx when the report picker
// is on "finance". Every number comes from src/lib/finance.ts.
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FileDown } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { exportSheetsToExcel } from '@/lib/excelExport'
import {
  availableYears,
  clientMonthMatrix,
  contractedByMonth,
  jerusalemYearMonth,
  openGiyusInYear,
  paidByMonth,
  type FinanceTransaction,
  type Metric,
} from '@/lib/finance'

const ILS = new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 })
const NUM = new Intl.NumberFormat('he-IL')
const MONTHS = [
  'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
]
const METRICS: { key: Metric; label: string }[] = [
  { key: 'income', label: 'הכנסה' },
  { key: 'invoice', label: 'סכום חשבונית' },
  { key: 'supplier', label: 'עמלת ספק' },
]
const money = (n: number) => (n === 0 ? '—' : ILS.format(n))
const count = (n: number) => (n === 0 ? '—' : NUM.format(n))

type PaidEvent = {
  id: string
  transaction_id: string
  amount: number | string | null
  supplier_amount: number | string | null
  status: string
  payment_date: string | null
  client_id: string | null
  client_name: string | null
}
type Tx = FinanceTransaction & {
  id: string
  client_id: string | null
  client_name: string | null
  service_type_id: string | null
  service_type: string | null
}

function useFinanceData() {
  const events = useQuery<PaidEvent[]>({
    queryKey: ['finance-report-events'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('billing_events')
        .select('id, transaction_id, amount, supplier_amount, status, payment_date, transactions!inner ( client_id, client_name )')
        .eq('status', 'paid')
        .limit(5000)
      if (error) throw error
      type Raw = Omit<PaidEvent, 'client_id' | 'client_name'> & {
        transactions: { client_id: string | null; client_name: string | null } | null
      }
      return ((data ?? []) as unknown as Raw[]).map((r) => ({
        ...r,
        client_id: r.transactions?.client_id ?? null,
        client_name: r.transactions?.client_name ?? null,
      }))
    },
  })
  const txs = useQuery<Tx[]>({
    queryKey: ['finance-report-transactions'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('transactions')
        .select('id, client_id, client_name, service_type_id, service_type, close_date, entry_date, period_start, net_invoice_amount, supplier_percent')
        .limit(5000)
      if (error) throw error
      return (data ?? []) as Tx[]
    },
  })
  const types = useQuery<{ id: string; name: string }[]>({
    queryKey: ['finance-report-service-types'],
    queryFn: async () => {
      const { data, error } = await supabase.from('service_types').select('id, name')
      if (error) throw error
      return (data ?? []) as { id: string; name: string }[]
    },
  })
  return { events, txs, types }
}

export default function FinanceReport() {
  const { events, txs, types } = useFinanceData()
  const { year: currentYear } = jerusalemYearMonth()
  const [yearSel, setYearSel] = useState<number | null>(null)
  const [metric, setMetric] = useState<Metric>('income')

  const nameById = useMemo(() => new Map((types.data ?? []).map((s) => [s.id, s.name])), [types.data])
  const resolveName = (t: Tx) => (t.service_type_id && nameById.get(t.service_type_id)) || t.service_type

  const loading = events.isLoading || txs.isLoading || types.isLoading
  const failed = events.isError || txs.isError || types.isError
  const year = yearSel ?? currentYear

  const years = useMemo(
    () => (events.data && txs.data ? availableYears(events.data, txs.data, currentYear, resolveName) : [currentYear]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [events.data, txs.data, nameById, currentYear],
  )

  const A = useMemo(() => (events.data ? paidByMonth(events.data, year) : null), [events.data, year])
  const B = useMemo(
    () => (txs.data ? contractedByMonth(txs.data, year, resolveName) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [txs.data, nameById, year],
  )
  const open = useMemo(
    () => (txs.data ? openGiyusInYear(txs.data, year, resolveName) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [txs.data, nameById, year],
  )
  const C = useMemo(
    () =>
      events.data
        ? clientMonthMatrix(
            events.data, year, metric,
            (e) => e.client_id ?? `name:${(e.client_name ?? '').trim()}`,
            (e) => (e.client_name ?? '').trim() || 'ללא לקוח',
          )
        : null,
    [events.data, year, metric],
  )

  const handleExport = () => {
    if (!A || !B || !C) return
    const metricLabel = METRICS.find((m) => m.key === metric)!.label
    exportSheetsToExcel(
      [
        {
          name: 'לפי חודש תשלום',
          rows: [
            ...A.rows.map((r) => ({ חודש: MONTHS[r.month - 1], 'סכום חשבונית': r.invoice, 'עמלת ספק': r.supplier, הכנסה: r.income, עסקאות: r.deals })),
            { חודש: 'סה"כ', 'סכום חשבונית': A.total.invoice, 'עמלת ספק': A.total.supplier, הכנסה: A.total.income, עסקאות: A.total.deals },
          ],
        },
        {
          name: 'לפי חודש סגירה',
          rows: [
            ...B.rows.map((r) => ({ חודש: MONTHS[r.month - 1], עסקאות: r.deals, 'סכום חשבונית': r.invoice, 'עמלת ספק': r.supplier, הכנסה: r.income })),
            { חודש: 'סה"כ', עסקאות: B.total.deals, 'סכום חשבונית': B.total.invoice, 'עמלת ספק': B.total.supplier, הכנסה: B.total.income },
          ],
        },
        {
          name: `לקוח × חודש (${metricLabel})`,
          rows: [
            ...C.rows.map((r) => {
              const o: Record<string, unknown> = { לקוח: r.label }
              MONTHS.forEach((m, i) => { o[m] = r.months[i] })
              o['סה"כ שנתי'] = r.total
              o['% מהשנה'] = Math.round(r.pct * 10) / 10
              return o
            }),
            (() => {
              const o: Record<string, unknown> = { לקוח: 'סה"כ' }
              MONTHS.forEach((m, i) => { o[m] = C.colTotals[i] })
              o['סה"כ שנתי'] = C.grand
              o['% מהשנה'] = C.grand > 0 ? 100 : 0
              return o
            })(),
          ],
        },
      ],
      `דוח-כספי-${year}.xlsx`,
    )
  }

  if (loading) return <div className="p-8 text-center text-muted-foreground">טוען...</div>
  if (failed || !A || !B || !C || !open) {
    return (
      <div className="p-8 text-center space-y-3">
        <p className="text-sm text-destructive">שגיאה בטעינת הנתונים.</p>
        <Button size="sm" variant="outline" onClick={() => { events.refetch(); txs.refetch(); types.refetch() }}>
          נסה שוב
        </Button>
      </div>
    )
  }

  const noPaid = A.total.deals === 0 && A.total.invoice === 0
  const noDeals = B.total.deals === 0

  return (
    <div className="space-y-4" data-testid="finance-report">
      <Card className="p-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">שנה</span>
            <Select value={String(year)} onValueChange={(v) => setYearSel(Number(v))}>
              <SelectTrigger className="w-28" data-testid="finance-year">
                <span className="text-sm">{year}</span>
              </SelectTrigger>
              <SelectContent>
                {years.map((y) => (<SelectItem key={y} value={String(y)}>{y}</SelectItem>))}
              </SelectContent>
            </Select>
          </div>
          <Button size="sm" variant="outline" onClick={handleExport}>
            <FileDown className="w-4 h-4 ml-1" />
            ייצוא לאקסל
          </Button>
        </div>
      </Card>

      {/* Section A */}
      <Card data-testid="section-a">
        <CardHeader><CardTitle className="text-base font-semibold">לפי חודש תשלום</CardTitle></CardHeader>
        <CardContent>
          {noPaid ? (
            <p className="text-sm text-muted-foreground py-6 text-center">אין נתונים לשנה זו</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-right">חודש</TableHead>
                    <TableHead className="text-right">סכום חשבונית</TableHead>
                    <TableHead className="text-right">עמלת ספק</TableHead>
                    <TableHead className="text-right">הכנסה</TableHead>
                    <TableHead className="text-right">עסקאות</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {A.rows.map((r) => (
                    <TableRow key={r.month}>
                      <TableCell className="text-right font-medium">{MONTHS[r.month - 1]}</TableCell>
                      <TableCell className="text-right">{money(r.invoice)}</TableCell>
                      <TableCell className="text-right">{money(r.supplier)}</TableCell>
                      <TableCell className="text-right">{money(r.income)}</TableCell>
                      <TableCell className="text-right">{count(r.deals)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow className="bg-purple-50 hover:bg-purple-50 font-semibold text-purple-900">
                    <TableCell className="text-right">סה"כ</TableCell>
                    <TableCell className="text-right">{money(A.total.invoice)}</TableCell>
                    <TableCell className="text-right">{money(A.total.supplier)}</TableCell>
                    <TableCell className="text-right">{money(A.total.income)}</TableCell>
                    <TableCell className="text-right">{count(A.total.deals)}</TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
              <p className="mt-2 text-xs text-muted-foreground">
                * מספר העסקאות בשורת הסיכום הוא מספר עסקאות ייחודיות לאורך השנה, ולא סכום הספירות החודשיות (עסקה ששולמה בשני חודשים נספרת פעם אחת).
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Section B */}
      <Card data-testid="section-b">
        <CardHeader><CardTitle className="text-base font-semibold">לפי חודש סגירת עסקה</CardTitle></CardHeader>
        <CardContent>
          {noDeals ? (
            <p className="text-sm text-muted-foreground py-6 text-center">אין נתונים לשנה זו</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-right">חודש</TableHead>
                    <TableHead className="text-right">עסקאות</TableHead>
                    <TableHead className="text-right">סכום חשבונית</TableHead>
                    <TableHead className="text-right">עמלת ספק</TableHead>
                    <TableHead className="text-right">הכנסה</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {B.rows.map((r) => (
                    <TableRow key={r.month}>
                      <TableCell className="text-right font-medium">{MONTHS[r.month - 1]}</TableCell>
                      <TableCell className="text-right">{count(r.deals)}</TableCell>
                      <TableCell className="text-right">{money(r.invoice)}</TableCell>
                      <TableCell className="text-right">{money(r.supplier)}</TableCell>
                      <TableCell className="text-right">{money(r.income)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow className="bg-purple-50 hover:bg-purple-50 font-semibold text-purple-900">
                    <TableCell className="text-right">סה"כ</TableCell>
                    <TableCell className="text-right">{count(B.total.deals)}</TableCell>
                    <TableCell className="text-right">{money(B.total.invoice)}</TableCell>
                    <TableCell className="text-right">{money(B.total.supplier)}</TableCell>
                    <TableCell className="text-right">{money(B.total.income)}</TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </div>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            גיוס נספר לפי תאריך סגירה; שאר השירותים לפי תאריך פתיחה. משרות גיוס פתוחות (ללא תאריך סגירה) אינן נכללות.
          </p>
          <p className="mt-1 text-xs text-muted-foreground" data-testid="open-giyus">
            משרות גיוס פתוחות שנפתחו בשנה זו (לא נכללות): {NUM.format(open.count)} · סכום חשבונית {ILS.format(open.invoice)}
          </p>
        </CardContent>
      </Card>

      {/* Section C */}
      <Card data-testid="section-c">
        <CardHeader>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <CardTitle className="text-base font-semibold">הכנסות לפי לקוח וחודש</CardTitle>
            <div className="inline-flex rounded-md border border-purple-200 overflow-hidden" role="group" aria-label="מדד">
              {METRICS.map((m) => (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => setMetric(m.key)}
                  aria-pressed={metric === m.key}
                  className={`px-3 py-1 text-sm ${metric === m.key ? 'bg-purple-600 text-white' : 'bg-white text-purple-800 hover:bg-purple-50'}`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {C.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">אין נתונים לשנה זו</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-right sticky right-0 z-10 bg-background min-w-40">לקוח</TableHead>
                    {MONTHS.map((m) => (<TableHead key={m} className="text-right whitespace-nowrap">{m}</TableHead>))}
                    <TableHead className="text-right whitespace-nowrap">סה"כ שנתי</TableHead>
                    <TableHead className="text-right whitespace-nowrap">% מהשנה</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {C.rows.map((r) => (
                    <TableRow key={r.key}>
                      <TableCell className="text-right font-medium sticky right-0 z-10 bg-background">{r.label}</TableCell>
                      {r.months.map((v, i) => (<TableCell key={i} className="text-right whitespace-nowrap">{money(v)}</TableCell>))}
                      <TableCell className="text-right whitespace-nowrap font-semibold">{money(r.total)}</TableCell>
                      <TableCell className="text-right whitespace-nowrap">{r.pct.toFixed(1)}%</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow className="bg-purple-50 hover:bg-purple-50 font-semibold text-purple-900">
                    <TableCell className="text-right sticky right-0 z-10 bg-purple-50">סה"כ</TableCell>
                    {C.colTotals.map((v, i) => (<TableCell key={i} className="text-right whitespace-nowrap">{money(v)}</TableCell>))}
                    <TableCell className="text-right whitespace-nowrap">{money(C.grand)}</TableCell>
                    <TableCell className="text-right whitespace-nowrap">100%</TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
