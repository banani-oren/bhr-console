import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, GripVertical, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import {
  type ServiceType,
  type ServiceField,
  type ServiceFieldType,
  type ServiceFieldWidth,
  FIELD_TYPE_LABELS,
  WIDTH_LABELS,
  emptyField,
  slugifyKey,
} from '@/lib/serviceTypes'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

type EditState = {
  id: string | null
  name: string
  display_order: number
  fields: ServiceField[]
}

const EMPTY_EDIT: EditState = {
  id: null,
  name: '',
  display_order: 0,
  fields: [],
}

export default function Services() {
  const queryClient = useQueryClient()

  const { data: serviceTypes = [], isLoading } = useQuery<ServiceType[]>({
    queryKey: ['service_types'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('service_types')
        .select('*')
        .order('display_order', { ascending: true })
      if (error) throw error
      return data as ServiceType[]
    },
  })

  const [editOpen, setEditOpen] = useState(false)
  const [edit, setEdit] = useState<EditState>(EMPTY_EDIT)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle')
  const [deleteTarget, setDeleteTarget] = useState<ServiceType | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const openCreate = () => {
    const nextOrder = serviceTypes.length
      ? Math.max(...serviceTypes.map((s) => s.display_order)) + 1
      : 1
    setEdit({ ...EMPTY_EDIT, display_order: nextOrder })
    setSaveStatus('idle')
    setEditOpen(true)
  }

  const openEdit = (s: ServiceType) => {
    setEdit({
      id: s.id,
      name: s.name,
      display_order: s.display_order,
      fields: s.fields.map((f) => ({ ...f })),
    })
    setSaveStatus('idle')
    setEditOpen(true)
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name: edit.name.trim(),
        display_order: edit.display_order,
        fields: edit.fields.map((f) => ({
          key: (f.key || slugifyKey(f.label)).trim(),
          label: f.label.trim(),
          type: f.type,
          required: !!f.required,
          width: f.width ?? 'half',
          options:
            f.type === 'select' && Array.isArray(f.options) && f.options.length > 0
              ? f.options
              : null,
          default: f.default ?? null,
        })),
      }
      if (edit.id) {
        const { error } = await supabase
          .from('service_types')
          .update(payload)
          .eq('id', edit.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('service_types').insert(payload)
        if (error) throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['service_types'] })
    },
  })

  const handleSave = async () => {
    if (!edit.name.trim()) return
    setSaveStatus('saving')
    try {
      await saveMutation.mutateAsync()
      setSaveStatus('success')
      setTimeout(() => {
        setSaveStatus('idle')
        setEditOpen(false)
      }, 1500)
    } catch (err) {
      console.error('Service type save error:', err)
      setSaveStatus('error')
    }
  }

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { count, error: cntErr } = await supabase
        .from('transactions')
        .select('id', { head: true, count: 'exact' })
        .eq('service_type_id', id)
      if (cntErr) throw cntErr
      if ((count ?? 0) > 0) throw new Error(`לא ניתן למחוק — קיימות ${count} עסקאות המשויכות לסוג שירות זה`)
      const { error } = await supabase.from('service_types').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['service_types'] })
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

  const updateField = (idx: number, patch: Partial<ServiceField>) => {
    setEdit((e) => ({
      ...e,
      fields: e.fields.map((f, i) => (i === idx ? { ...f, ...patch } : f)),
    }))
  }

  const addField = () => {
    setEdit((e) => ({ ...e, fields: [...e.fields, emptyField()] }))
  }

  const removeField = (idx: number) => {
    setEdit((e) => ({ ...e, fields: e.fields.filter((_, i) => i !== idx) }))
  }

  const moveField = (idx: number, dir: -1 | 1) => {
    setEdit((e) => {
      const next = [...e.fields]
      const swap = idx + dir
      if (swap < 0 || swap >= next.length) return e
      ;[next[idx], next[swap]] = [next[swap], next[idx]]
      return { ...e, fields: next }
    })
  }

  const sorted = useMemo(
    () =>
      [...serviceTypes].sort(
        (a, b) => a.display_order - b.display_order || a.name.localeCompare(b.name, 'he'),
      ),
    [serviceTypes],
  )

  return (
    <div dir="rtl" className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold tracking-tight text-purple-900">סוגי שירות</h1>
          <Button
            onClick={openCreate}
            className="bg-purple-600 hover:bg-purple-700 text-white flex items-center gap-2"
          >
            <Plus className="h-4 w-4" />
            סוג שירות חדש
          </Button>
        </div>

        <p className="text-sm text-muted-foreground">
          כל סוג שירות מגדיר את השדות המותאמים שיוצגו בטופס העסקה שלו.
          שדות אוניברסליים (לקוח, תאריכים, חשבונית וכד') מוצגים תמיד.
        </p>

        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground">טוען...</div>
        ) : sorted.length === 0 ? (
          <Card className="p-8 text-center text-muted-foreground">אין סוגי שירות</Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {sorted.map((s) => (
              <Card key={s.id} className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-purple-900">{s.name}</h3>
                    <p className="text-xs text-muted-foreground">סדר: {s.display_order} · {s.fields.length} שדות</p>
                  </div>
                  <div className="flex gap-1">
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
                </div>
                <ul className="text-xs text-muted-foreground grid grid-cols-2 gap-x-3 gap-y-1">
                  {s.fields.map((f) => (
                    <li key={f.key} className="truncate">
                      <span className="text-purple-700 font-medium">{f.label || f.key}</span>
                      <span className="text-muted-foreground/70">
                        {' '}— {FIELD_TYPE_LABELS[f.type]}
                        {f.required ? ' *' : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            ))}
          </div>
        )}

        {/* Add / Edit Dialog */}
        <Dialog open={editOpen} onOpenChange={setEditOpen}>
          <DialogContent dir="rtl" className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{edit.id ? 'עריכת סוג שירות' : 'סוג שירות חדש'}</DialogTitle>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>שם *</Label>
                  <Input
                    value={edit.name}
                    onChange={(e) => setEdit((s) => ({ ...s, name: e.target.value }))}
                    placeholder="למשל: הד האנטינג"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>סדר הצגה</Label>
                  <Input
                    type="number"
                    dir="ltr"
                    value={edit.display_order}
                    onChange={(e) =>
                      setEdit((s) => ({ ...s, display_order: Number(e.target.value) || 0 }))
                    }
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-purple-700">שדות מותאמים</h3>
                  <Button size="sm" variant="outline" onClick={addField}>
                    <Plus className="h-3 w-3 ml-1" /> הוסף שדה
                  </Button>
                </div>

                {edit.fields.length === 0 ? (
                  <Card className="p-4 text-center text-muted-foreground text-sm">
                    אין שדות מותאמים. לחץ "הוסף שדה" כדי להתחיל.
                  </Card>
                ) : (
                  <div className="space-y-2">
                    {edit.fields.map((f, idx) => (
                      <Card key={idx} className="p-3">
                        <div className="grid grid-cols-12 gap-2 items-start">
                          <div className="col-span-1 flex items-center justify-center text-muted-foreground pt-7">
                            <div className="flex flex-col gap-0.5">
                              <button
                                className="hover:text-purple-700 disabled:opacity-20"
                                disabled={idx === 0}
                                onClick={() => moveField(idx, -1)}
                              >▲</button>
                              <button
                                className="hover:text-purple-700 disabled:opacity-20"
                                disabled={idx === edit.fields.length - 1}
                                onClick={() => moveField(idx, 1)}
                              >▼</button>
                            </div>
                            <GripVertical className="h-4 w-4 opacity-50 mr-1" />
                          </div>
                          <div className="col-span-3 space-y-1">
                            <Label className="text-xs">תווית</Label>
                            <Input
                              value={f.label}
                              onChange={(e) =>
                                updateField(idx, {
                                  label: e.target.value,
                                  key: f.key || slugifyKey(e.target.value),
                                })
                              }
                              placeholder="למשל: שכר"
                            />
                          </div>
                          <div className="col-span-3 space-y-1">
                            <Label className="text-xs">מפתח (key)</Label>
                            <Input
                              dir="ltr"
                              value={f.key}
                              onChange={(e) => updateField(idx, { key: e.target.value })}
                              placeholder="salary"
                            />
                          </div>
                          <div className="col-span-2 space-y-1">
                            <Label className="text-xs">סוג</Label>
                            <Select
                              value={f.type}
                              onValueChange={(v) =>
                                updateField(idx, { type: v as ServiceFieldType })
                              }
                            >
                              <SelectTrigger><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {Object.entries(FIELD_TYPE_LABELS).map(([k, lbl]) => (
                                  <SelectItem key={k} value={k}>{lbl}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="col-span-2 space-y-1">
                            <Label className="text-xs">רוחב</Label>
                            <Select
                              value={f.width ?? 'half'}
                              onValueChange={(v) =>
                                updateField(idx, { width: v as ServiceFieldWidth })
                              }
                            >
                              <SelectTrigger><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {Object.entries(WIDTH_LABELS).map(([k, lbl]) => (
                                  <SelectItem key={k} value={k}>{lbl}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="col-span-1 flex items-center justify-center pt-6">
                            <Button
                              size="icon"
                              variant="ghost"
                              className="text-destructive hover:text-destructive"
                              onClick={() => removeField(idx)}
                              title="מחק שדה"
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </div>

                          {/* Required + options row */}
                          <div className="col-span-1"></div>
                          <div className="col-span-3 flex items-center gap-2 pt-1">
                            <Switch
                              checked={!!f.required}
                              onCheckedChange={(v) => updateField(idx, { required: v })}
                            />
                            <Label className="text-xs">שדה חובה</Label>
                          </div>
                          {f.type === 'select' && (
                            <div className="col-span-8 space-y-1">
                              <Label className="text-xs">אפשרויות (מופרדות בפסיק)</Label>
                              <Input
                                value={(f.options ?? []).join(', ')}
                                onChange={(e) =>
                                  updateField(idx, {
                                    options: e.target.value
                                      .split(',')
                                      .map((s) => s.trim())
                                      .filter(Boolean),
                                  })
                                }
                              />
                            </div>
                          )}
                        </div>
                      </Card>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <DialogFooter className="flex flex-col gap-2">
              {saveStatus === 'success' && (
                <p className="text-green-600 font-medium text-sm text-right">נשמר ✓</p>
              )}
              {saveStatus === 'error' && (
                <p className="text-red-600 font-medium text-sm text-right">שגיאה בשמירה</p>
              )}
              <div className="flex gap-2 flex-row-reverse">
                <Button
                  onClick={handleSave}
                  disabled={saveStatus === 'saving' || !edit.name.trim()}
                  className="bg-purple-600 hover:bg-purple-700 text-white"
                >
                  {saveStatus === 'saving' ? 'שומר...' : 'שמור'}
                </Button>
                <Button variant="outline" onClick={() => setEditOpen(false)}>ביטול</Button>
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
            <DialogHeader><DialogTitle>מחיקת סוג שירות</DialogTitle></DialogHeader>
            <p className="text-sm text-muted-foreground">
              האם למחוק את סוג השירות <span className="font-semibold text-foreground">{deleteTarget?.name}</span>?
              ניתן למחוק רק אם אין עסקאות המשויכות אליו.
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
