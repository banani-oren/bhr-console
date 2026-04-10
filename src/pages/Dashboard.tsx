import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Transaction } from '@/lib/types'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts'
import {
  Receipt,
  TrendingUp,
  Percent,
  Clock,
} from 'lucide-react'

// ── constants ──────────────────────────────────────────────────────────────
const CHART_COLORS = ['#7c3aed', '#a855f7', '#c084fc', '#e9d5ff', '#8b5cf6']

const ILS = new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS' })
const NUM = new Intl.NumberFormat('he-IL')

// Hebrew month names
const HE_MONTHS = [
  'ינו', 'פבר', 'מרץ', 'אפר', 'מאי', 'יוני',
  'יולי', 'אוג', 'ספט', 'אוק', 'נוב', 'דצמ',
]

// ── helpers ────────────────────────────────────────────────────────────────
function buildMonthlyRevenue(transactions: Transaction[]) {
  const now = new Date()
  const months: { label: string; year: number; month: number }[] = []

  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    months.push({
      label: `${HE_MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`,
      year: d.getFullYear(),
      month: d.getMonth() + 1,
    })
  }

  return months.map(({ label, year, month }) => {
    const revenue = transactions
      .filter((t) => t.billing_year === year && t.billing_month === month)
      .reduce((sum, t) => sum + (t.net_invoice_amount ?? 0), 0)
    return { label, revenue }
  })
}

function buildStatusData(transactions: Transaction[]) {
  const counts: Record<string, number> = {}
  for (const t of transactions) {
    const s = t.payment_status ?? 'לא ידוע'
    counts[s] = (counts[s] ?? 0) + 1
  }
  return Object.entries(counts).map(([name, value]) => ({ name, value }))
}

function buildLeadRevenue(transactions: Transaction[]) {
  const totals: Record<string, number> = {}
  for (const t of transactions) {
    const lead = t.service_lead ?? 'לא ידוע'
    totals[lead] = (totals[lead] ?? 0) + (t.net_invoice_amount ?? 0)
  }
  return Object.entries(totals)
    .map(([name, revenue]) => ({ name, revenue }))
    .sort((a, b) => b.revenue - a.revenue)
}

function statusBadgeClass(status: string) {
  if (status === 'שולם') return 'bg-green-100 text-green-700'
  if (status === 'ממתין') return 'bg-amber-100 text-amber-700'
  if (status === 'בוטל') return 'bg-red-100 text-red-700'
  return 'bg-gray-100 text-gray-600'
}

// ── custom tooltip ─────────────────────────────────────────────────────────
function RevenueTooltip({ active, payload, label }: {
  active?: boolean
  payload?: { value: number }[]
  label?: string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg bg-popover px-3 py-2 text-sm shadow-md ring-1 ring-foreground/10">
      <p className="font-medium text-foreground mb-1">{label}</p>
      <p className="text-muted-foreground">{ILS.format(payload[0].value)}</p>
    </div>
  )
}

function PieTooltip({ active, payload }: {
  active?: boolean
  payload?: { name: string; value: number }[]
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg bg-popover px-3 py-2 text-sm shadow-md ring-1 ring-foreground/10">
      <p className="font-medium text-foreground">{payload[0].name}</p>
      <p className="text-muted-foreground">{NUM.format(payload[0].value)} עסקאות</p>
    </div>
  )
}

// ── component ──────────────────────────────────────────────────────────────
export default function Dashboard() {
  const { data: transactions = [], isLoading } = useQuery<Transaction[]>({
    queryKey: ['transactions'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('transactions')
        .select('*')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as Transaction[]
    },
  })

  // ── derived KPIs ──────────────────────────────────────────────────────
  const totalCount = transactions.length
  const totalRevenue = transactions.reduce(
    (sum, t) => sum + (t.net_invoice_amount ?? 0),
    0,
  )
  const billablePercent =
    totalCount > 0
      ? Math.round(
          (transactions.filter((t) => t.is_billable).length / totalCount) * 100,
        )
      : 0
  const openCount = transactions.filter(
    (t) => t.payment_status === 'ממתין',
  ).length

  // ── chart data ────────────────────────────────────────────────────────
  const monthlyRevenue = buildMonthlyRevenue(transactions)
  const statusData = buildStatusData(transactions)
  const leadRevenue = buildLeadRevenue(transactions)
  const recentTransactions = transactions.slice(0, 10)

  // ── KPI card definitions ──────────────────────────────────────────────
  const kpiCards = [
    {
      title: 'סה"כ עסקאות',
      value: NUM.format(totalCount),
      icon: <Receipt size={20} className="text-purple-600" />,
      sub: 'כלל העסקאות במערכת',
    },
    {
      title: 'הכנסות',
      value: ILS.format(totalRevenue),
      icon: <TrendingUp size={20} className="text-purple-600" />,
      sub: 'סכום חשבוניות נטו',
    },
    {
      title: '% חיוב',
      value: `${billablePercent}%`,
      icon: <Percent size={20} className="text-purple-600" />,
      sub: 'עסקאות לחיוב מסך הכל',
    },
    {
      title: 'עסקאות פתוחות',
      value: NUM.format(openCount),
      icon: <Clock size={20} className="text-purple-600" />,
      sub: 'ממתינות לתשלום',
    },
  ]

  if (isLoading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[40vh]">
        <p className="text-muted-foreground text-sm">טוען נתונים...</p>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6" dir="rtl">
      {/* Page title */}
      <h1 className="text-2xl font-bold tracking-tight text-foreground">
        דשבורד
      </h1>

      {/* ── KPI grid ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpiCards.map((card) => (
          <Card key={card.title}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {card.title}
                </CardTitle>
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-50">
                  {card.icon}
                </span>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-foreground leading-none">
                {card.value}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">{card.sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ── Charts row 1: monthly revenue + status donut ──────────────── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Monthly revenue bar chart — takes 2 cols */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base font-semibold">
              הכנסות חודשיות – 12 חודשים אחרונים
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart
                data={monthlyRevenue}
                margin={{ top: 4, right: 4, left: 8, bottom: 4 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="currentColor"
                  className="text-border"
                  vertical={false}
                />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  tickFormatter={(v: number) =>
                    v >= 1000 ? `${(v / 1000).toFixed(0)}K` : String(v)
                  }
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  width={48}
                />
                <Tooltip content={<RevenueTooltip />} />
                <Bar
                  dataKey="revenue"
                  fill="#7c3aed"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={40}
                />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Status donut chart */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold">
              עסקאות לפי סטטוס תשלום
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-4">
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={statusData}
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={85}
                  paddingAngle={3}
                  dataKey="value"
                >
                  {statusData.map((_, i) => (
                    <Cell
                      key={i}
                      fill={CHART_COLORS[i % CHART_COLORS.length]}
                    />
                  ))}
                </Pie>
                <Tooltip content={<PieTooltip />} />
              </PieChart>
            </ResponsiveContainer>

            {/* Legend */}
            <div className="flex flex-wrap justify-center gap-x-4 gap-y-1.5">
              {statusData.map((entry, i) => (
                <div key={entry.name} className="flex items-center gap-1.5 text-xs">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-full shrink-0"
                    style={{ background: CHART_COLORS[i % CHART_COLORS.length] }}
                  />
                  <span className="text-muted-foreground">{entry.name}</span>
                  <span className="font-medium text-foreground">
                    ({entry.value})
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Revenue by service lead ───────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">
            הכנסות לפי ליד שירות
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart
              data={leadRevenue}
              layout="vertical"
              margin={{ top: 4, right: 16, left: 4, bottom: 4 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="currentColor"
                className="text-border"
                horizontal={false}
              />
              <XAxis
                type="number"
                tickFormatter={(v: number) =>
                  v >= 1000 ? `${(v / 1000).toFixed(0)}K` : String(v)
                }
                tick={{ fontSize: 11 }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                type="category"
                dataKey="name"
                tick={{ fontSize: 12 }}
                tickLine={false}
                axisLine={false}
                width={80}
              />
              <Tooltip content={<RevenueTooltip />} />
              <Bar
                dataKey="revenue"
                radius={[0, 4, 4, 0]}
                maxBarSize={32}
              >
                {leadRevenue.map((_, i) => (
                  <Cell
                    key={i}
                    fill={CHART_COLORS[i % CHART_COLORS.length]}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* ── Recent transactions table ─────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">
            עסקאות אחרונות
          </CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-right px-4">לקוח</TableHead>
                <TableHead className="text-right px-4">מועמד</TableHead>
                <TableHead className="text-right px-4">סוג שירות</TableHead>
                <TableHead className="text-right px-4">ליד</TableHead>
                <TableHead className="text-right px-4">סכום נטו</TableHead>
                <TableHead className="text-right px-4">חודש חיוב</TableHead>
                <TableHead className="text-right px-4">סטטוס</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recentTransactions.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="text-center py-8 text-muted-foreground"
                  >
                    אין עסקאות להצגה
                  </TableCell>
                </TableRow>
              ) : (
                recentTransactions.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="px-4 font-medium">
                      {t.client_name}
                    </TableCell>
                    <TableCell className="px-4 text-muted-foreground">
                      {t.candidate_name}
                    </TableCell>
                    <TableCell className="px-4 text-muted-foreground">
                      {t.service_type}
                    </TableCell>
                    <TableCell className="px-4 text-muted-foreground">
                      {t.service_lead}
                    </TableCell>
                    <TableCell className="px-4 font-medium">
                      {ILS.format(t.net_invoice_amount ?? 0)}
                    </TableCell>
                    <TableCell className="px-4 text-muted-foreground">
                      {HE_MONTHS[(t.billing_month ?? 1) - 1]}{' '}
                      {t.billing_year}
                    </TableCell>
                    <TableCell className="px-4">
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${statusBadgeClass(
                          t.payment_status,
                        )}`}
                      >
                        {t.payment_status}
                      </span>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
