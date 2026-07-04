import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import type { Profile, UserRole } from '@/lib/types'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Plus, Trash2, KeyRound, Pencil } from 'lucide-react'
import UserEditDialog from '@/components/UserEditDialog'
import { useSaveWatchdog } from '@/hooks/useSaveWatchdog'

const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'מנהל',
  administration: 'מנהלה',
  recruiter: 'רכז/ת גיוס',
}

const ROLE_ORDER: UserRole[] = ['admin', 'administration', 'recruiter']

type UserProfile = Profile & { email: string }

type InviteForm = {
  email: string
  full_name: string
  role: UserRole
}

const emptyInviteForm: InviteForm = {
  email: '',
  full_name: '',
  role: 'recruiter',
}

function useProfiles() {
  return useQuery<UserProfile[]>({
    queryKey: ['profiles'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .order('full_name', { ascending: true })
      if (error) throw error
      return (data ?? []) as UserProfile[]
    },
  })
}

function useUpdateRole() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, role }: { id: string; role: UserRole }) => {
      // 10s abort so a hung role change can't leave the select stuck disabled.
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(new DOMException('timeout', 'AbortError')), 10000)
      try {
        const { error } = await supabase.from('profiles').update({ role }).eq('id', id).abortSignal(controller.signal)
        if (error) throw error
      } finally {
        clearTimeout(timer)
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profiles'] })
    },
  })
}

export default function Users() {
  const queryClient = useQueryClient()
  const { user: authUser, profile } = useAuth()
  const { data: profiles = [], isLoading } = useProfiles()
  const updateRole = useUpdateRole()

  // Impersonation ("התחבר בתור")
  const [impersonatingId, setImpersonatingId] = useState<string | null>(null)

  const handleImpersonate = async (targetUser: UserProfile) => {
    setImpersonatingId(targetUser.id)
    // 10s abort so a hung edge-function call can't leave the button stuck forever.
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new DOMException('timeout', 'AbortError')), 10000)
    try {
      const { data, error } = await supabase.functions.invoke('impersonate-user', {
        body: { target_user_id: targetUser.id },
        signal: controller.signal,
      })
      if (error) throw error
      if (data?.error) throw new Error(data.error)
      if (!data?.url) throw new Error('לא התקבל קישור')
      window.open(data.url, '_blank', 'noopener')
    } catch (err) {
      const isTimeout = err instanceof DOMException && err.name === 'AbortError'
      const msg = isTimeout ? 'פג זמן — בדוק חיבור לאינטרנט ונסה שנית' : (err instanceof Error ? err.message : 'שגיאה')
      alert(`שגיאה בהתחברות בתור ${targetUser.full_name}: ${msg}`)
    } finally {
      clearTimeout(timer)
      setImpersonatingId(null)
    }
  }

  // Invite dialog
  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteForm, setInviteForm] = useState<InviteForm>(emptyInviteForm)
  const [isInviting, setIsInviting] = useState(false)
  const [inviteSuccess, setInviteSuccess] = useState(false)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [inviteWarning, setInviteWarning] = useState<string | null>(null)

  // Delete dialog
  const [deleteTarget, setDeleteTarget] = useState<UserProfile | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  // Reset-password transient
  const [resetStatus, setResetStatus] = useState<{ email: string; ok: boolean; errorMsg?: string } | null>(null)
  const [resetLoading, setResetLoading] = useState<string | null>(null)

  // Role-change transient
  const [togglingRoleId, setTogglingRoleId] = useState<string | null>(null)

  // Edit dialog
  const [editTarget, setEditTarget] = useState<UserProfile | null>(null)

  // Last-resort safety net: these four flows call functions.invoke/auth.* directly
  // (not useSafeMutation), so a last-resort watchdog backs up their own 10s timeouts.
  useSaveWatchdog(isInviting, () => { setIsInviting(false); setInviteError('השמירה לא הושלמה — פג זמן. בדוק חיבור לאינטרנט ונסה שנית.') })
  useSaveWatchdog(isDeleting, () => { setIsDeleting(false); setDeleteError('השמירה לא הושלמה — פג זמן. בדוק חיבור לאינטרנט ונסה שנית.') })
  useSaveWatchdog(resetLoading !== null, () => setResetLoading(null))
  useSaveWatchdog(impersonatingId !== null, () => setImpersonatingId(null))

  function openInviteDialog() {
    setInviteForm(emptyInviteForm)
    setInviteSuccess(false)
    setInviteError(null)
    setInviteWarning(null)
    setInviteOpen(true)
  }

  function closeInviteDialog() {
    setInviteOpen(false)
    setInviteForm(emptyInviteForm)
    setInviteSuccess(false)
    setInviteError(null)
    setInviteWarning(null)
  }

  async function handleInvite() {
    if (!inviteForm.email.trim() || !inviteForm.full_name.trim()) return
    setIsInviting(true)
    setInviteError(null)
    // 10s abort so a hung edge-function call can't leave the button stuck forever.
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new DOMException('timeout', 'AbortError')), 10000)
    try {
      const { data, error } = await supabase.functions.invoke('invite-user', {
        body: {
          email: inviteForm.email.trim(),
          full_name: inviteForm.full_name.trim(),
          role: inviteForm.role,
        },
        signal: controller.signal,
      })
      if (error) throw new Error(error.message)
      if (data?.error) throw new Error(data.error)
      queryClient.invalidateQueries({ queryKey: ['profiles'] })
      setInviteSuccess(true)
      if (data?.email_warning) {
        setInviteWarning(
          `המשתמש נוצר, אך שליחת האימייל נכשלה (${data.email_warning}).`,
        )
      }
    } catch (err: unknown) {
      const isTimeout = err instanceof DOMException && err.name === 'AbortError'
      const message = isTimeout
        ? 'השמירה לא הושלמה — פג זמן. בדוק חיבור לאינטרנט ונסה שנית.'
        : (err instanceof Error ? err.message : 'אירעה שגיאה בעת הזמנת המשתמש')
      setInviteError(message)
    } finally {
      clearTimeout(timer)
      setIsInviting(false)
    }
  }

  async function handleResetPassword(email: string) {
    setResetStatus(null)
    setResetLoading(email)
    // resetPasswordForEmail takes no abort signal, so race it against a 10s
    // timer instead — a hung request otherwise leaves the button stuck forever.
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new DOMException('timeout', 'AbortError')), 10000)
    try {
      const { error } = await Promise.race([
        supabase.auth.resetPasswordForEmail(email, {
          // Direct the user to /set-password so the recovery session is handled
          // correctly (the page reads the #type=recovery hash before it's stripped).
          redirectTo: `${window.location.origin}/set-password`,
        }),
        new Promise<never>((_, reject) => {
          if (controller.signal.aborted) { reject(new DOMException('timeout', 'AbortError')); return }
          controller.signal.addEventListener('abort', () => reject(new DOMException('timeout', 'AbortError')), { once: true })
        }),
      ])
      if (error) {
        setResetStatus({ email, ok: false, errorMsg: error.message })
      } else {
        setResetStatus({ email, ok: true })
      }
    } catch (err) {
      const isTimeout = err instanceof DOMException && err.name === 'AbortError'
      const msg = isTimeout ? 'פג זמן — בדוק חיבור לאינטרנט ונסה שנית' : (err instanceof Error ? err.message : 'שגיאה לא ידועה')
      setResetStatus({ email, ok: false, errorMsg: msg })
    } finally {
      clearTimeout(timer)
      setResetLoading(null)
      setTimeout(() => setResetStatus(null), 6000)
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setIsDeleting(true)
    setDeleteError(null)
    // 10s abort so a hung edge-function call can't leave the button stuck forever.
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new DOMException('timeout', 'AbortError')), 10000)
    try {
      const { data, error } = await supabase.functions.invoke('delete-user', {
        body: { user_id: deleteTarget.id },
        signal: controller.signal,
      })
      if (error) throw new Error(error.message)
      if (data?.error) throw new Error(data.error)
      queryClient.invalidateQueries({ queryKey: ['profiles'] })
      setDeleteTarget(null)
    } catch (err) {
      console.error('Delete user error:', err)
      const isTimeout = err instanceof DOMException && err.name === 'AbortError'
      const message = isTimeout
        ? 'השמירה לא הושלמה — פג זמן. בדוק חיבור לאינטרנט ונסה שנית.'
        : (err instanceof Error ? err.message : 'שגיאה במחיקת המשתמש')
      setDeleteError(message)
    } finally {
      clearTimeout(timer)
      setIsDeleting(false)
    }
  }

  async function handleChangeRole(userProfile: UserProfile, newRole: UserRole) {
    if (newRole === userProfile.role) return
    setTogglingRoleId(userProfile.id)
    try {
      await updateRole.mutateAsync({ id: userProfile.id, role: newRole })
    } finally {
      setTogglingRoleId(null)
    }
  }

  return (
    <div dir="rtl" className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">ניהול משתמשים</h1>
        <Button
          onClick={openInviteDialog}
          className="flex items-center gap-2 bg-purple-600 hover:bg-purple-700 text-white"
        >
          <Plus className="h-4 w-4" />
          הזמן משתמש
        </Button>
      </div>

      <Card>
        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground">טוען...</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-right">אימייל</TableHead>
                <TableHead className="text-right">שם</TableHead>
                <TableHead className="text-right">תפקיד</TableHead>
                <TableHead className="text-right w-32"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {profiles.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={4}
                    className="text-center text-muted-foreground py-8"
                  >
                    לא נמצאו משתמשים
                  </TableCell>
                </TableRow>
              ) : (
                profiles.map((row) => {
                  const isSelf = authUser?.id === row.id
                  return (
                    <TableRow key={row.id}>
                      <TableCell className="font-mono text-sm">
                        {row.email ?? '—'}
                      </TableCell>
                      <TableCell className="font-medium">{row.full_name}</TableCell>
                      <TableCell>
                        <Select
                          value={row.role}
                          disabled={isSelf || togglingRoleId === row.id}
                          onValueChange={(val) => handleChangeRole(row, val as UserRole)}
                        >
                          <SelectTrigger className="h-8 w-32 text-xs">
                            <SelectValue>
                              {(value: unknown) =>
                                ROLE_LABELS[value as UserRole] ?? String(value ?? '')
                              }
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            {ROLE_ORDER.map((r) => (
                              <SelectItem key={r} value={r}>
                                {ROLE_LABELS[r]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          {profile?.role === 'admin' && !isSelf && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-purple-700 border-purple-300 hover:bg-purple-50 text-xs h-7 px-2"
                              disabled={impersonatingId === row.id}
                              onClick={(e) => {
                                e.stopPropagation()
                                void handleImpersonate(row)
                              }}
                              title={`התחבר בתור ${row.full_name}`}
                            >
                              {impersonatingId === row.id ? '...' : 'התחבר בתור'}
                            </Button>
                          )}
                          <Button
                            size="icon"
                            variant="ghost"
                            title="ערוך פרטי משתמש"
                            onClick={() => setEditTarget(row)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            title={
                              resetStatus?.email === row.email && !resetStatus.ok
                                ? (resetStatus.errorMsg ?? 'שגיאה בשליחת האימייל')
                                : 'שלח איפוס סיסמה'
                            }
                            disabled={!row.email || resetLoading === row.email}
                            onClick={() => handleResetPassword(row.email)}
                            className={
                              resetStatus?.email === row.email
                                ? resetStatus.ok
                                  ? 'text-green-600'
                                  : 'text-destructive'
                                : ''
                            }
                          >
                            <KeyRound className="h-4 w-4" />
                          </Button>
                          {resetStatus?.email === row.email && !resetStatus.ok && (
                            <span className="text-[11px] text-destructive max-w-[120px] leading-tight">
                              {resetStatus.errorMsg ?? 'שגיאה'}
                            </span>
                          )}
                          <Button
                            size="icon"
                            variant="ghost"
                            title={isSelf ? 'לא ניתן למחוק את עצמך' : 'מחק משתמש'}
                            disabled={isSelf}
                            onClick={() => {
                              setDeleteError(null)
                              setDeleteTarget(row)
                            }}
                            className="text-destructive hover:text-destructive disabled:text-muted-foreground"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        )}
      </Card>

      <Dialog
        open={inviteOpen}
        onOpenChange={(open) => {
          if (!open) closeInviteDialog()
        }}
      >
        <DialogContent dir="rtl" className="max-w-md">
          <DialogHeader>
            <DialogTitle>הזמנת משתמש חדש</DialogTitle>
          </DialogHeader>
          {inviteSuccess ? (
            <div className="space-y-4 py-2">
              <div className="rounded-lg bg-green-50 border border-green-200 p-4 space-y-2">
                <p className="text-sm font-semibold text-green-800">המשתמש נוצר בהצלחה ✓</p>
                <p className="text-sm text-green-700">
                  {inviteWarning
                    ? `המשתמש ${inviteForm.email} נוצר במערכת.`
                    : `נשלח אימייל הזמנה ל-${inviteForm.email}.`}
                </p>
              </div>
              {inviteWarning && (
                <div className="rounded-lg bg-amber-50 border border-amber-200 p-4">
                  <p className="text-sm text-amber-800">{inviteWarning}</p>
                </div>
              )}
              <DialogFooter className="flex gap-2 flex-row-reverse">
                <Button
                  onClick={closeInviteDialog}
                  className="bg-purple-600 hover:bg-purple-700 text-white"
                >
                  סגור
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label htmlFor="invite-email">אימייל</Label>
                <Input
                  id="invite-email"
                  type="email"
                  dir="ltr"
                  placeholder="user@example.com"
                  value={inviteForm.email}
                  onChange={(e) => setInviteForm((f) => ({ ...f, email: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="invite-name">שם מלא</Label>
                <Input
                  id="invite-name"
                  placeholder="ישראל ישראלי"
                  value={inviteForm.full_name}
                  onChange={(e) => setInviteForm((f) => ({ ...f, full_name: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="invite-role">תפקיד</Label>
                <Select
                  value={inviteForm.role}
                  onValueChange={(val) =>
                    setInviteForm((f) => ({ ...f, role: val as UserRole }))
                  }
                >
                  <SelectTrigger id="invite-role">
                    <SelectValue placeholder="בחר תפקיד">
                      {(value: unknown) =>
                        ROLE_LABELS[value as UserRole] ?? String(value ?? '')
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {ROLE_ORDER.map((r) => (
                      <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {inviteError && <p className="text-sm text-destructive">{inviteError}</p>}
              <DialogFooter className="flex gap-2 flex-row-reverse">
                <Button
                  onClick={handleInvite}
                  disabled={
                    isInviting ||
                    !inviteForm.email.trim() ||
                    !inviteForm.full_name.trim()
                  }
                  className="bg-purple-600 hover:bg-purple-700 text-white"
                >
                  {isInviting ? 'יוצר משתמש...' : 'צור משתמש'}
                </Button>
                <Button variant="outline" onClick={closeInviteDialog}>ביטול</Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null)
            setDeleteError(null)
          }
        }}
      >
        <DialogContent dir="rtl" className="max-w-sm">
          <DialogHeader>
            <DialogTitle>מחיקת משתמש</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            האם אתה בטוח שברצונך למחוק את המשתמש{' '}
            <span className="font-semibold text-foreground">{deleteTarget?.full_name}</span>?
            <br />
            הפעולה מוחקת גם את חשבון האימות ואינה ניתנת לביטול.
          </p>
          {deleteError && <p className="text-sm text-destructive mt-2">{deleteError}</p>}
          <DialogFooter className="flex gap-2 flex-row-reverse">
            <Button variant="destructive" onClick={handleDelete} disabled={isDeleting}>
              {isDeleting ? 'מוחק...' : 'מחק'}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setDeleteTarget(null)
                setDeleteError(null)
              }}
            >
              ביטול
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Phase A — shared admin edit dialog (name + email + role). */}
      <UserEditDialog
        open={!!editTarget}
        onOpenChange={(open) => { if (!open) setEditTarget(null) }}
        user={editTarget}
      />
    </div>
  )
}
