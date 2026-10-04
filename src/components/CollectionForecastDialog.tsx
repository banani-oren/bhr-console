import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Printer, FileDown } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { exportSheetsToExcel } from '@/lib/excelExport'
import { collectionBucket } from '@/lib/billingEvents'
import { formatDate } from '@/lib/dates'
import type { BillingEventStatus } from '@/lib/types'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger,
} from '@/components/ui/select'

const HEBREW_MONTHS = [
  'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
]
const YEAR_OPTIONS = (() => {
  const y = new Date().getFullYear()
  return [y - 2, y - 1, y, y + 1]
})()

const ILS = new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS' })
const pad2 = (n: number) => String(n).padStart(2, '0')
const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

type ReportRow = {
  id: string
  amount: number
  description: string | null
  status: BillingEventStatus
  billing_date: string | null
  invoice_date: string | null
  due_date: string | null
  payment_date: string | null
  invoice_number: string | null
  client_name: string | null
}

type RawRow = {
  id: string
  amount: number | string | null
  description: string | null
  status: BillingEventStatus
  billing_date: string | null
  invoice_date: string | null
  due_date: string | null
  payment_date: string | null
  invoice_number: string | null
  transactions: { client_name: string | null; needs_approval: boolean; approved_at: string | null } | null
}

export type CollectionForecastDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** The BHR logo (public/favicon.svg) inlined so the printed report doesn't depend on an external asset load. */
const BHR_LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="38" viewBox="0 0 48 46"><path fill="#7c3aed" d="M25.946 44.938c-.664.845-2.021.375-2.021-.698V33.937a2.26 2.26 0 0 0-2.262-2.262H10.287c-.92 0-1.456-1.04-.92-1.788l7.48-10.471c1.07-1.497 0-3.578-1.842-3.578H1.237c-.92 0-1.456-1.04-.92-1.788L10.013.474c.214-.297.556-.474.92-.474h28.894c.92 0 1.456 1.04.92 1.788l-7.48 10.471c-1.07 1.498 0 3.579 1.842 3.579h11.377c.943 0 1.473 1.088.89 1.83L25.947 44.94z"/></svg>`

export default function CollectionForecastDialog({ open, onOpenChange }: CollectionForecastDialogProps) {
  const now = new Date()
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [year, setYear] = useState(now.getFullYear())

  const { data: rows = [], isLoading } = useQuery<ReportRow[]>({
    queryKey: ['collection-forecast-rows'],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('billing_events')
        .select(`
          id, amount, description, status, billing_date, invoice_date, due_date, payment_date, invoice_number,
          transactions!inner ( client_name, needs_approval, approved_at )
        `)
        .neq('status', 'cancelled')
      if (error) throw error
      const raw = (data ?? []) as unknown as RawRow[]
      return raw
        .filter((r) => !r.transactions?.needs_approval || r.transactions?.approved_at != null)
        .map((r) => ({
          id: r.id,
          amount: Number(r.amount) || 0,
          description: r.description,
          status: r.status,
          billing_date: r.billing_date,
          invoice_date: r.invoice_date,
          due_date: r.due_date,
          payment_date: r.payment_date,
          invoice_number: r.invoice_number,
          client_name: r.transactions?.client_name ?? null,
        }))
    },
  })

  const monthStart = `${year}-${pad2(month)}-01`
  const lastDay = new Date(year, month, 0).getDate()
  const monthEnd = `${year}-${pad2(month)}-${pad2(lastDay)}`
  const generatedOn = new Date().toISOString().slice(0, 10)
  // "Started" = the month's first day has arrived — section 6 (שולם בפועל)
  // is meaningless for a month that hasn't begun yet.
  const monthHasStarted = monthStart <= generatedOn

  const report = useMemo(() => {
    // Section 2 — צפוי להיגבות בחודש זה: billed, due_date inside the month.
    const section2Rows = rows.filter(
      (r) => collectionBucket(r.status) === 'awaiting_payment' && r.due_date && r.due_date >= monthStart && r.due_date <= monthEnd,
    )
    // Section 3 — חובות באיחור: billed, due_date before the month started.
    // Aging is measured from the SELECTED month's first day (not "today"),
    // so a report for a past month stays reproducible on re-generation.
    const section3Rows = rows.filter(
      (r) => collectionBucket(r.status) === 'awaiting_payment' && r.due_date && r.due_date < monthStart,
    )
    // Section 4 — טרם חויב, צפוי לחיוב: open, planned billing_date in or before the month.
    const section4Rows = rows.filter(
      (r) => collectionBucket(r.status) === 'not_billed' && r.billing_date && r.billing_date <= monthEnd,
    )
    // Section 5 — לא ניתן לשייך לחודש: billed, awaiting payment, but no due_date at all
    // (missing/unparseable payment terms — see Repair 18). These used to silently
    // vanish from the report (matched neither section 2 nor section 3). They are
    // deliberately excluded from the headline צפי figure.
    const section5Rows = rows.filter(
      (r) => collectionBucket(r.status) === 'awaiting_payment' && !r.due_date,
    )
    // Section 6 — שולם בפועל בחודש: paid, payment_date inside the month.
    const section6Rows = monthHasStarted
      ? rows.filter((r) => r.status === 'paid' && r.payment_date && r.payment_date >= monthStart && r.payment_date <= monthEnd)
      : []

    const groupByClient = (list: ReportRow[]) => {
      const map = new Map<string, { client: string; rows: ReportRow[]; subtotal: number }>()
      for (const r of list) {
        const client = r.client_name ?? 'לקוח לא ידוע'
        if (!map.has(client)) map.set(client, { client, rows: [], subtotal: 0 })
        const g = map.get(client)!
        g.rows.push(r)
        g.subtotal += r.amount
      }
      return [...map.values()].sort((a, b) => a.client.localeCompare(b.client, 'he'))
    }

    const daysOverdue = (dueDate: string) => {
      const d1 = new Date(`${monthStart}T00:00:00Z`).getTime()
      const d2 = new Date(`${dueDate}T00:00:00Z`).getTime()
      return Math.max(0, Math.round((d1 - d2) / 86400000))
    }
    const buckets = { b1_30: 0, b31_60: 0, b61_90: 0, b90plus: 0 }
    for (const r of section3Rows) {
      const days = daysOverdue(r.due_date!)
      if (days <= 30) buckets.b1_30 += r.amount
      else if (days <= 60) buckets.b31_60 += r.amount
      else if (days <= 90) buckets.b61_90 += r.amount
      else buckets.b90plus += r.amount
    }

    const section2Total = section2Rows.reduce((s, r) => s + r.amount, 0)
    const section3Total = section3Rows.reduce((s, r) => s + r.amount, 0)
    const section4Total = section4Rows.reduce((s, r) => s + r.amount, 0)
    const section5Total = section5Rows.reduce((s, r) => s + r.amount, 0)
    const section6Total = section6Rows.reduce((s, r) => s + r.amount, 0)

    return {
      section2: { rows: section2Rows, byClient: groupByClient(section2Rows), total: section2Total },
      section3: { rows: section3Rows, byClient: groupByClient(section3Rows), total: section3Total, buckets, daysOverdue },
      section4: { rows: section4Rows, total: section4Total },
      section5: { rows: section5Rows, byClient: groupByClient(section5Rows), total: section5Total },
      section6: { rows: section6Rows, total: section6Total },
      headline: section2Total + section3Total,
    }
  }, [rows, monthStart, monthEnd, monthHasStarted])

  const handlePrint = () => {
    const monthLabel = `${HEBREW_MONTHS[month - 1]} ${year}`
    const clientRows = (g: { client: string; rows: ReportRow[]; subtotal: number }) => `
      <tr class="client-row"><td colspan="5">${escapeHtml(g.client)}</td></tr>
      ${g.rows.map((r) => `
        <tr>
          <td>${escapeHtml(r.description ?? '—')}</td>
          <td dir="ltr">${escapeHtml(r.invoice_number ?? '—')}</td>
          <td>${escapeHtml(formatDate(r.invoice_date ?? r.billing_date))}</td>
          <td>${escapeHtml(formatDate(r.due_date))}</td>
          <td>${escapeHtml(ILS.format(r.amount))}</td>
        </tr>`).join('')}
      <tr class="subtotal-row"><td colspan="4">סה"כ ${escapeHtml(g.client)}</td><td>${escapeHtml(ILS.format(g.subtotal))}</td></tr>
    `

    const html = `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
  <meta charset="UTF-8">
  <title>דוח צפי גבייה – ${escapeHtml(monthLabel)}</title>
  <style>
    body { font-family: Arial, Helvetica, sans-serif; direction: rtl; margin: 32px; color: #111; }
    header { display: flex; align-items: center; gap: 10px; border-bottom: 3px solid #7c3aed; padding-bottom: 12px; margin-bottom: 8px; }
    header h1 { font-size: 22px; margin: 0; color: #4c1d95; }
    .meta { font-size: 13px; color: #555; margin-bottom: 24px; }
    h2 { font-size: 15px; color: #6d28d9; border-right: 4px solid #7c3aed; padding-right: 8px; margin: 28px 0 8px; }
    table { width: 100%; border-collapse: collapse; font-size: 12.5px; margin-bottom: 4px; }
    th { background: #7c3aed; color: #fff; padding: 6px 8px; text-align: right; }
    td { border-bottom: 1px solid #e5e7eb; padding: 5px 8px; text-align: right; }
    tr.client-row td { background: #f3e8ff; font-weight: bold; color: #4c1d95; }
    tr.subtotal-row td { background: #faf5ff; font-weight: 600; }
    .section-total { text-align: left; font-weight: bold; font-size: 14px; margin-bottom: 4px; }
    .buckets { display: flex; gap: 16px; margin: 8px 0; font-size: 13px; }
    .buckets div { background: #fef2f2; border: 1px solid #fecaca; border-radius: 6px; padding: 6px 10px; }
    .summary { margin-top: 28px; padding: 16px; background: #f3e8ff; border-radius: 8px; }
    .summary .headline { font-size: 24px; font-weight: bold; color: #4c1d95; }
    .summary .sub { font-size: 13px; color: #555; margin-top: 6px; }
    .empty { color: #888; font-size: 13px; padding: 8px 0; }
    @media print { body { margin: 16px; } }
  </style>
</head>
<body>
  <header>${BHR_LOGO_SVG}<h1>דוח צפי גבייה</h1></header>
  <div class="meta">
    <span>תקופה: <strong>${escapeHtml(monthLabel)}</strong></span>&nbsp;&nbsp;
    <span>תאריך הפקה: ${escapeHtml(formatDate(generatedOn))}</span>
  </div>

  <h2>צפוי להיגבות בחודש זה</h2>
  ${report.section2.rows.length === 0 ? '<p class="empty">אין חיובים צפויים לגבייה בחודש זה.</p>' : `
  <table>
    <thead><tr><th>תיאור</th><th>מספר חשבון עסקה</th><th>תאריך חיוב</th><th>תאריך פירעון</th><th>סכום</th></tr></thead>
    <tbody>${report.section2.byClient.map(clientRows).join('')}</tbody>
  </table>
  <p class="section-total">סה"כ: ${escapeHtml(ILS.format(report.section2.total))}</p>
  `}

  <h2>חובות באיחור (יתרה מועברת)</h2>
  ${report.section3.rows.length === 0 ? '<p class="empty">אין חובות באיחור.</p>' : `
  <div class="buckets">
    <div>1–30 יום: ${escapeHtml(ILS.format(report.section3.buckets.b1_30))}</div>
    <div>31–60 יום: ${escapeHtml(ILS.format(report.section3.buckets.b31_60))}</div>
    <div>61–90 יום: ${escapeHtml(ILS.format(report.section3.buckets.b61_90))}</div>
    <div>90+ יום: ${escapeHtml(ILS.format(report.section3.buckets.b90plus))}</div>
  </div>
  <table>
    <thead><tr><th>תיאור</th><th>מספר חשבון עסקה</th><th>תאריך חיוב</th><th>תאריך פירעון</th><th>סכום</th></tr></thead>
    <tbody>${report.section3.byClient.map(clientRows).join('')}</tbody>
  </table>
  <p class="section-total">סה"כ: ${escapeHtml(ILS.format(report.section3.total))}</p>
  `}

  <h2>לא ניתן לשייך לחודש — תנאי תשלום חסרים</h2>
  ${report.section5.rows.length === 0 ? '<p class="empty">כל החיובים הפעילים משויכים לחודש.</p>' : `
  <p class="empty">החיובים הבאים חויבו אך לא ניתן לחשב להם תאריך פירעון (תנאי תשלום חסרים או שגויים אצל הלקוח) — אינם נכללים בצפי לעיל.</p>
  <table>
    <thead><tr><th>תיאור</th><th>מספר חשבון עסקה</th><th>תאריך חיוב</th><th>תאריך פירעון</th><th>סכום</th></tr></thead>
    <tbody>${report.section5.byClient.map(clientRows).join('')}</tbody>
  </table>
  <p class="section-total">סה"כ: ${escapeHtml(ILS.format(report.section5.total))}</p>
  `}

  <h2>טרם חויב — צפוי לחיוב</h2>
  ${report.section4.rows.length === 0 ? '<p class="empty">אין עסקאות הממתינות לחיוב.</p>' : `
  <table>
    <thead><tr><th>לקוח</th><th>תיאור</th><th>תאריך חיוב מתוכנן</th><th>סכום</th></tr></thead>
    <tbody>${report.section4.rows.map((r) => `
      <tr>
        <td>${escapeHtml(r.client_name ?? '—')}</td>
        <td>${escapeHtml(r.description ?? '—')}</td>
        <td>${escapeHtml(formatDate(r.billing_date))}</td>
        <td>${escapeHtml(ILS.format(r.amount))}</td>
      </tr>`).join('')}</tbody>
  </table>
  <p class="section-total">סה"כ: ${escapeHtml(ILS.format(report.section4.total))}</p>
  `}

  <div class="summary">
    <div>צפי גבייה לחודש ${escapeHtml(monthLabel)}</div>
    <div class="headline">${escapeHtml(ILS.format(report.headline))}</div>
    <div class="sub">בנוסף, טרם חויב ועשוי להצטרף: ${escapeHtml(ILS.format(report.section4.total))}</div>
    ${report.section5.total > 0 ? `<div class="sub">⚠ ${escapeHtml(ILS.format(report.section5.total))} נוספים אינם משוייכים לחודש בשל תנאי תשלום חסרים</div>` : ''}
  </div>

  ${monthHasStarted ? `
  <h2>שולם בפועל בחודש</h2>
  ${report.section6.rows.length === 0 ? '<p class="empty">טרם התקבלו תשלומים בחודש זה.</p>' : `
  <table>
    <thead><tr><th>לקוח</th><th>תיאור</th><th>תאריך תשלום בפועל</th><th>סכום</th></tr></thead>
    <tbody>${report.section6.rows.map((r) => `
      <tr>
        <td>${escapeHtml(r.client_name ?? '—')}</td>
        <td>${escapeHtml(r.description ?? '—')}</td>
        <td>${escapeHtml(formatDate(r.payment_date))}</td>
        <td>${escapeHtml(ILS.format(r.amount))}</td>
      </tr>`).join('')}</tbody>
  </table>
  <p class="section-total">סה"כ: ${escapeHtml(ILS.format(report.section6.total))}</p>
  `}` : ''}

  <script>window.onload = function() { window.print(); }<\/script>
</body>
</html>`

    const win = window.open('', '_blank')
    if (!win) return
    win.document.write(html)
    win.document.close()
  }

  const handleExcel = () => {
    const monthLabel = `${HEBREW_MONTHS[month - 1]} ${year}`
    const rowsFor = (list: ReportRow[]) =>
      list.map((r) => ({
        'לקוח': r.client_name ?? '',
        'תיאור': r.description ?? '',
        'מספר חשבון עסקה': r.invoice_number ?? '',
        'תאריך חיוב': r.invoice_date ?? r.billing_date ?? '',
        'תאריך פירעון': r.due_date ?? '',
        'תאריך תשלום בפועל': r.payment_date ?? '',
        'סכום': r.amount,
      }))
    exportSheetsToExcel(
      [
        { name: 'צפוי להיגבות', rows: rowsFor(report.section2.rows) },
        { name: 'באיחור', rows: rowsFor(report.section3.rows) },
        { name: 'תנאי תשלום חסרים', rows: rowsFor(report.section5.rows) },
        { name: 'טרם חויב', rows: rowsFor(report.section4.rows) },
        { name: 'שולם בפועל', rows: rowsFor(report.section6.rows) },
      ],
      `דוח-צפי-גבייה-${monthLabel}.xlsx`,
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-md">
        <DialogHeader>
          <DialogTitle>דוח צפי גבייה</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-purple-700">חודש</Label>
              <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
                <SelectTrigger><span className="text-sm truncate">{HEBREW_MONTHS[month - 1]}</span></SelectTrigger>
                <SelectContent>
                  {HEBREW_MONTHS.map((m, i) => (<SelectItem key={i + 1} value={String(i + 1)}>{m}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-purple-700">שנה</Label>
              <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
                <SelectTrigger><span className="text-sm truncate">{year}</span></SelectTrigger>
                <SelectContent>
                  {YEAR_OPTIONS.map((y) => (<SelectItem key={y} value={String(y)}>{y}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {isLoading ? (
            <p className="text-xs text-muted-foreground">טוען נתונים...</p>
          ) : (
            <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs space-y-1">
              <div className="flex justify-between"><span className="text-muted-foreground">צפוי להיגבות:</span><strong>{ILS.format(report.section2.total)}</strong></div>
              <div className="flex justify-between"><span className="text-muted-foreground">באיחור:</span><strong className="text-red-700">{ILS.format(report.section3.total)}</strong></div>
              <div className="flex justify-between border-t pt-1"><span className="font-medium">צפי גבייה לחודש:</span><strong>{ILS.format(report.headline)}</strong></div>
              <div className="flex justify-between"><span className="text-muted-foreground">טרם חויב:</span><strong>{ILS.format(report.section4.total)}</strong></div>
              {report.section5.total > 0 && (
                <div className="flex justify-between text-amber-700">
                  <span>תנאי תשלום חסרים:</span>
                  <strong>{ILS.format(report.section5.total)}</strong>
                </div>
              )}
            </div>
          )}
        </div>
        <DialogFooter className="flex gap-2 flex-row-reverse">
          <Button onClick={handlePrint} disabled={isLoading} className="bg-purple-600 hover:bg-purple-700 text-white">
            <Printer className="w-4 h-4 ml-1" />
            הדפסה / PDF
          </Button>
          <Button variant="outline" onClick={handleExcel} disabled={isLoading} className="border-purple-300 text-purple-700">
            <FileDown className="w-4 h-4 ml-1" />
            ייצוא לאקסל
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>סגור</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
