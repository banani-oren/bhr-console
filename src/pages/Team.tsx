import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Profile, BonusModel, BonusTier } from '@/lib/types'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import LabeledToggle from '@/components/LabeledToggle'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from '@/components/ui/table'
import { Pencil, Trash2, UserCircle, Plus } from 'lucide-react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type EmployeeForm = {
  hours_category_enabled: boolean
  bonus_enabled: boolean
  bonus_filter_field: string
  bonus_filter_contains: string
  bonus_tiers: BonusTier[]
}

const emptyTier = (): BonusTier => ({ min: 0, bonus: 0 })

function profileToForm(profile: Profile): EmployeeForm {
  const bm = profile.bonus_model
  return {
    hours_category_enabled: profile.hours_category_enabled,
    bonus_enabled: !!bm,
    bonus_filter_field: bm?.filter?.field ?? '',
    bonus_filter_contains: bm?.filter?.contains ?? '',
    bonus_tiers: bm?.tiers ? bm.tiers.map((t) => ({ ...t })) : [],
  }
}

function formToPayload(form: EmployeeForm): Partial<Profile> {
  const bonus_model: BonusModel | null = form.bonus_enabled
    ? {
        type: 'flat',
        filter: {
          field: form.bonus_filter_field,
          contains: form.bonus_filter_contains,
        },
        tiers: form.bonus_tiers,
      }
    : null

  return {
    bonus_model,
    hours_category_enabled: form.hours_category_enabled,
  }
}

// ---------------------------------------------------------------------------
// Employee Form Body
// ---------------------------------------------------------------------------

type FormBodyProps = {
  form: EmployeeForm
  onChange: (form: EmployeeForm) => void
}

function EmployeeFormBody({ form, onChange }: FormBodyProps) {
  function set<K extends keyof EmployeeForm>(key: K, value: EmployeeForm[K]) {
    onChange({ ...form, [key]: value })
  }

  function updateTier(index: number, patch: Partial<BonusTier>) {
    const tiers = form.bonus_tiers.map((t, i) => (i === index ? { ...t, ...patch } : t))
    set('bonus_tiers', tiers)
  }

  function addTier() {
    set('bonus_tiers', [...form.bonus_tiers, emptyTier()])
  }

  function removeTier(index: number) {
    set('bonus_tiers', form.bonus_tiers.filter((_, i) => i !== index))
  }

  return (
    <div className="space-y-4 py-2">
      {/* Hours category toggle */}
      <LabeledToggle
        label="קטגוריית שעות (BHR/איגוד)"
        checked={form.hours_category_enabled}
        onCheckedChange={(v) => set('hours_category_enabled', v)}
        offText="מבוטל"
        onText="פעיל"
      />

      <Separator />

      {/* Bonus model */}
      <LabeledToggle
        label="מודל בונוס"
        checked={form.bonus_enabled}
        onCheckedChange={(v) => set('bonus_enabled', v)}
        offText="ללא בונוס"
        onText="בונוס פעיל"
      />

      {form.bonus_enabled && (
        <div className="space-y-4 pl-2 border-r-2 border-purple-200 pr-3">
          {/* Filter */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="tm-filter-field">שדה סינון</Label>
              <Input
                id="tm-filter-field"
                value={form.bonus_filter_field}
                onChange={(e) => set('bonus_filter_field', e.target.value)}
                placeholder="service_lead"
                dir="ltr"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tm-filter-contains">מכיל</Label>
              <Input
                id="tm-filter-contains"
                value={form.bonus_filter_contains}
                onChange={(e) => set('bonus_filter_contains', e.target.value)}
                placeholder="נועה"
              />
            </div>
          </div>

          {/* Tiers table */}
          <div className="space-y-2">
            <Label>מדרגות בונוס</Label>
            {form.bonus_tiers.length > 0 && (
              <div className="rounded-md border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10" />
                      <TableHead className="text-right">מינימום (₪)</TableHead>
                      <TableHead className="text-right">בונוס (₪)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {form.bonus_tiers.map((tier, i) => (
                      <TableRow key={i}>
                        <TableCell className="p-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            onClick={() => removeTier(i)}
                            type="button"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </TableCell>
                        <TableCell className="p-1">
                          <Input
                            type="number"
                            dir="ltr"
                            className="h-8 text-sm"
                            value={tier.min}
                            onChange={(e) =>
                              updateTier(i, { min: Number(e.target.value) })
                            }
                          />
                        </TableCell>
                        <TableCell className="p-1">
                          <Input
                            type="number"
                            dir="ltr"
                            className="h-8 text-sm"
                            value={tier.bonus}
                            onChange={(e) =>
                              updateTier(i, { bonus: Number(e.target.value) })
                            }
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addTier}
              className="flex items-center gap-1.5"
            >
              <Plus className="h-3.5 w-3.5" />
              הוסף מדרגה
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function Team() {
  const queryClient = useQueryClient()

  // Admin is also an employee (Phase B): include all three roles so admins
  // appear as cards alongside every employee.
  const { data: employees = [], isLoading } = useQuery<Profile[]>({
    queryKey: ['team-employees'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .in('role', ['admin', 'administration', 'recruiter'])
        .order('full_name', { ascending: true })
      if (error) throw error
      return data as Profile[]
    },
  })

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingProfile, setEditingProfile] = useState<Profile | null>(null)
  const [form, setForm] = useState<EmployeeForm>({
    hours_category_enabled: false,
    bonus_enabled: false,
    bonus_filter_field: '',
    bonus_filter_contains: '',
    bonus_tiers: [],
  })
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle')

  function openEditDialog(profile: Profile) {
    setEditingProfile(profile)
    setForm(profileToForm(profile))
    setSaveStatus('idle')
    setDialogOpen(true)
  }

  function closeDialog() {
    setDialogOpen(false)
    setEditingProfile(null)
    setSaveStatus('idle')
  }

  async function handleSave() {
    if (!editingProfile) return
    setSaveStatus('saving')

    const payload = formToPayload(form)

    const { data, error } = await supabase
      .from('profiles')
      .update(payload)
      .eq('id', editingProfile.id)
      .select()

    if (error) {
      console.error('Save error:', error)
      setSaveStatus('error')
      return
    }
    console.log('Saved:', data)

    setSaveStatus('success')
    queryClient.invalidateQueries({ queryKey: ['team-employees'] })
    setTimeout(() => closeDialog(), 2000)
  }

  return (
    <div dir="rtl" className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">צוות</h1>
        <p className="text-sm text-muted-foreground">
          להוספת עובד חדש, הזמן אותו דרך <strong>ניהול משתמשים</strong>
        </p>
      </div>

      {/* Cards grid */}
      {isLoading ? (
        <div className="py-12 text-center text-muted-foreground">טוען...</div>
      ) : employees.length === 0 ? (
        <div className="py-12 text-center text-muted-foreground">
          אין עובדים עדיין. הזמן עובד חדש דרך "ניהול משתמשים".
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {employees.map((emp) => (
            <Card key={emp.id} className="flex flex-col">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <UserCircle className="h-8 w-8 shrink-0 text-purple-500" />
                    <div className="min-w-0">
                      <CardTitle className="text-lg leading-tight truncate">
                        {emp.full_name}
                      </CardTitle>
                      <Badge
                        variant="secondary"
                        className={`mt-1 text-xs font-normal ${
                          emp.role === 'admin'
                            ? 'bg-purple-100 text-purple-700'
                            : emp.role === 'administration'
                            ? 'bg-blue-50 text-blue-700'
                            : ''
                        }`}
                      >
                        {emp.role === 'admin'
                          ? 'מנהל'
                          : emp.role === 'administration'
                          ? 'מנהלה'
                          : 'רכז/ת גיוס'}
                      </Badge>
                    </div>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8"
                    onClick={() => openEditDialog(emp)}
                    title="עריכה"
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>

              <CardContent className="flex flex-col gap-3 pt-0">
                {emp.email && (
                  <p className="text-sm text-muted-foreground truncate" dir="ltr">
                    {emp.email}
                  </p>
                )}

                <div className="flex flex-wrap gap-1.5">
                  {emp.hours_category_enabled && (
                    <Badge variant="outline" className="text-xs border-purple-300 text-purple-700">
                      שעות BHR/איגוד
                    </Badge>
                  )}
                  {emp.bonus_model && (
                    <Badge variant="outline" className="text-xs border-green-300 text-green-700">
                      בונוס פעיל
                    </Badge>
                  )}
                </div>

              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Edit Dialog — employee-specific fields only */}
      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) closeDialog() }}>
        <DialogContent dir="rtl" className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              עריכת {editingProfile?.full_name}
            </DialogTitle>
          </DialogHeader>

          <EmployeeFormBody form={form} onChange={setForm} />

          <DialogFooter className="flex flex-col gap-2">
            {saveStatus === 'success' && (
              <p className="text-green-600 font-medium text-sm text-right">המידע נשמר ✓</p>
            )}
            {saveStatus === 'error' && (
              <p className="text-red-600 font-medium text-sm text-right">שגיאה בשמירה, נסה שנית</p>
            )}
            <div className="flex gap-2 flex-row-reverse">
              <Button
                onClick={handleSave}
                disabled={saveStatus === 'saving' || saveStatus === 'success'}
                className="bg-purple-600 hover:bg-purple-700 text-white"
              >
                {saveStatus === 'saving' ? 'שומר...' : 'שמור'}
              </Button>
              <Button variant="outline" onClick={closeDialog} disabled={saveStatus === 'saving'}>
                ביטול
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
