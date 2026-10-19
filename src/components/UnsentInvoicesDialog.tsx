// Repair 36 (2026-10-19): on every full load of the desktop app, admin and
// administration are told which חשבונות עסקה should already have gone to the
// client and have not. Shown once per load (module flag, NOT localStorage, so a
// reload or a new tab shows it again); never on /m and never for a recruiter.
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { buildBillingEventPatch, isUnsentInvoiceDue } from '@/lib/billingEvents'
import { fromAgorot, jerusalemYearMonth, toAgorot } from '@/lib/finance'
import type { BillingEvent } from '@/lib/types'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

type UnsentRow = Pick<
  BillingEvent,
  'id' | 'description' | 'amount' | 'status' | 'billing_date' | 'invoice_number' | 'invoice_date' | 'receipt_number' | 'payment_date' | 'invoice_sent' | 'invoice_send_date'
> & { transactions: { client_name: string; needs_approval: boolean; approved_at: string | null } }

const NUM_0 = new Intl.NumberFormat('he-IL', { maximumFractionDigits: 0 })
const fmtDate = (iso: string | null) =>
  iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—'

let shownThisLoad = false

export default function UnsentInvoicesDialog() {
  const { profile, loading } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<UnsentRow[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const today = jerusalemYearMonth().today

  // One query, the shared predicate (isUnsentInvoiceDue), oldest send date first.
  const load = async (): Promise<UnsentRow[]> => {
    const { data, error: err } = await supabase
      .from('billing_events')
      .select(
        'id, description, amount, status, billing_date, invoice_number, invoice_date, receipt_number, payment_date, invoice_sent, invoice_send_date, transactions!inner(client_name, needs_approval, approved_at)',
      )
      .not('invoice_number', 'is', null)
      .eq('invoice_sent', false)
      .in('status', ['pending', 'to_bill', 'billed'])
      .lte('invoice_send_date', today)
    if (err) throw err
    return ((data ?? []) as unknown as UnsentRow[])
      .filter((r) => isUnsentInvoiceDue(r, today))
      .sort((a, b) => (a.invoice_send_date ?? '').localeCompare(b.invoice_send_date ?? ''))
  }

  useEffect(() => {
    if (loading || !profile) return
    if (profile.role !== 'admin' && profile.role !== 'administration') return
    if (window.location.pathname.startsWith('/m')) return
    if (shownThisLoad) return
    shownThisLoad = true
    load()
      .then((r) => {
        if (r.length === 0) return
        setRows(r)
        setOpen(true)
      })
      .catch((err) => {
        // Never block the app on this: log and show nothing.
        console.error('UnsentInvoicesDialog load error:', err)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, profile?.role])

  const total = fromAgorot(rows.reduce((s, r) => s + toAgorot(r.amount), 0))
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id))

  const toggle = (id: string) =>
    setSelected((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id); else n.add(id)
      return n
    })

  const markSent = async () => {
    const targets = rows.filter((r) => selected.has(r.id))
    if (targets.length === 0) return
    setSaving(true)
    setError(null)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new DOMException('timeout', 'AbortError')), 10000)
    try {
      // One batch; every row goes through the single patch builder (one audit entry per row).
      const results = await Promise.all(
        targets.map(async (r) => {
          const approved = !r.transactions.needs_approval || !!r.transactions.approved_at
          const patch = buildBillingEventPatch(r, 'invoice_sent', true, approved)
          const { error: err } = await supabase.from('billing_events').update(patch).eq('id', r.id).abortSignal(controller.signal)
          return err
        }),
      )
      const failed = results.filter(Boolean).length
      if (failed > 0) setError(`עדכון ${failed} מתוך ${targets.length} חשבונות נכשל — נסה שנית.`)
      const fresh = await load()
      setRows(fresh)
      setSelected(new Set())
      void queryClient.invalidateQueries({ queryKey: ['billing_events_dashboard'] })
      if (fresh.length === 0) setOpen(false)
    } catch (err) {
      console.error('UnsentInvoicesDialog mark error:', err)
      const isTimeout = err instanceof DOMException && err.name === 'AbortError'
      setError(isTimeout ? 'פג זמן — נסה שנית.' : 'שגיאה בשמירה — נסה שנית.')
    } finally {
      clearTimeout(timer)
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent dir="rtl" className="sm:max-w-3xl" data-testid="unsent-invoices-dialog">
        <DialogHeader>
          <DialogTitle>חשבונות עסקה שטרם נשלחו ללקוחות</DialogTitle>
          <DialogDescription data-testid="unsent-subtitle">
            {rows.length} חשבונות · ₪{NUM_0.format(total)}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[50vh] overflow-y-auto rounded-md border">
          <Table className="text-sm">
            <TableHeader>
              <TableRow className="bg-purple-50">
                <TableHead className="w-8 text-center">
                  <Checkbox
                    checked={allSelected}
                    onCheckedChange={(v) => setSelected(v ? new Set(rows.map((r) => r.id)) : new Set())}
                    aria-label="בחר הכל"
                    data-testid="unsent-select-all"
                  />
                </TableHead>
                <TableHead className="text-right">לקוח</TableHead>
                <TableHead className="text-right">תיאור</TableHead>
                <TableHead className="text-right">מספר חשבון עסקה</TableHead>
                <TableHead className="text-right">סכום</TableHead>
                <TableHead className="text-right">תאריך שליחה</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id} data-testid="unsent-row">
                  <TableCell className="text-center">
                    <Checkbox
                      checked={selected.has(r.id)}
                      onCheckedChange={() => toggle(r.id)}
                      aria-label="בחר חשבון"
                      data-testid="unsent-row-check"
                    />
                  </TableCell>
                  <TableCell className="font-medium whitespace-normal">{r.transactions.client_name}</TableCell>
                  <TableCell className="text-xs whitespace-normal">{r.description ?? '—'}</TableCell>
                  <TableCell>{r.invoice_number}</TableCell>
                  <TableCell className="whitespace-nowrap">₪{NUM_0.format(Number(r.amount))}</TableCell>
                  <TableCell className={cn('whitespace-nowrap', (r.invoice_send_date ?? '') < today && 'text-red-600 font-medium')} data-testid="unsent-date">
                    {fmtDate(r.invoice_send_date)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {error && <p className="text-sm text-destructive" role="alert" data-testid="unsent-error">{error}</p>}

        <DialogFooter className="sm:justify-start">
          <Button
            onClick={() => void markSent()}
            disabled={selected.size === 0 || saving}
            className="bg-purple-600 hover:bg-purple-700 text-white"
            data-testid="unsent-mark-sent"
          >
            {saving ? 'שומר...' : 'סמן כנשלחו'}
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setOpen(false)
              navigate('/billing-reports?unsent=1')
            }}
            data-testid="unsent-open-reports"
          >
            פתח בדוחות חיוב
          </Button>
          <Button variant="ghost" onClick={() => setOpen(false)} data-testid="unsent-close">
            סגור
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
