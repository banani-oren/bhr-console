import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Check, ChevronsUpDown, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { Client } from '@/lib/types'
import { Input } from '@/components/ui/input'

// Centralized client picker. Renders the client's NAME in the trigger
// regardless of whether the outer component knows it yet. Used on /hours,
// /transactions, /billing-reports, /clients time-log permissions, and the
// mobile shell.
//
// QUICK_FIXES_NAME_HOURS Phase B: the dropdown is openable EVEN WHEN a
// client is already selected, so the user can swap to a different client
// without first clearing the field. Typing replaces the selection in
// place. Escape closes without clearing. Click-outside closes the menu.

type Props = {
  value: string | null
  onChange: (id: string | null, client: Client | null) => void
  filter?: (client: Client) => boolean
  placeholder?: string
  emptyLabel?: string
  allSentinelLabel?: string | null // if set, renders an "all clients" option
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
  const wrapperRef = useRef<HTMLDivElement>(null)
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
    if (!q) return pool.slice(0, 50)
    return pool
      .filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          (c.company_id ?? '').toLowerCase().includes(q),
      )
      .slice(0, 50)
  }, [pool, query])

  // Click-outside closes the dropdown.
  useEffect(() => {
    if (!open) return
    function onDocDown(e: MouseEvent) {
      const root = wrapperRef.current
      if (root && !root.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocDown)
    return () => document.removeEventListener('mousedown', onDocDown)
  }, [open])

  function pickClient(c: Client) {
    onChange(c.id, c)
    setOpen(false)
    setQuery('')
  }

  function clearSelection() {
    onChange(null, null)
    setQuery('')
    setOpen(true)
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  // The visible value for the input.
  // - User typing: show the query (live filter).
  // - Otherwise:    show the selected client's name (or empty).
  const displayValue = query.length > 0 ? query : (selected?.name ?? '')

  return (
    <div
      className={`relative ${className ?? ''}`}
      ref={wrapperRef}
    >
      <div
        className={`flex items-center gap-2 border rounded-md px-3 py-2 bg-background cursor-text ${
          disabled ? 'opacity-60 pointer-events-none' : ''
        }`}
        onClick={() => {
          // Clicking anywhere in the field opens the menu and focuses the input
          // so the user can type to swap to a different client.
          setOpen(true)
          inputRef.current?.focus()
        }}
      >
        <Input
          ref={inputRef}
          className="border-0 focus-visible:ring-0 p-0 flex-1 bg-transparent"
          placeholder={selected ? '' : placeholder}
          value={displayValue}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setOpen(false)
              setQuery('')
              ;(e.target as HTMLInputElement).blur()
            }
          }}
        />
        {selected && allowClear ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              clearSelection()
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

      {open && !disabled && (
        <div className="absolute z-50 left-0 right-0 mt-1 rounded-md border bg-popover shadow-md max-h-60 overflow-y-auto">
          {allSentinelLabel && (
            <button
              type="button"
              onClick={() => {
                onChange(null, null)
                setOpen(false)
                setQuery('')
              }}
              className={`w-full text-right px-3 py-2 hover:bg-purple-50 text-sm font-medium border-b ${
                !value ? 'text-purple-700 bg-purple-50/50' : 'text-purple-700'
              }`}
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
                onClick={() => pickClient(c)}
                className={`w-full text-right px-3 py-2 hover:bg-purple-50 flex items-center justify-between ${
                  value === c.id ? 'bg-purple-50/50' : ''
                }`}
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
