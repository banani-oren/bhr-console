import { useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Check, ChevronsUpDown, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { Client } from '@/lib/types'
import { Input } from '@/components/ui/input'

// Batch 4 Phase A1: centralized client picker. Renders the client's NAME in
// the trigger regardless of whether the outer component knows it yet. Used
// on /hours, /transactions, /billing-reports, /clients time-log permissions.

type Props = {
  value: string | null
  onChange: (id: string | null, client: Client | null) => void
  // Optional pre-filter (e.g. only time_log_enabled clients, or a permission set).
  filter?: (client: Client) => boolean
  placeholder?: string
  emptyLabel?: string
  allSentinelLabel?: string | null // if set, renders an "all clients" option that yields null
  disabled?: boolean
  className?: string
  /** Show a clear button when a selection is active. Default: true. */
  allowClear?: boolean
}

export default function ClientPicker({
  value,
  onChange,
  filter,
  placeholder = 'חיפוש לקוח...',
  emptyLabel = 'לא נמצאו לקוחות',
  allSentinelLabel = null,
  disabled,
  className,
  allowClear = true,
}: Props) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const { data: clients = [] } = useQuery<Client[]>({
    queryKey: ['clients'],
    queryFn: async () => {
      const { data, error } = await supabase.from('clients').select('*').order('name', { ascending: true })
      if (error) throw error
      return (data as Client[]) ?? []
    },
  })

  const pool = useMemo(
    () => (filter ? clients.filter(filter) : clients),
    [clients, filter],
  )

  const selected = useMemo(
    () => pool.find((c) => c.id === value) ?? null,
    [pool, value],
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return pool.slice(0, 10)
    return pool
      .filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          (c.company_id ?? '').toLowerCase().includes(q),
      )
      .slice(0, 10)
  }, [pool, query])

  return (
    <div className={`relative ${className ?? ''}`}>
      <div
        className={`flex items-center gap-2 border rounded-md px-3 py-2 bg-background ${
          disabled ? 'opacity-60 pointer-events-none' : ''
        }`}
      >
        <Input
          ref={inputRef}
          className="border-0 focus-visible:ring-0 p-0 flex-1 bg-transparent"
          placeholder={placeholder}
          value={selected ? selected.name : query}
          onChange={(e) => {
            if (selected) onChange(null, null)
            setQuery(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
        />
        {selected && allowClear ? (
          <button
            type="button"
            onClick={() => {
              onChange(null, null)
              setQuery('')
              setOpen(true)
              inputRef.current?.focus()
            }}
            className="text-muted-foreground hover:text-foreground"
            aria-label="נקה"
          >
            <X className="h-4 w-4" />
          </button>
        ) : (
          <ChevronsUpDown className="h-4 w-4 text-muted-foreground" />
        )}
      </div>
      {open && !selected && (
        <div
          className="absolute z-50 left-0 right-0 mt-1 rounded-md border bg-popover shadow-md max-h-60 overflow-y-auto"
          onMouseLeave={() => setOpen(false)}
        >
          {allSentinelLabel && (
            <button
              type="button"
              onClick={() => {
                onChange(null, null)
                setOpen(false)
                setQuery('')
              }}
              className="w-full text-right px-3 py-2 hover:bg-purple-50 text-sm font-medium text-purple-700 border-b"
            >
              {allSentinelLabel}
            </button>
          )}
          {filtered.length === 0 ? (
            <div className="p-3 text-sm text-muted-foreground text-center">{emptyLabel}</div>
          ) : (
            filtered.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  onChange(c.id, c)
                  setOpen(false)
                  setQuery('')
                }}
                className="w-full text-right px-3 py-2 hover:bg-purple-50 flex items-center justify-between"
              >
                <div>
                  <div className="text-sm font-medium">{c.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {c.company_id ?? '—'}
                    {c.agreement_type ? ` · ${c.agreement_type}` : ''}
                    {c.commission_percent != null ? ` · ${c.commission_percent}%` : ''}
                  </div>
                </div>
                {value === c.id && <Check className="h-4 w-4 text-purple-600" />}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
