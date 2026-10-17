// Deliberate deal deletion (Repair 26). The old flow was a browser confirm() +
// a bare DELETE whose FK violation (hours_log.billed_transaction_id) was
// swallowed silently. Now: the user sees what goes with the deal and — if hours
// are linked — must choose to release them or move them to another hours deal.
import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { toAgorot, txInvoiceAmount } from '@/lib/finance'
import type { BillingEvent, Transaction } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

const ILS = new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 })
const fmtDate = (iso: string | null | undefined) =>
  iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—'

type HoursAction = 'release' | 'move'

const dealLabel = (t: Transaction) =>
  t.kind === 'time_period'
    ? `${fmtDate(t.period_start)} → ${fmtDate(t.period_end)}`
    : [t.position_name, t.candidate_name].filter(Boolean).join(' · ') || t.service_type || '—'

/** Map a PostgREST/Postgres error to an inline Hebrew message. */
function describeError(err: unknown): string {
  const e = err as { name?: string; code?: string; message?: string; details?: string } | null
  if (e?.name === 'AbortError' || /timeout|abort/i.test(e?.message ?? '')) return 'הפעולה ארכה יותר מדי. נסה שוב.'
  if (e?.code === '23503') return `לא ניתן למחוק: קיימות רשומות מקושרות לעסקה${e.details ? ` (${e.details})` : ''}`
  if (e?.code === '42501') return 'אין לך הרשאה למחוק עסקה זו.'
  return e?.message || 'המחיקה נכשלה.'
}

export default function DeleteTransactionDialog({
  deal,
  allDeals,
  events,
  onClose,
}: {
  deal: Transaction | null
  allDeals: Transaction[]
  events: BillingEvent[]
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [action, setAction] = useState<HoursAction | null>(null)
  const [target, setTarget] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [forceHours, setForceHours] = useState(false)

  useEffect(() => {
    setAction(null); setTarget(''); setError(null); setForceHours(false)
  }, [deal?.id])

  // Linked hours (best effort under RLS — the function re-checks the real count).
  const hours = useQuery({
    queryKey: ['delete-deal-hours', deal?.id],
    enabled: !!deal,
    queryFn: async () => {
      const { count, error: err } = await supabase
        .from('hours_log')
        .select('id', { count: 'exact', head: true })
        .eq('billed_transaction_id', deal!.id)
      if (err) throw err
      return count ?? 0
    },
  })
  const hoursCount = hours.data ?? 0
  const hasHours = hoursCount > 0 || forceHours

  const live = useMemo(() => events.filter((e) => e.status !== 'cancelled'), [events])
  const issued = live.filter((e) => e.status === 'billed' || e.status === 'paid')
  const issuedAgorot = issued.reduce((s, e) => s + toAgorot(e.amount), 0)
  const byStatus = useMemo(() => {
    const m = new Map<string, { n: number; agorot: number }>()
    for (const e of events) {
      const cur = m.get(e.status) ?? { n: 0, agorot: 0 }
      cur.n += 1; cur.agorot += toAgorot(e.amount)
      m.set(e.status, cur)
    }
    return m
  }, [events])
  const STATUS_HE: Record<string, string> = {
    pending: 'טרם חויב', to_bill: 'לחיוב עכשיו', billed: 'ממתין לתשלום', paid: 'שולם', cancelled: 'מבוטל',
  }

  const targets = useMemo(
    () =>
      deal
        ? allDeals
            .filter((t) => t.id !== deal.id && t.client_id === deal.client_id && t.kind === 'time_period')
            .sort((a, b) => (b.period_end ?? b.close_date ?? '').localeCompare(a.period_end ?? a.close_date ?? ''))
        : [],
    [allDeals, deal],
  )

  const del = useMutation({
    mutationFn: async () => {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(new DOMException('timeout', 'AbortError')), 10000)
      try {
        const { error: err } = await supabase
          .rpc('delete_transaction', {
            p_id: deal!.id,
            p_hours_action: hasHours ? action : null,
            p_target_transaction: hasHours && action === 'move' ? target : null,
          })
          .abortSignal(controller.signal)
        if (err) throw err
      } finally {
        clearTimeout(timer)
      }
    },
    onSuccess: () => {
      for (const k of ['transactions', 'billing_events', 'hours_log', 'audit-log']) {
        queryClient.invalidateQueries({ queryKey: [k] })
      }
      queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('hours') })
      onClose()
    },
    onError: (err) => {
      const msg = describeError(err)
      // The deal has hours we could not see under RLS → ask the user to choose.
      if (/שעות מקושרות/.test(msg)) setForceHours(true)
      setError(msg)
    },
  })

  const needsChoice = hasHours
  const choiceMade = !needsChoice || (action === 'release') || (action === 'move' && !!target)
  const canConfirm = !hours.isLoading && choiceMade && !del.isPending

  return (
    <Dialog open={!!deal} onOpenChange={(o) => { if (!o && !del.isPending) onClose() }}>
      <DialogContent dir="rtl" className="max-w-lg">
        <DialogHeader>
          <DialogTitle>מחיקת עסקה</DialogTitle>
          <DialogDescription className="text-right">
            {deal && (
              <>
                {deal.client_name} · {dealLabel(deal)} · סכום חשבונית {ILS.format(txInvoiceAmount(deal))}
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          {events.length > 0 && (
            <div className="text-xs text-muted-foreground">
              חיובים שיימחקו עם העסקה:{' '}
              {Array.from(byStatus.entries())
                .map(([s, v]) => `${STATUS_HE[s] ?? s}: ${v.n} (${ILS.format(v.agorot / 100)})`)
                .join(' · ')}
            </div>
          )}

          {issued.length > 0 && (
            <div className="rounded-md border border-amber-400 bg-amber-50 p-3 text-amber-800" data-testid="delete-warning">
              לעסקה זו {issued.length} חיובים שכבר הופק להם חשבון עסקה / שולמו ({ILS.format(issuedAgorot / 100)}).
              מחיקת העסקה תמחק גם אותם.
            </div>
          )}

          {hours.isLoading && <div className="text-muted-foreground">בודק שעות מקושרות...</div>}

          {needsChoice && (
            <div className="space-y-2 rounded-md border p-3" data-testid="delete-hours-choice">
              <div className="font-medium">
                {hoursCount > 0 ? `לעסקה ${hoursCount} רשומות שעות מקושרות.` : 'לעסקה שעות מקושרות.'} מה לעשות איתן?
              </div>
              <RadioGroup value={action ?? ''} onValueChange={(v) => setAction(v as HoursAction)}>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="release" id="del-release" />
                  <Label htmlFor="del-release" className="cursor-pointer">לשחרר את השעות</Label>
                </div>
                <p className="text-xs text-muted-foreground pr-6">השעות יחזרו למצב "לא חויבו" וניתן יהיה לחייב אותן שוב.</p>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="move" id="del-move" />
                  <Label htmlFor="del-move" className="cursor-pointer">להעביר את השעות לעסקה אחרת</Label>
                </div>
              </RadioGroup>
              {action === 'move' && (
                targets.length === 0 ? (
                  <p className="text-xs text-red-600">אין ללקוח זה עסקת שעות אחרת להעברה.</p>
                ) : (
                  <Select value={target} onValueChange={(v) => setTarget(v ?? '')}>
                    <SelectTrigger className="w-full">
                      <span className="text-sm truncate">
                        {target
                          ? (() => { const t = targets.find((x) => x.id === target); return t ? `${dealLabel(t)} · ${ILS.format(txInvoiceAmount(t))}` : 'בחר עסקה' })()
                          : 'בחר עסקת יעד'}
                      </span>
                    </SelectTrigger>
                    <SelectContent>
                      {targets.map((t) => (
                        <SelectItem key={t.id} value={t.id}>{dealLabel(t)} · {ILS.format(txInvoiceAmount(t))}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )
              )}
            </div>
          )}

          {error && <div className="rounded-md bg-red-50 p-2 text-red-700" role="alert" data-testid="delete-error">{error}</div>}
        </div>

        <DialogFooter className="gap-2 sm:justify-start">
          <Button variant="destructive" disabled={!canConfirm} onClick={() => { setError(null); del.mutate() }}>
            {del.isPending ? 'מוחק...' : 'מחק'}
          </Button>
          <Button variant="outline" disabled={del.isPending} onClick={onClose}>ביטול</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
