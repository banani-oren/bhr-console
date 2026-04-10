import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Profile } from '@/lib/types'
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
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Plus, Trash2, KeyRound, UserCog } from 'lucide-react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type UserProfile = Profile & { email: string }

type InviteForm = {
  email: string
  full_name: string
  role: 'admin' | 'employee'
}

const emptyInviteForm: InviteForm = {
  email: '',
  full_name: '',
  role: 'employee',
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Data hooks
// ---------------------------------------------------------------------------

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
    mutationFn: async ({ id, role }: { id: string; role: 'admin' | 'employee' }) => {
      const { error } = await supabase.from('profiles').update({ role }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profiles'] })
    },
  })
}

function useDeleteProfile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('profiles').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profiles'] })
    },
  })
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Users() {
  const queryClient = useQueryClient()
  const { data: profiles = [], isLoading } = useProfiles()
  const updateRole = useUpdateRole()
  const deleteProfile = useDeleteProfile()

  // Invite dialog
  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteForm, setInviteForm] = useState<InviteForm>(emptyInviteForm)
  const [isInviting, setIsInviting] = useState(false)
  const [inviteSuccess, setInviteSuccess] = useState(false)
  const [inviteError, setInviteError] = useState<string | null>(null)

  // Delete dialog
  const [deleteTarget, setDeleteTarget] = useState<UserProfile | null>(null)

  // Reset password feedback
  const [resetSentFor, setResetSentFor] = useState<string | null>(null)

  // Role change loading
  const [togglingRoleId, setTogglingRoleId] = useState<string | null>(null)

  // -------------------------------------------------------------------------
  // Invite user
  // -------------------------------------------------------------------------

  function openInviteDialog() {
    setInviteForm(emptyInviteForm)
    setInviteSuccess(false)
    setInviteError(null)
    setInviteOpen(true)
  }

  function closeInviteDialog() {
    setInviteOpen(false)
    setInviteForm(emptyInviteForm)
    setInviteSuccess(false)
    setInviteError(null)
  }

  async function handleInvite() {
    if (!inviteForm.email.trim() || !inviteForm.full_name.trim()) return

    setIsInviting(true)
    setInviteError(null)

    try {
      // Call edge function — uses service role to invite user via Supabase Auth
      const { data, error } = await supabase.functions.invoke('invite-user', {
        body: {
          email: inviteForm.email.trim(),
          full_name: inviteForm.full_name.trim(),
          role: inviteForm.role,
        },
      })

      if (error) throw new Error(error.message)
      if (data?.error) throw new Error(data.error)

      // Auth trigger auto-creates profile row; refresh the list
      queryClient.invalidateQueries({ queryKey: ['profiles'] })
      setInviteSuccess(true)
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'אירעה שגיאה בעת הזמנת המשתמש'
      setInviteError(message)
    } finally {
      setIsInviting(false)
    }
  }

  // -------------------------------------------------------------------------
  // Reset password
  // -------------------------------------------------------------------------

  async function handleResetPassword(email: string) {
    setResetSentFor(null)
    const { error } = await supabase.auth.resetPasswordForEmail(email)
    if (!error) {
      setResetSentFor(email)
      setTimeout(() => setResetSentFor(null), 4000)
    }
  }

  // -------------------------------------------------------------------------
  // Delete user
  // -------------------------------------------------------------------------

  async function handleDelete() {
    if (!deleteTarget) return
    await deleteProfile.mutateAsync(deleteTarget.id)
    setDeleteTarget(null)
  }

  // -------------------------------------------------------------------------
  // Toggle role
  // -------------------------------------------------------------------------

  async function handleToggleRole(user: UserProfile) {
    const newRole: 'admin' | 'employee' =
      user.role === 'admin' ? 'employee' : 'admin'
    setTogglingRoleId(user.id)
    try {
      await updateRole.mutateAsync({ id: user.id, role: newRole })
    } finally {
      setTogglingRoleId(null)
    }
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div dir="rtl" className="p-6 space-y-4">
      {/* Header */}
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

      {/* Users Table */}
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
                <TableHead className="text-right">פעולות</TableHead>
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
                profiles.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell className="font-mono text-sm">
                      {user.email ?? '—'}
                    </TableCell>
                    <TableCell className="font-medium">{user.full_name}</TableCell>
                    <TableCell>
                      {user.role === 'admin' ? (
                        <Badge className="bg-purple-600 hover:bg-purple-700 text-white">
                          מנהל
                        </Badge>
                      ) : (
                        <Badge variant="secondary">עובד</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {/* Toggle role */}
                        <Button
                          size="icon"
                          variant="ghost"
                          title={
                            user.role === 'admin'
                              ? 'שנה לעובד'
                              : 'שנה למנהל'
                          }
                          disabled={togglingRoleId === user.id}
                          onClick={() => handleToggleRole(user)}
                        >
                          <UserCog className="h-4 w-4" />
                        </Button>

                        {/* Reset password */}
                        <Button
                          size="icon"
                          variant="ghost"
                          title="איפוס סיסמה"
                          disabled={!user.email}
                          onClick={() => handleResetPassword(user.email)}
                          className={
                            resetSentFor === user.email
                              ? 'text-green-600'
                              : ''
                          }
                        >
                          <KeyRound className="h-4 w-4" />
                        </Button>

                        {/* Delete */}
                        <Button
                          size="icon"
                          variant="ghost"
                          title="מחק משתמש"
                          onClick={() => setDeleteTarget(user)}
                          className="text-destructive hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        )}
      </Card>

      {/* ------------------------------------------------------------------ */}
      {/* Invite User Dialog                                                   */}
      {/* ------------------------------------------------------------------ */}
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

          {/* Show success after invite */}
          {inviteSuccess ? (
            <div className="space-y-4 py-2">
              <div className="rounded-lg bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 p-4 space-y-2">
                <p className="text-sm font-semibold text-green-800 dark:text-green-300">
                  ההזמנה נשלחה בהצלחה ✓
                </p>
                <p className="text-sm text-green-700 dark:text-green-400">
                  נשלח אימייל הזמנה ל-{inviteForm.email}. המשתמש יוכל להגדיר סיסמה דרך הקישור באימייל.
                </p>
              </div>

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
                  onChange={(e) =>
                    setInviteForm((f) => ({ ...f, email: e.target.value }))
                  }
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="invite-name">שם מלא</Label>
                <Input
                  id="invite-name"
                  placeholder="ישראל ישראלי"
                  value={inviteForm.full_name}
                  onChange={(e) =>
                    setInviteForm((f) => ({ ...f, full_name: e.target.value }))
                  }
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="invite-role">תפקיד</Label>
                <Select
                  value={inviteForm.role}
                  onValueChange={(val) =>
                    setInviteForm((f) => ({
                      ...f,
                      role: val as 'admin' | 'employee',
                    }))
                  }
                >
                  <SelectTrigger id="invite-role">
                    <SelectValue placeholder="בחר תפקיד" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="employee">עובד</SelectItem>
                    <SelectItem value="admin">מנהל</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {inviteError && (
                <p className="text-sm text-destructive">{inviteError}</p>
              )}

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
                <Button variant="outline" onClick={closeInviteDialog}>
                  ביטול
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ------------------------------------------------------------------ */}
      {/* Delete Confirmation Dialog                                           */}
      {/* ------------------------------------------------------------------ */}
      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
      >
        <DialogContent dir="rtl" className="max-w-sm">
          <DialogHeader>
            <DialogTitle>מחיקת משתמש</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            האם אתה בטוח שברצונך למחוק את המשתמש{' '}
            <span className="font-semibold text-foreground">
              {deleteTarget?.full_name}
            </span>
            ?{' '}
            <br />
            הפרופיל יימחק, אך חשבון האימות ישאר פעיל ויש למחקו דרך לוח הניהול
            של Supabase.
          </p>
          <DialogFooter className="flex gap-2 flex-row-reverse">
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteProfile.isPending}
            >
              {deleteProfile.isPending ? 'מוחק...' : 'מחק'}
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
