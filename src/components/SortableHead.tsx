import { TableHead } from '@/components/ui/table'

// Shared sortable-table-header helper used across the table pages
// (Transactions, Clients, Hours, BillingReports — Repair 8).

export type SortState = { key: string; dir: 'asc' | 'desc' }

/** Cycle a sort key: same key flips direction, new key starts ascending. */
export function toggleSortKey(prev: SortState, key: string): SortState {
  return prev.key === key
    ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
    : { key, dir: 'asc' }
}

/**
 * Compare two rows by the active sort. Empty values (null/undefined/'')
 * always sort last regardless of direction. Numbers compare numerically;
 * everything else uses a Hebrew, numeric-aware locale compare so that
 * Hebrew client names and ISO date strings order correctly.
 */
export function compareBySort<T>(
  a: T,
  b: T,
  sort: SortState,
  getValue: (row: T, key: string) => unknown,
): number {
  const av = getValue(a, sort.key)
  const bv = getValue(b, sort.key)
  const mul = sort.dir === 'asc' ? 1 : -1
  const aEmpty = av == null || av === ''
  const bEmpty = bv == null || bv === ''
  if (aEmpty && bEmpty) return 0
  if (aEmpty) return 1
  if (bEmpty) return -1
  if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * mul
  return String(av).localeCompare(String(bv), 'he', { numeric: true }) * mul
}

export function SortableHead({
  col,
  label,
  sort,
  onToggle,
  className = '',
}: {
  col: string
  label: string
  sort: SortState
  onToggle: (col: string) => void
  className?: string
}) {
  const active = sort.key === col
  return (
    <TableHead
      className={`text-right text-purple-800 font-semibold cursor-pointer select-none hover:bg-purple-100 transition-colors ${className}`}
      onClick={() => onToggle(col)}
    >
      <span className="inline-flex items-center gap-1 justify-end w-full">
        {label}
        <span className="text-[10px] text-muted-foreground">
          {active ? (sort.dir === 'asc' ? '↑' : '↓') : '↕'}
        </span>
      </span>
    </TableHead>
  )
}
