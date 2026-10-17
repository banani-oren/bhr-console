// יומן שינויים (Repair 24) — admin-only view of audit_log via get_audit_log().
import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { History, Search, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { DateInput } from '@/components/ui/date-input'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  ENTITY_LABEL,
  fieldLabel,
  formatAuditTimestamp,
  formatAuditValue,
  jerusalemBoundary,
  snapshotLines,
} from '@/lib/auditLabels'
import { jerusalemYearMonth } from '@/lib/finance'

const PAGE = 50
type Entry = {
  occurred_at: string
  actor_name: string | null
  table_name: string
  row_id: string
  parent_id: string | null
  action: 'insert' | 'update' | 'delete'
  row_label: string | null
  changes: Record<string, unknown>
  total_count: number
}
const ENTITY_OPTIONS = [
  { value: 'all', label: 'הכל' },
  { value: 'transactions', label: 'עסקאות' },
  { value: 'billing_events', label: 'אירועי חיוב' },
  { value: 'clients', label: 'לקוחות' },
  { value: 'hours_log', label: 'שעות' },
]
const ACTION_BADGE = {
  insert: { label: 'נוצר', cls: 'text-green-700 border-green-400' },
  update: { label: 'עודכן', cls: 'text-purple-700 border-purple-400' },
  delete: { label: 'נמחק', cls: 'text-red-700 border-red-400' },
} as const

function defaultRange() {
  const { today } = jerusalemYearMonth()
  const [y, m, d] = today.split('-').map(Number)
  const from = new Date(Date.UTC(y, m - 1, d - 30)).toISOString().slice(0, 10)
  return { from, to: today }
}

function Changes({ e }: { e: Entry }) {
  const [open, setOpen] = useState(false)
  if (e.action === 'update') {
    return (
      <ul className="space-y-0.5 text-xs">
        {Object.entries(e.changes).map(([k, v]) => {
          const c = v as { old: unknown; new: unknown }
          return (
            <li key={k}>
              <span className="font-medium">{fieldLabel(k)}:</span>{' '}
              <span className="text-muted-foreground">{formatAuditValue(k, c.old)}</span>
              {' ← '}
              <span>{formatAuditValue(k, c.new)}</span>
            </li>
          )
        })}
      </ul>
    )
  }
  const lines = snapshotLines(e.changes)
  return (
    <div className="text-xs">
      <button type="button" className="text-purple-700 underline" onClick={() => setOpen((o) => !o)}>
        {open ? 'הסתר פרטים' : 'הצג פרטים'}
      </button>
      {open && (
        <ul className="mt-1 space-y-0.5">
          {lines.map((l) => (
            <li key={l.label}><span className="font-medium">{l.label}:</span> {l.value}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function AuditLog() {
  const init = useMemo(defaultRange, [])
  const [from, setFrom] = useState(init.from)
  const [to, setTo] = useState(init.to)
  const [actor, setActor] = useState('all')
  const [entity, setEntity] = useState('all')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)

  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchInput.trim()); setPage(0) }, 250)
    return () => clearTimeout(t)
  }, [searchInput])

  const profiles = useQuery<{ id: string; full_name: string }[]>({
    queryKey: ['audit-profiles'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('list_profiles_for_attendance')
      if (error) throw error
      return (data ?? []) as { id: string; full_name: string }[]
    },
  })

  const log = useQuery<Entry[]>({
    queryKey: ['audit-log', from, to, actor, entity, search, page],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_audit_log', {
        p_from: jerusalemBoundary(from || '2000-01-01', false),
        p_to: jerusalemBoundary(to || '2100-01-01', true),
        p_actor: actor === 'all' ? null : actor,
        p_table: entity === 'all' ? null : entity,
        p_search: search || null,
        p_limit: PAGE,
        p_offset: page * PAGE,
      })
      if (error) throw error
      return (data ?? []) as Entry[]
    },
  })

  const rows = log.data ?? []
  const total = rows[0]?.total_count ?? 0
  const reset = () => {
    const r = defaultRange()
    setFrom(r.from); setTo(r.to); setActor('all'); setEntity('all'); setSearchInput(''); setSearch(''); setPage(0)
  }
  const actorLabel = actor === 'all' ? 'כל המשתמשים' : (profiles.data ?? []).find((p) => p.id === actor)?.full_name ?? '—'

  return (
    <div dir="rtl" className="p-6 space-y-4">
      <div className="flex items-center gap-2">
        <History className="w-6 h-6 text-purple-600" />
        <h1 className="text-2xl font-bold text-purple-900">יומן שינויים</h1>
      </div>

      <Card className="p-4">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-52">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="חפש לפי רשומה..."
              className="border-purple-200 pr-9 pl-9"
              dir="rtl"
              data-testid="audit-search"
            />
            {searchInput && (
              <button type="button" aria-label="נקה" onClick={() => setSearchInput('')}
                className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 rounded-full bg-muted/60 flex items-center justify-center">
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
          <DateInput className="w-36 shrink-0" value={from} onChange={(e) => { setFrom(e.target.value); setPage(0) }} placeholder="מתאריך" data-testid="audit-from" />
          <DateInput className="w-36 shrink-0" value={to} onChange={(e) => { setTo(e.target.value); setPage(0) }} placeholder="עד תאריך" data-testid="audit-to" />
          <Select value={actor} onValueChange={(v) => { setActor(v ?? 'all'); setPage(0) }}>
            <SelectTrigger className="w-44 shrink-0"><span className="text-sm truncate">{actorLabel}</span></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">כל המשתמשים</SelectItem>
              {(profiles.data ?? []).map((p) => (<SelectItem key={p.id} value={p.id}>{p.full_name}</SelectItem>))}
            </SelectContent>
          </Select>
          <Select value={entity} onValueChange={(v) => { setEntity(v ?? 'all'); setPage(0) }}>
            <SelectTrigger className="w-36 shrink-0">
              <span className="text-sm">{ENTITY_OPTIONS.find((o) => o.value === entity)?.label}</span>
            </SelectTrigger>
            <SelectContent>
              {ENTITY_OPTIONS.map((o) => (<SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>))}
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" onClick={reset}>נקה</Button>
        </div>
      </Card>

      <Card>
        {log.isLoading ? (
          <div className="p-8 text-center text-muted-foreground">טוען...</div>
        ) : log.isError ? (
          <div className="p-8 text-center space-y-3">
            <p className="text-sm text-destructive">שגיאה בטעינת היומן.</p>
            <Button size="sm" variant="outline" onClick={() => log.refetch()}>נסה שוב</Button>
          </div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">לא נמצאו שינויים בטווח שנבחר</div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right whitespace-nowrap">תאריך ושעה</TableHead>
                  <TableHead className="text-right">משתמש</TableHead>
                  <TableHead className="text-right">ישות</TableHead>
                  <TableHead className="text-right">רשומה</TableHead>
                  <TableHead className="text-right">פעולה</TableHead>
                  <TableHead className="text-right">שינויים</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((e, i) => (
                  <TableRow key={`${e.row_id}-${e.occurred_at}-${i}`} className="align-top">
                    <TableCell className="text-right whitespace-nowrap text-xs">{formatAuditTimestamp(e.occurred_at)}</TableCell>
                    <TableCell className="text-right text-sm">{e.actor_name ?? 'מערכת'}</TableCell>
                    <TableCell className="text-right text-sm">{ENTITY_LABEL[e.table_name] ?? e.table_name}</TableCell>
                    <TableCell className="text-right text-sm">{e.row_label ?? '—'}</TableCell>
                    <TableCell className="text-right">
                      <Badge variant="outline" className={`${ACTION_BADGE[e.action].cls} text-xs`}>{ACTION_BADGE[e.action].label}</Badge>
                    </TableCell>
                    <TableCell className="text-right"><Changes e={e} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {rows.length > 0 && (
          <div className="flex items-center justify-between gap-3 px-4 py-3 border-t text-sm">
            <span data-testid="audit-range">{page * PAGE + 1}–{page * PAGE + rows.length} מתוך {total}</span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>הקודם</Button>
              <Button size="sm" variant="outline" disabled={(page + 1) * PAGE >= total} onClick={() => setPage((p) => p + 1)}>הבא</Button>
            </div>
          </div>
        )}
      </Card>

      <p className="text-xs text-muted-foreground">בעת 'התחבר בתור' השינויים נרשמים על שם המשתמש שבשמו התחברת.</p>
    </div>
  )
}
