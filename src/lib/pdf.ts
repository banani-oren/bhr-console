import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { supabase } from './supabase'
import type { BillingReport, Client, HoursLog, Transaction } from './types'
import type { ServiceType } from './serviceTypes'

// jsPDF defaults to helvetica (no Hebrew glyphs). Characters outside the
// ISO-Latin range render as squares. Reversing the string pre-draw lets
// basic Hebrew text align right-to-left on the page — not perfect, but
// acceptable for an internal PDF until a full Hebrew font is embedded.
export const label = (s: string): string => s.split('').reverse().join('')

export function formatCurrency(n: number | null | undefined): string {
  if (n == null) return '—'
  return new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS' }).format(n)
}

type TimeSheetArgs = {
  transaction: Transaction
  client: Client | null
  entries: HoursLog[]
  profileNameById: Map<string, string>
}

export function buildTimeSheetPdf({ transaction, client, entries, profileNameById }: TimeSheetArgs): jsPDF {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' })
  doc.setFontSize(18)
  doc.text('BHR Console', 40, 50)
  doc.setFontSize(12)
  doc.text(label('דף שעות'), 555, 50, { align: 'right' })
  doc.setFontSize(10)
  const periodStart = transaction.period_start ?? '—'
  const periodEnd = transaction.period_end ?? '—'
  doc.text(`${label('לקוח')}: ${client?.name ?? transaction.client_name ?? ''}`, 555, 72, { align: 'right' })
  doc.text(`${label('תקופה')}: ${periodStart} — ${periodEnd}`, 555, 88, { align: 'right' })
  doc.text(`${label('תאריך הפקה')}: ${new Date().toISOString().slice(0, 10)}`, 555, 104, { align: 'right' })

  autoTable(doc, {
    startY: 130,
    head: [[
      label('תאריך'),
      label('משעה'),
      label('עד שעה'),
      label('שעות'),
      label('עובד/ת'),
      label('תיאור'),
    ]],
    body: entries.map((e) => [
      e.visit_date,
      e.start_time ?? '—',
      e.end_time ?? '—',
      String(e.hours ?? 0),
      e.profile_id ? profileNameById.get(e.profile_id) ?? '—' : '—',
      e.description ?? '—',
    ]),
    styles: { font: 'helvetica', fontSize: 9, halign: 'right' },
    headStyles: { fillColor: [147, 51, 234], textColor: 255 },
  })

  const h = doc.internal.pageSize.getHeight()
  doc.setFontSize(11)
  doc.text(`${label('סה"כ שעות')}: ${(transaction.hours_total ?? 0).toFixed(2)}`, 555, h - 96, { align: 'right' })
  doc.text(`${label('תעריף שעה')}: ${formatCurrency(transaction.hourly_rate_used)}`, 555, h - 80, { align: 'right' })
  doc.setFontSize(13)
  doc.text(`${label('סך לתשלום')}: ${formatCurrency(transaction.net_invoice_amount)}`, 555, h - 60, { align: 'right' })

  doc.setFontSize(8)
  doc.setTextColor(120)
  doc.text('Banani HR  ·  no-reply@banani-hr.com', 40, h - 40)

  return doc
}

export async function uploadTimeSheetPdf(transactionId: string, doc: jsPDF): Promise<string> {
  const blob = doc.output('blob')
  const path = `${transactionId}.pdf`
  const { error } = await supabase.storage
    .from('time-sheets')
    .upload(path, blob, { contentType: 'application/pdf', upsert: true })
  if (error) throw error
  return path
}

type BillingReportArgs = {
  report: BillingReport
  client: Client | null
  transactions: Transaction[]
  serviceTypeNames: Map<string, string>
  hoursByTransaction: Map<string, HoursLog[]>
  profileNameById: Map<string, string>
}

export function buildBillingReportPdf({
  report,
  client,
  transactions,
  serviceTypeNames,
  hoursByTransaction,
  profileNameById,
}: BillingReportArgs): jsPDF {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' })
  doc.setFontSize(18)
  doc.text('BHR Console', 40, 50)
  doc.setFontSize(13)
  doc.text(label('דוח חיוב'), 555, 50, { align: 'right' })
  doc.setFontSize(10)
  doc.text(`${label('לקוח')}: ${client?.name ?? ''}`, 555, 72, { align: 'right' })
  doc.text(`${label('תקופה')}: ${report.period_start} — ${report.period_end}`, 555, 88, { align: 'right' })
  doc.text(`${label('תאריך הפקה')}: ${new Date(report.issued_at).toISOString().slice(0, 10)}`, 555, 104, { align: 'right' })

  autoTable(doc, {
    startY: 130,
    head: [[
      label('סוג'),
      label('תיאור'),
      label('תאריך'),
      label('סכום'),
    ]],
    body: transactions.map((t) => {
      const kindLabel = t.kind === 'time_period' ? label('שעות') : label('שירות')
      const desc =
        t.kind === 'time_period'
          ? `${label('דוח שעות')} ${t.period_start ?? ''} → ${t.period_end ?? ''}`
          : `${serviceTypeNames.get(t.service_type_id ?? '') ?? t.service_type ?? ''}${
              t.position_name ? ` · ${t.position_name}` : ''
            }${t.candidate_name ? ` · ${t.candidate_name}` : ''}`
      const date = t.close_date ?? t.period_end ?? t.entry_date ?? ''
      return [kindLabel, desc, date, formatCurrency(t.net_invoice_amount)]
    }),
    styles: { font: 'helvetica', fontSize: 9, halign: 'right' },
    headStyles: { fillColor: [147, 51, 234], textColor: 255 },
  })

  // Expanded hours tables per time_period transaction.
  for (const t of transactions) {
    if (t.kind !== 'time_period') continue
    const hrs = hoursByTransaction.get(t.id) ?? []
    if (hrs.length === 0) continue
    doc.addPage()
    doc.setFontSize(13)
    doc.text(`${label('פירוט שעות')} · ${t.client_name}`, 555, 50, { align: 'right' })
    doc.setFontSize(10)
    doc.text(`${label('תקופה')}: ${t.period_start} → ${t.period_end}`, 555, 68, { align: 'right' })
    autoTable(doc, {
      startY: 90,
      head: [[
        label('תאריך'),
        label('משעה'),
        label('עד'),
        label('שעות'),
        label('עובד/ת'),
        label('תיאור'),
      ]],
      body: hrs.map((h) => [
        h.visit_date,
        h.start_time ?? '—',
        h.end_time ?? '—',
        String(h.hours ?? 0),
        h.profile_id ? profileNameById.get(h.profile_id) ?? '—' : '—',
        h.description ?? '—',
      ]),
      styles: { font: 'helvetica', fontSize: 9, halign: 'right' },
      headStyles: { fillColor: [147, 51, 234], textColor: 255 },
    })
  }

  const h = doc.internal.pageSize.getHeight()
  doc.setFontSize(13)
  doc.text(`${label('סך הכל')}: ${formatCurrency(report.total_amount)}`, 555, h - 60, { align: 'right' })
  doc.setFontSize(8)
  doc.setTextColor(120)
  doc.text('Banani HR  ·  no-reply@banani-hr.com', 40, h - 40)
  return doc
}

export async function uploadBillingReportPdf(reportId: string, doc: jsPDF): Promise<string> {
  const blob = doc.output('blob')
  const path = `${reportId}.pdf`
  const { error } = await supabase.storage
    .from('billing-reports')
    .upload(path, blob, { contentType: 'application/pdf', upsert: true })
  if (error) throw error
  return path
}

export async function signedUrl(bucket: string, path: string, seconds = 60): Promise<string | null> {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, seconds)
  if (error) return null
  return data?.signedUrl ?? null
}

// Unused import guard for type narrowing in ES builds:
export type _ServiceTypeAlias = ServiceType
