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
  // Batch 4.1 mobile fix: the /m/* mobile routes bring their own shell
  // (MobileShell). Passing withLayout={false} tells RequireRole to skip
  // wrapping the children in the desktop Layout so the two shells can't
  // render simultaneously (the "double sidebar" bug).
  withLayout?: boolean
}

export default function RequireRole({ allow, children, withLayout = true }: Props) {
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

  return withLayout ? <Layout>{children}</Layout> : <>{children}</>
}
