import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { Supplier } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

type EditState = {
  id: string | null
  first_name: string
  last_name: string
  email: string
  mobile: string
}

const EMPTY_EDIT: EditState = {
  id: null,
  first_name: '',
  last_name: '',
  email: '',
  mobile: '',
}

export default function Suppliers() {
  const queryClient = useQueryClient()

  const { data: suppliers = [], isLoading } = useQuery<Supplier[]>({
    queryKey: ['suppliers'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('suppliers')
        .select('*')
        .order('last_name', { ascending: true })
      if (error) throw error
      return data as Supplier[]
    },
  })

  const [editOpen, setEditOpen] = useState(false)
  const [edit, setEdit] = useState<EditState>(EMPTY_EDIT)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle')
  const [deleteTarget, setDeleteTarget] = useState<Supplier | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const openCreate = () => {
    setEdit(EMPTY_EDIT)
    setSaveStatus('idle')
    setEditOpen(true)
  }

  const openEdit = (s: Supplier) => {
    setEdit({
      id: s.id,
      first_name: s.first_name,
      last_name: s.last_name,
      email: s.email ?? '',
      mobile: s.mobile ?? '',
    })
    setSaveStatus('idle')
    setEditOpen(true)
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        first_name: edit.first_name.trim(),
        last_name: edit.last_name.trim(),
        email: edit.email.trim() || null,
        mobile: edit.mobile.trim() || null,
      }
      if (edit.id) {
        const { error } = await supabase.from('suppliers').update(payload).eq('id', edit.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('suppliers').insert(payload)
        if (error) throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] })
    },
  })

  const handleSave = async () => {
    if (!edit.first_name.trim() || !edit.last_name.trim()) return
    setSaveStatus('saving')
    try {
      await saveMutation.mutateAsync()
      setSaveStatus('success')
      setTimeout(() => {
        setSaveStatus('idle')
        setEditOpen(false)
      }, 1200)
    } catch (err) {
      console.error('Supplier save error:', err)
      setSaveStatus('error')
    }
  }

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      // Check if any transactions reference this supplier
      const { count, error: cntErr } = await supabase
        .from('transactions')
        .select('id', { head: true, count: 'exact' })
        .eq('supplier_id', id)
      if (cntErr) throw cntErr
      if ((count ?? 0) > 0)
        throw new Error(`לא ניתן למחוק — קיימות ${count} עסקאות המשויכות לספק זה`)
      const { error } = await supabase.from('suppliers').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] })
      setDeleteTarget(null)
      setDeleteError(null)
    },
  })

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleteError(null)
    try {
      await deleteMutation.mutateAsync(deleteTarget.id)
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'שגיאה במחיקה')
    }
  }

  const canSave = edit.first_name.trim() !== '' && edit.last_name.trim() !== ''

  return (
    <div dir="rtl" className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight text-purple-900">ספקים</h1>
        <Button
          onClick={openCreate}
          className="bg-purple-600 hover:bg-purple-700 text-white flex items-center gap-2"
        >
          <Plus className="h-4 w-4" />
          ספק חדש
        </Button>
      </div>

      <p className="text-sm text-muted-foreground">
        ספקים הם גורמים חיצוניים (ממליצים, שותפים, קבלני משנה) שמקבלים אחוז מעמלת ההשמה.
        ניתן לשייך ספק לעסקה ולהגדיר את אחוזו ישירות בטופס העסקה.
      </p>

      {isLoading ? (
        <div className="p-8 text-center text-muted-foreground">טוען...</div>
      ) : suppliers.length === 0 ? (
        <Card className="p-8 text-center text-muted-foreground">אין ספקים. לחץ "ספק חדש" כדי להוסיף.</Card>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-right">שם משפחה</TableHead>
                <TableHead className="text-right">שם פרטי</TableHead>
                <TableHead className="text-right">אימייל</TableHead>
                <TableHead className="text-right">נייד</TableHead>
                <TableHead className="w-20"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {suppliers.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{s.last_name}</TableCell>
                  <TableCell>{s.first_name}</TableCell>
                  <TableCell className="text-muted-foreground">{s.email ?? '—'}</TableCell>
                  <TableCell className="text-muted-foreground" dir="ltr">{s.mobile ?? '—'}</TableCell>
                  <TableCell>
                    <div className="flex gap-1 justify-end">
                      <Button size="icon" variant="ghost" onClick={() => openEdit(s)} title="עריכה">
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        onClick={() => { setDeleteTarget(s); setDeleteError(null) }}
                        title="מחיקה"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {/* Add / Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent dir="rtl" className="max-w-md">
          <DialogHeader>
            <DialogTitle>{edit.id ? 'עריכת ספק' : 'ספק חדש'}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>שם פרטי *</Label>
                <Input
                  value={edit.first_name}
                  onChange={(e) => setEdit((s) => ({ ...s, first_name: e.target.value }))}
                  placeholder="ישראל"
                />
              </div>
              <div className="space-y-1.5">
                <Label>שם משפחה *</Label>
                <Input
                  value={edit.last_name}
                  onChange={(e) => setEdit((s) => ({ ...s, last_name: e.target.value }))}
                  placeholder="ישראלי"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>אימייל</Label>
              <Input
                type="email"
                dir="ltr"
                value={edit.email}
                onChange={(e) => setEdit((s) => ({ ...s, email: e.target.value }))}
                placeholder="example@email.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label>נייד</Label>
              <Input
                type="tel"
                dir="ltr"
                value={edit.mobile}
                onChange={(e) => setEdit((s) => ({ ...s, mobile: e.target.value }))}
                placeholder="050-0000000"
              />
            </div>
          </div>

          <DialogFooter className="flex flex-col gap-2">
            {saveStatus === 'success' && <p className="text-green-600 text-sm text-right">נשמר ✓</p>}
            {saveStatus === 'error' && <p className="text-red-600 text-sm text-right">שגיאה בשמירה</p>}
            <div className="flex gap-2 flex-row-reverse">
              <Button
                onClick={handleSave}
                disabled={saveStatus === 'saving' || saveStatus === 'success' || !canSave}
                className="bg-purple-600 hover:bg-purple-700 text-white"
              >
                {saveStatus === 'saving' ? 'שומר...' : 'שמור'}
              </Button>
              <Button variant="outline" onClick={() => setEditOpen(false)} disabled={saveStatus === 'saving'}>
                ביטול
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) { setDeleteTarget(null); setDeleteError(null) } }}
      >
        <DialogContent dir="rtl" className="max-w-sm">
          <DialogHeader><DialogTitle>מחיקת ספק</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            האם למחוק את{' '}
            <span className="font-semibold text-foreground">
              {deleteTarget?.first_name} {deleteTarget?.last_name}
            </span>?
          </p>
          {deleteError && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 p-2 rounded">
              {deleteError}
            </p>
          )}
          <DialogFooter className="flex gap-2 flex-row-reverse">
            <Button variant="destructive" onClick={handleDelete}>מחק</Button>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>ביטול</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
