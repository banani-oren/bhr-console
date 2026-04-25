import { useEffect, useState } from 'react'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { useSafeMutation } from '@/hooks/useSafeMutation'
import type { Profile, UserRole } from '@/lib/types'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'

const ROLE_LABELS_HE: Record<UserRole, string> = {
  admin: 'מנהל',
  administration: 'מנהלה',
  recruiter: 'רכז/ת גיוס',
}

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  user: Profile | null
  /** Query keys that must be invalidated after a successful save. */
  invalidate?: Array<string | unknown[]>
}

export default function UserEditDialog({ open, onOpenChange, user, invalidate = [] }: Props) {
  const { user: authUser } = useAuth()
  const isSelf = !!user && !!authUser && user.id === authUser.id

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<UserRole>('recruiter')

  useEffect(() => {
    if (!open || !user) return
    setName(user.full_name ?? '')
    setEmail(user.email ?? '')
    setRole(user.role)
  }, [open, user])

  const mut = useSafeMutation<
    { user_id: string; full_name?: string; email?: string; role?: UserRole },
    void
  >({
    mutationFn: async (args) => {
      // Get the caller's JWT for the edge function.
      const { data: sess } = await supabase.auth.getSession()
      const token = sess.session?.access_token
      if (!token) throw new Error('not authenticated')
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-update-user`
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(args),
      })
      const txt = await res.text()
      if (!res.ok) {
        let parsed: { error?: string } = {}
        try { parsed = JSON.parse(txt) } catch { /* ignore */ }
        throw new Error(parsed.error || `HTTP ${res.status}`)
      }
    },
    invalidate: [['profiles'], ['team-employees'], ['all-employees-for-bonuses'], ['profiles-with-bonus'], ...invalidate],
    successHoldMs: 1500,
    onSuccess: () => {
      setTimeout(() => onOpenChange(false), 1500)
    },
  })

  if (!user) return null

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !email.trim()) return
    const args: { user_id: string; full_name?: string; email?: string; role?: UserRole } = {
      user_id: user.id,
    }
    if (name.trim() !== user.full_name) args.full_name = name.trim()
    if (email.trim().toLowerCase() !== (user.email ?? '').toLowerCase()) args.email = email.trim().toLowerCase()
    // Only send role if changed AND not self.
    if (!isSelf && role !== user.role) args.role = role
    if (Object.keys(args).length === 1) {
      // Nothing to do.
      onOpenChange(false)
      return
    }
    void mut.mutate(args)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-md">
        <DialogHeader>
          <DialogTitle>עריכת פרטי משתמש</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSave} className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="ued-name">שם מלא</Label>
            <Input
              id="ued-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ued-email">אימייל</Label>
            <Input
              id="ued-email"
              type="email"
              dir="ltr"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <p className="text-[11px] text-muted-foreground">
              שינוי המייל ע"י מנהל מתבצע מיידית — בלי אימות.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label>תפקיד</Label>
            <Select
              value={role}
              onValueChange={(v) => v && setRole(v as UserRole)}
              disabled={isSelf}
            >
              <SelectTrigger>
                <SelectValue>{ROLE_LABELS_HE[role]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {(['admin', 'administration', 'recruiter'] as UserRole[]).map((r) => (
                  <SelectItem key={r} value={r}>{ROLE_LABELS_HE[r]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {isSelf && (
              <p className="text-[11px] text-muted-foreground">
                לא ניתן לשנות את התפקיד של החשבון שלך.
              </p>
            )}
          </div>
          {mut.saveStatus === 'success' && (
            <p className="text-green-600 text-sm">המידע נשמר ✓</p>
          )}
          {mut.saveStatus === 'error' && (
            <p className="text-red-600 text-sm">{mut.errorMessage ?? 'שגיאה בשמירה'}</p>
          )}
          {mut.saveStatus === 'timeout' && (
            <p className="text-red-600 text-sm">פג זמן השמירה. נסה שנית.</p>
          )}
          <DialogFooter className="flex gap-2 flex-row-reverse">
            <Button
              type="submit"
              disabled={mut.saveStatus === 'saving' || !name.trim() || !email.trim()}
              className="bg-purple-600 hover:bg-purple-700 text-white"
            >
              {mut.saveStatus === 'saving' ? 'שומר...' : 'שמור'}
            </Button>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              ביטול
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
