import { useMemo } from 'react'
import type { BonusOverview, UpcomingMonth } from '@/lib/bonusOverview'
import { Button } from '@/components/ui/button'

// Repair 33 — the recruiter's forward-looking bonus panel (design: docs/design/recruiter-bonus-sketch/).
// Purpose is motivation through consequences: the current calendar month is treated as closed (nothing here
// asks her to act on it); what she closes NOW enters the bonus of the month in which the client pays in
// full. Four cards: the current month + the next three. Every number is a bonus amount or a deal count tied
// to a month — no revenue, no per-deal amounts, no dates (D3). Wording rule (D4): no conditional phrasing next to a bonus number — requirements are stated as facts.
// Colours come only from the --bonus-* tokens in index.css (D5) so dark mode follows. Gender: the strings are
// feminine as in the sketch (open item: other recruiters may need neutral forms from the profile).

const ILS = new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 })
const NUM = new Intl.NumberFormat('he-IL')
const HE_MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר']
const monthNameHe = (key: string) => HE_MONTHS[Number(key.slice(5)) - 1]

const countLine = (n: number) => (n === 0 ? 'עוד לא נפתחו עסקאות' : n === 1 ? 'עסקה אחת בדרך' : `${NUM.format(n)} עסקאות בדרך`)
const dealsNeeded = (n: number) => (n === 1 ? 'עוד כ-1 עסקה' : `עוד כ-${NUM.format(n)} עסקאות`)

const Stripe = ({ size = 14 }: { size?: number }) => (
  <span className="inline-block rounded-[4px] bonus-stripes" style={{ width: size, height: size }} aria-hidden />
)

function MonthCard({ m, isCurrent, hasModel }: { m: UpcomingMonth; isCurrent: boolean; hasModel: boolean }) {
  const name = monthNameHe(m.month)
  const nDeals = m.expected_deals.length
  const empty = nDeals === 0
  const pct = (f: number) => (f > 0 ? Math.max(2, Math.round(f * 100)) : 0)

  let requirement: React.ReactNode
  if (!hasModel) requirement = 'המנהל עדיין לא הגדיר מודל בונוס.'
  else if (empty) requirement = <><b>פתיחת עסקה אחת עכשיו</b> נותנת ל{name} את הצעד הראשון</>
  else if (m.top_tier_reached) requirement = 'הגעת לדרגה הגבוהה'
  else if (m.next_tier_bonus != null && m.deals_to_next_tier_estimate != null)
    requirement = <>לדרגה הבאה ({ILS.format(m.next_tier_bonus)}): <b>{dealsNeeded(m.deals_to_next_tier_estimate)}</b> לפי הממוצע שלך</>
  else requirement = 'לדרגה הבאה: נדרשות עוד עסקאות'

  return (
    <div
      data-testid="month-card"
      data-month={m.month}
      data-current={isCurrent ? '1' : undefined}
      className={`flex flex-col gap-3 rounded-[18px] p-[18px] ${empty && !isCurrent ? 'bg-card border-2 border-dashed' : 'border'}`}
      style={{
        background: empty && !isCurrent ? undefined : 'var(--bonus-surface)',
        color: 'var(--bonus-text)',
        borderColor: isCurrent ? 'var(--bonus-counted)' : empty ? 'var(--bonus-estimate)' : 'var(--bonus-track)',
        borderWidth: isCurrent ? 2 : undefined,
      }}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
        <div className="flex items-baseline gap-2">
          <span className="text-lg font-extrabold" style={{ color: 'var(--bonus-title-ink)' }}>{name}</span>
          {isCurrent && (
            <span className="rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ background: 'var(--bonus-counted)', color: 'var(--bonus-counted-ink)' }} data-testid="current-label">החודש</span>
          )}
        </div>
        <span className="text-xs" style={{ color: 'var(--bonus-muted)' }}>{countLine(nDeals)}</span>
      </div>

      {isCurrent && (
        <p className="-mt-1 text-xs font-semibold" style={{ color: 'var(--bonus-counted)' }} data-testid="counted-line">
          נספר לבונוס עד כה: {ILS.format(m.counted_bonus)}
        </p>
      )}

      <p className="text-[34px] font-extrabold leading-none" style={{ color: empty ? 'var(--bonus-counted)' : 'var(--bonus-expected)' }} data-testid="month-big">
        {ILS.format(m.expected_bonus)}
      </p>

      {empty ? (
        m.avg_deal_bonus != null && <p className="text-xs" style={{ color: 'var(--bonus-muted)' }}>הערכה לפי הממוצע שלך: כ-{ILS.format(m.avg_deal_bonus)} לכל עסקה</p>
      ) : (
        <p className="text-xs" style={{ color: 'var(--bonus-title-ink)' }}>צפוי · ממתין לתשלום מלא</p>
      )}

      <div className="flex h-[14px] overflow-hidden rounded-full" style={{ background: 'var(--bonus-track)' }} data-testid="month-bar" aria-hidden>
        {m.bar.counted > 0 && <div style={{ width: `${pct(m.bar.counted)}%`, background: 'var(--bonus-counted)' }} data-seg="counted" />}
        {m.bar.expected > 0 && <div className="bonus-stripes" style={{ width: `${pct(m.bar.expected)}%` }} data-seg="expected" />}
        {m.bar.estimate > 0 && (
          <div
            className="box-border rounded-e-full border-2 border-dashed"
            style={{ width: `${pct(m.bar.estimate)}%`, borderColor: 'var(--bonus-estimate)' }}
            data-seg="estimate"
          />
        )}
      </div>

      <p className="text-[13px] leading-normal" data-testid="month-requirement">{requirement}</p>
    </div>
  )
}

export default function UpcomingBonusPanel({ ov, onOpenDeal }: { ov: BonusOverview; onOpenDeal: () => void }) {
  const months = ov.upcoming
  const last = months[months.length - 1]

  // Every deal forecast to complete in one of the four months — once — in month order.
  const rows = useMemo(() => {
    const seen = new Set<string>()
    const out: { id: string; title: string; month: string }[] = []
    for (const m of months) {
      for (const d of m.expected_deals) {
        if (seen.has(d.deal_id)) continue
        seen.add(d.deal_id)
        const what = d.position_name || d.candidate_name
        out.push({ id: d.deal_id, title: [d.client_name, what].filter(Boolean).join(' · '), month: m.month })
      }
    }
    return out
  }, [months])

  return (
    <section className="space-y-5 rounded-xl border bg-card p-6 md:p-8" dir="rtl" data-testid="upcoming-panel" style={{ color: 'var(--bonus-text)' }}>
      <div>
        <h2 className="text-[28px] font-extrabold leading-tight" style={{ color: 'var(--bonus-title-ink)' }}>הבונוסים הבאים שלך</h2>
        <p className="mt-1.5 text-[15px]" style={{ color: 'var(--bonus-muted)' }}>כל עסקה שתיסגר עכשיו נכנסת לחודש שבו הכסף ייכנס, ומקדמת אותך לדרגה הבאה</p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4" data-testid="month-cards">
        {months.map((m, i) => <MonthCard key={m.month} m={m} isCurrent={i === 0} hasModel={ov.has_model} />)}
      </div>

      <div className="space-y-2.5" data-testid="upcoming-deals">
        <h3 className="text-base font-extrabold" style={{ color: 'var(--bonus-title-ink)' }}>העסקאות שכבר בדרך לבונוס</h3>
        {rows.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--bonus-muted)' }} data-testid="upcoming-deals-empty">עוד אין עסקאות בדרך לבונוס</p>
        ) : (
          rows.map((r) => (
            <div
              key={r.id}
              data-testid="deal-row"
              className="flex items-center justify-between gap-3 rounded-[14px] border-2 px-4 py-3.5"
              style={{ background: 'var(--bonus-row)', borderColor: 'var(--bonus-expected)' }}
            >
              <div className="min-w-0">
                <p className="truncate text-[15px] font-extrabold" style={{ color: 'var(--bonus-title-ink)' }}>{r.title}</p>
                <p className="text-xs" style={{ color: 'var(--bonus-expected-ink)' }}>ממתינה לתשלום מלא</p>
              </div>
              <span className="shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-[13px] font-extrabold" style={{ background: 'var(--bonus-expected-chip)', color: 'var(--bonus-expected-ink)' }} data-testid="deal-chip">
                נכנסת ל{monthNameHe(r.month)}
              </span>
            </div>
          ))
        )}
      </div>

      {/* Repair 34: own block, outside the deal list, divided from it */}
      <div className="mt-6 border-t pt-6" style={{ borderColor: 'var(--bonus-track)' }} data-testid="upcoming-cta-wrap">
        <div
          className="flex flex-col items-start justify-between gap-3 rounded-2xl px-5 py-4 sm:flex-row sm:items-center"
          style={{ background: 'linear-gradient(90deg, var(--bonus-counted), color-mix(in srgb, var(--bonus-counted) 90%, white))', color: 'var(--bonus-counted-ink)' }}
          data-testid="upcoming-cta"
        >
          <div>
            <p className="text-base font-extrabold">פתיחת עסקה חדשה היום נכנסת ל{monthNameHe(last.month)}</p>
            <p className="text-[13px] opacity-90">כל עסקה ממוצעת שלך מקרבת אותך לדרגה הבאה</p>
          </div>
          <Button className="rounded-xl px-[18px] font-extrabold hover:opacity-90" style={{ background: 'var(--bonus-expected)', color: '#ffffff' }} onClick={onOpenDeal} data-testid="cta-open-deal">
            פתיחת עסקה
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-[18px] gap-y-2 text-xs" style={{ color: 'var(--bonus-muted)' }} data-testid="upcoming-legend">
        <span className="inline-flex items-center gap-1.5"><Stripe />צפוי · ממתין לתשלום מלא</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block box-border h-[14px] w-[14px] rounded-[4px] border-2 border-dashed" style={{ borderColor: 'var(--bonus-estimate)' }} aria-hidden />הערכה לפי הממוצע שלך</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-[14px] w-[14px] rounded-[4px]" style={{ background: 'var(--bonus-counted)' }} aria-hidden />נספר לבונוס</span>
      </div>
    </section>
  )
}
