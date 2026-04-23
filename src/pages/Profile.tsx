import { useAuth } from '@/lib/auth'
import type { UserRole } from '@/lib/types'
import { Badge } from '@/components/ui/badge'
import ProfileEditor from '@/components/ProfileEditor'

const ROLE_LABELS_HE: Record<UserRole, string> = {
  admin: 'מנהל',
  administration: 'מנהלה',
  recruiter: 'רכז/ת גיוס',
}

export default function Profile() {
  const { user, profile } = useAuth()

  if (!profile || !user) {
    return (
      <div className="p-6" dir="rtl">
        <p className="text-muted-foreground">טוען...</p>
      </div>
    )
  }

  return (
    <div dir="rtl" className="p-6 space-y-6 max-w-2xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">הפרופיל שלי</h1>
        <Badge className="bg-purple-600 hover:bg-purple-700 text-white">
          {ROLE_LABELS_HE[profile.role]}
        </Badge>
      </div>
      <ProfileEditor variant="desktop" />
    </div>
  )
}
