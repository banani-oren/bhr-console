import { useAuth } from '@/lib/auth'
import AdminDashboard from '@/pages/dashboards/AdminDashboard'
import RecruiterDashboard from '@/pages/dashboards/RecruiterDashboard'
import AdministrationDashboard from '@/pages/dashboards/AdministrationDashboard'

export default function Dashboard() {
  const { profile } = useAuth()

  if (!profile) {
    return (
      <div className="p-6" dir="rtl">
        <p className="text-muted-foreground text-sm">טוען...</p>
      </div>
    )
  }

  if (profile.role === 'admin') return <AdminDashboard />
  if (profile.role === 'administration') return <AdministrationDashboard />
  if (profile.role === 'recruiter') return <RecruiterDashboard />

  return null
}
