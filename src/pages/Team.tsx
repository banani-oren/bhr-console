import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTable, useDelete } from '@/hooks/useSupabaseQuery'
import { supabase } from '@/lib/supabase'
import type { TeamMember, BonusModel, BonusTier } from '@/lib/types'
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
import { Switch } from '@/components/ui/switch'
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
import { Plus, Pencil, Trash2, Copy, Link, UserCircle } from 'lucide-react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type MemberForm = {
  name: string
  role: string
  email: string
  hours_category_enabled: boolean
  bonus_enabled: boolean
  bonus_filter_field: string
  bonus_filter_contains: string
  bonus_tiers: BonusTier[]
}

const emptyTier = (): BonusTier => ({ min: 0, bonus: 0 })

const emptyForm: MemberForm = {
  name: '',
  role: '',
  email: '',
  hours_category_enabled: false,
  bonus_enabled: false,
  bonus_filter_field: '',
  bonus_filter_contains: '',
  bonus_tiers: [],
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formToPayload(form: MemberForm): Partial<TeamMember> {
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
    name: form.name,
    role: form.role,
    email: form.email,
    hours_category_enabled: form.hours_category_enabled,
    bonus_model,
  }
}

function memberToForm(member: TeamMember): MemberForm {
  const bm = member.bonus_model
  return {
    name: member.name,
    role: member.role,
    email: member.email,
    hours_category_enabled: member.hours_category_enabled,
    bonus_enabled: !!bm,
    bonus_filter_field: bm?.filter?.field ?? '',
    bonus_filter_contains: bm?.filter?.contains ?? '',
    bonus_tiers: bm?.tiers ? bm.tiers.map((t) => ({ ...t })) : [],
  }
}

function portalUrl(member: TeamMember): string {
  return `${window.location.origin}/portal?token=${member.portal_token ?? ''}`
}

// ---------------------------------------------------------------------------
// Member Form Body (shared between Add and Edit dialogs)
// ---------------------------------------------------------------------------

type MemberFormBodyProps = {
  form: MemberForm
  onChange: (form: MemberForm) => void
}

function MemberFormBody({ form, onChange }: MemberFormBodyProps) {
  function set<K extends keyof MemberForm>(key: K, value: MemberForm[K]) {
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
    set(
      'bonus_tiers',
      form.bonus_tiers.filter((_, i) => i !== index)
    )
  }

  return (
    <div className="space-y-4 py-2">
      {/* Basic fields */}
      <div className="space-y-1.5">
        <Label htmlFor="tm-name">שם</Label>
        <Input
          id="tm-name"
          value={form.name}
          onChange={(e) => set('name', e.target.value)}
          placeholder="שם מלא"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="tm-role">תפקיד</Label>
        <Input
          id="tm-role"
          value={form.role}
          onChange={(e) => set('role', e.target.value)}
          placeholder="תפקיד"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="tm-email">אימייל</Label>
        <Input
          id="tm-email"
          type="email"
          dir="ltr"
          value={form.email}
          onChange={(e) => set('email', e.target.value)}
          placeholder="example@company.com"
        />
      </div>

      <Separator />

      {/* Hours category toggle */}
      <div className="flex items-center justify-between gap-4">
        <Label htmlFor="tm-hours" className="leading-snug">
          הפעל קטגוריית שעות (BHR/איגוד)
        </Label>
        <Switch
          id="tm-hours"
          checked={form.hours_category_enabled}
          onCheckedChange={(v) => set('hours_category_enabled', v)}
        />
      </div>

      <Separator />

      {/* Bonus model */}
      <div className="flex items-center justify-between gap-4">
        <Label htmlFor="tm-bonus-enabled" className="font-semibold">
          מודל בונוס
        </Label>
        <Switch
          id="tm-bonus-enabled"
          checked={form.bonus_enabled}
          onCheckedChange={(v) => set('bonus_enabled', v)}
        />
      </div>

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
  const { data: members = [], isLoading } = useTable<TeamMember>('team_members')
  const remove = useDelete('team_members')

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingMember, setEditingMember] = useState<TeamMember | null>(null)
  const [form, setForm] = useState<MemberForm>(emptyForm)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle')

  // Delete state
  const [deleteTarget, setDeleteTarget] = useState<TeamMember | null>(null)

  // Per-card copy state: maps member id → boolean (copied)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  // -------------------------------------------------------------------------
  // Dialog handlers
  // -------------------------------------------------------------------------

  function openAddDialog() {
    setEditingMember(null)
    setForm(emptyForm)
    setDialogOpen(true)
  }

  function openEditDialog(member: TeamMember) {
    setEditingMember(member)
    setForm(memberToForm(member))
    setDialogOpen(true)
  }

  function closeDialog() {
    setDialogOpen(false)
    setForm(emptyForm)
    setEditingMember(null)
    setSaveStatus('idle')
  }

  async function handleSave() {
    if (!form.name.trim()) return
    setSaveStatus('saving')

    const payload = formToPayload(form)

    if (editingMember) {
      const { data, error } = await supabase
        .from('team_members')
        .update(payload)
        .eq('id', editingMember.id)
        .select()

      if (error) {
        console.error('Save error:', error)
        setSaveStatus('error')
        return
      }
      console.log('Saved:', data)
    } else {
      const { data, error } = await supabase
        .from('team_members')
        .insert(payload)
        .select()

      if (error) {
        console.error('Save error:', error)
        setSaveStatus('error')
        return
      }
      console.log('Saved:', data)
    }

    setSaveStatus('success')
    queryClient.invalidateQueries({ queryKey: ['team_members'] })
    setTimeout(() => {
      closeDialog()
    }, 2000)
  }

  // -------------------------------------------------------------------------
  // Delete handlers
  // -------------------------------------------------------------------------

  async function handleDelete() {
    if (!deleteTarget) return
    await remove.mutateAsync(deleteTarget.id)
    setDeleteTarget(null)
  }

  // -------------------------------------------------------------------------
  // Copy portal link
  // -------------------------------------------------------------------------

  function copyPortalLink(member: TeamMember) {
    navigator.clipboard.writeText(portalUrl(member))
    setCopiedId(member.id)
    setTimeout(() => setCopiedId((prev) => (prev === member.id ? null : prev)), 2000)
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div dir="rtl" className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">צוות</h1>
        <Button
          onClick={openAddDialog}
          className="flex items-center gap-2 bg-purple-600 hover:bg-purple-700 text-white"
        >
          <Plus className="h-4 w-4" />
          הוסף חבר צוות
        </Button>
      </div>

      {/* Cards grid */}
      {isLoading ? (
        <div className="py-12 text-center text-muted-foreground">טוען...</div>
      ) : members.length === 0 ? (
        <div className="py-12 text-center text-muted-foreground">
          אין חברי צוות עדיין. לחץ "הוסף חבר צוות" להתחלה.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {members.map((member) => (
            <Card key={member.id} className="flex flex-col">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <UserCircle className="h-8 w-8 shrink-0 text-purple-500" />
                    <div className="min-w-0">
                      <CardTitle className="text-lg leading-tight truncate">
                        {member.name}
                      </CardTitle>
                      {member.role && (
                        <Badge
                          variant="secondary"
                          className="mt-1 text-xs font-normal"
                        >
                          {member.role}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      onClick={() => openEditDialog(member)}
                      title="עריכה"
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      onClick={() => setDeleteTarget(member)}
                      title="מחיקה"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="flex flex-col gap-3 pt-0">
                {/* Email */}
                {member.email && (
                  <p className="text-sm text-muted-foreground truncate" dir="ltr">
                    {member.email}
                  </p>
                )}

                {/* Badges row */}
                <div className="flex flex-wrap gap-1.5">
                  {member.hours_category_enabled && (
                    <Badge variant="outline" className="text-xs border-purple-300 text-purple-700">
                      שעות BHR/איגוד
                    </Badge>
                  )}
                  {member.bonus_model && (
                    <Badge variant="outline" className="text-xs border-green-300 text-green-700">
                      בונוס פעיל
                    </Badge>
                  )}
                </div>

                <Separator />

                {/* Portal link */}
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Link className="h-3.5 w-3.5" />
                    <span>קישור לפורטל</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <code
                      className="flex-1 text-xs bg-muted rounded px-2 py-1 truncate"
                      dir="ltr"
                    >
                      {member.portal_token
                        ? portalUrl(member)
                        : '(אין טוקן)'}
                    </code>
                    <Button
                      size="icon"
                      variant="outline"
                      className="h-7 w-7 shrink-0"
                      onClick={() => copyPortalLink(member)}
                      disabled={!member.portal_token}
                      title="העתק קישור"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  {copiedId === member.id && (
                    <p className="text-xs text-green-600 font-medium">הועתק!</p>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Add / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) closeDialog() }}>
        <DialogContent dir="rtl" className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingMember ? `עריכת ${editingMember.name}` : 'הוספת חבר צוות'}
            </DialogTitle>
          </DialogHeader>

          <MemberFormBody form={form} onChange={setForm} />

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
                disabled={saveStatus === 'saving' || saveStatus === 'success' || !form.name.trim()}
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

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}
      >
        <DialogContent dir="rtl" className="max-w-sm">
          <DialogHeader>
            <DialogTitle>מחיקת חבר צוות</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            האם אתה בטוח שברצונך למחוק את{' '}
            <span className="font-semibold text-foreground">{deleteTarget?.name}</span>?
            פעולה זו אינה ניתנת לביטול.
          </p>
          <DialogFooter className="flex gap-2 flex-row-reverse">
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={remove.isPending}
            >
              {remove.isPending ? 'מוחק...' : 'מחק'}
            </Button>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              ביטול
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
