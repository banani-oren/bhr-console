import { Navigate } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import type { UserRole } from '@/lib/types'
import Layout from '@/components/Layout'

export const DEFAULT_LANDING: Record<UserRole, string> = {
  admin: '/',
  administration: '/transactions',
  recruiter: '/transactions',
}

type Props = {
  allow: UserRole[]
  children: React.ReactNode
}

export default function RequireRole({ allow, children }: Props) {
  const { user, profile, loading } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" dir="rtl">
        <p className="text-muted-foreground">טוען...</p>
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  if (!profile?.password_set) {
    return <Navigate to="/set-password" replace />
  }

  if (!allow.includes(profile.role)) {
    return <Navigate to={DEFAULT_LANDING[profile.role]} replace />
  }

  return <Layout>{children}</Layout>
}
