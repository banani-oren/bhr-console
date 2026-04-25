import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import type { Client, HoursLog } from '@/lib/types'
import { useSafeMutation } from '@/hooks/useSafeMutation'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import ClientPicker from '@/components/ClientPicker'
import { DateCell } from '@/components/ui/date-cell'
import HoursEntryDialog from './HoursEntryDialog'
import {
  HEBREW_MONTHS, CURRENT_MONTH, CURRENT_YEAR, YEAR_OPTIONS, monthLabel,
} from './common'

export default function MyHoursView() {
  const { profile } = useAuth()
  const queryClient = useQueryClient()
  const isAdmin = profile?.role === 'admin'

  const [clientId, setClientId] = useState<string | null>(null)
  const [month, setMonth] = useState<number>(CURRENT_MONTH)
  const [year, setYear] = useState<number>(CURRENT_YEAR)
  const [entryOpen, setEntryOpen] = useState(false)
  const [editing, setEditing] = useState<HoursLog | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<HoursLog | null>(null)

  // Permitted clients for this user.
  // Admin: every time_log_enabled client.
  // Non-admin: intersection of client_time_log_permissions + time_log_enabled.
  const { data: permittedClients = [] } = useQuery<Client[]>({
    queryKey: ['hours-my-permitted-clients', profile?.id, isAdmin],
    enabled: !!profile?.id,
    queryFn: async () => {
      if (isAdmin) {
        const { data, error } = await supabase
          .from('clients')
          .select('*')
          .eq('time_log_enabled', true)
          .order('name', { ascending: true })
        if (error) throw error
        return (data as Client[]) ?? []
      }
      const { data, error } = await supabase
        .from('client_time_log_permissions')
        .select('client_id, clients(*)')
        .eq('profile_id', profile!.id)
      if (error) throw error
      const rows = (data as unknown as Array<{ clients: Client | Client[] | null }> | null) ?? []
      return rows
        .flatMap((r) => (Array.isArray(r.clients) ? r.clients : r.clients ? [r.clients] : []))
        .filter((c) => c && c.time_log_enabled)
    },
  })

  const { data: hoursData = [], isLoading } = useQuery<HoursLog[]>({
    queryKey: ['hours-my', profile?.id, month, year, clientId ?? 'all'],
    enabled: !!profile?.id,
    queryFn: async () => {
      let q = supabase
        .from('hours_log')
        .select('*')
        .eq('profile_id', profile!.id)
        .eq('month', month)
        .eq('year', year)
        .order('visit_date', { ascending: true })
      if (clientId) q = q.eq('client_id', clientId)
      const { data, error } = await q
      if (error) throw error
      return data as HoursLog[]
    },
  })

  const totalHours = useMemo(
    () => hoursData.reduce((s, h) => s + (Number(h.hours) || 0), 0),
    [hoursData],
  )

  const deleteMut = useSafeMutation<{ id: string }, void>({
    mutationFn: async ({ id }) => {
      const { error } = await supabase.from('hours_log').delete().eq('id', id)
      if (error) throw error
    },
    invalidate: [['hours-my'], ['hours_log']],
    successHoldMs: 800,
    onSuccess: () => {
      setDeleteTarget(null)
      queryClient.invalidateQueries({ queryKey: ['hours-my'] })
    },
  })

  const clientFilter = (c: Client) => permittedClients.some((p) => p.id === c.id)

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex items-end gap-3 flex-wrap">
          <div className="space-y-1 min-w-60 flex-1">
            <Label className="text-xs text-purple-700">לקוח</Label>
            <ClientPicker
              value={clientId}
              onChange={(id) => setClientId(id)}
              filter={clientFilter}
              placeholder="כל הלקוחות שלי"
              allSentinelLabel="כל הלקוחות שלי"
              emptyLabel="אין לקוחות מורשים"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-purple-700">חודש</Label>
            <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                {HEBREW_MONTHS.map((n, i) => (
                  <SelectItem key={i + 1} value={String(i + 1)}>{n}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-purple-700">שנה</Label>
            <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
              <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
              <SelectContent>
                {YEAR_OPTIONS.map((y) => (
                  <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            onClick={() => { setEditing(null); setEntryOpen(true) }}
            className="bg-purple-600 hover:bg-purple-700 text-white"
            disabled={permittedClients.length === 0}
          >
            <Plus className="w-4 h-4 ml-1" />
            הוסף דיווח
          </Button>
        </div>
      </Card>

      <Card>
        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground">טוען...</div>
        ) : hoursData.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">אין דיווחים בחודש זה</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-purple-50">
                <TableHead className="text-right text-purple-800">תאריך</TableHead>
                <TableHead className="text-right text-purple-800">לקוח</TableHead>
                <TableHead className="text-right text-purple-800">משעה</TableHead>
                <TableHead className="text-right text-purple-800">עד שעה</TableHead>
                <TableHead className="text-right text-purple-800">שעות</TableHead>
                <TableHead className="text-right text-purple-800">תיאור</TableHead>
                <TableHead className="text-right text-purple-800">פעולות</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {hoursData.map((entry) => (
                <TableRow key={entry.id} className="hover:bg-purple-50/40">
                  <TableCell><DateCell value={entry.visit_date} /></TableCell>
                  <TableCell>{entry.client_name}</TableCell>
                  <TableCell dir="ltr" className="text-right">{entry.start_time ?? '—'}</TableCell>
                  <TableCell dir="ltr" className="text-right">{entry.end_time ?? '—'}</TableCell>
                  <TableCell>{entry.hours}</TableCell>
                  <TableCell className="text-muted-foreground">{entry.description ?? '—'}</TableCell>
                  <TableCell>
                    <div className="flex gap-1 justify-end">
                      <Button
                        size="icon" variant="ghost" className="h-8 w-8 text-purple-600 hover:bg-purple-100"
                        onClick={() => { setEditing(entry); setEntryOpen(true) }}
                        title="עריכה"
                      >
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button
                        size="icon" variant="ghost" className="h-8 w-8 text-red-500 hover:bg-red-50"
                        onClick={() => setDeleteTarget(entry)}
                        title="מחיקה"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <div className="flex items-center justify-between px-4 py-3 border-t border-purple-100 bg-purple-50/60">
          <span className="text-sm font-semibold text-purple-800">
            סה"כ שעות — {monthLabel(month, year)}
          </span>
          <span className="text-lg font-bold text-purple-900">{totalHours.toFixed(2)} ש'</span>
        </div>
      </Card>

      <HoursEntryDialog
        open={entryOpen}
        onOpenChange={(open) => { setEntryOpen(open); if (!open) setEditing(null) }}
        clientFilter={clientFilter}
        editing={editing}
        invalidate={[['hours-my']]}
      />

      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}>
        <DialogContent dir="rtl" className="max-w-sm">
          <DialogHeader>
            <DialogTitle>מחיקת דיווח</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            האם למחוק את הדיווח של {deleteTarget?.client_name} מתאריך {deleteTarget?.visit_date}?
          </p>
          {deleteMut.saveStatus === 'error' && (
            <p className="text-sm text-destructive">{deleteMut.errorMessage ?? 'שגיאה'}</p>
          )}
          <DialogFooter className="flex gap-2 flex-row-reverse">
            <Button
              variant="destructive"
              disabled={deleteMut.saveStatus === 'saving'}
              onClick={() => deleteTarget && void deleteMut.mutate({ id: deleteTarget.id })}
            >
              {deleteMut.saveStatus === 'saving' ? 'מוחק...' : 'מחק'}
            </Button>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>ביטול</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
