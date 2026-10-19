import { useState } from 'react'
import { useAuth } from '@/lib/auth'
import AdminDashboard from '@/pages/dashboards/AdminDashboard'
import RecruiterDashboard from '@/pages/dashboards/RecruiterDashboard'
import AdministrationDashboard from '@/pages/dashboards/AdministrationDashboard'

// Admins see a two-pill toggle at the top of / (manager, collections=administration view).
// Non-admins see only their scoped dashboard. (Repair 34: the "דשבורד עובד" recruiter preview was removed.)
type AdminView = 'manager' | 'collections'

export default function Dashboard() {
  const { profile } = useAuth()
  const [view, setView] = useState<AdminView>('manager')

  if (!profile) {
    return (
      <div className="p-6" dir="rtl">
        <p className="text-muted-foreground text-sm">טוען...</p>
      </div>
    )
  }

  if (profile.role === 'administration') return <AdministrationDashboard />
  if (profile.role === 'recruiter') return <RecruiterDashboard />

  if (profile.role !== 'admin') return null

  return (
    <div dir="rtl">
      <div className="px-6 pt-6">
        <div className="inline-flex rounded-lg border border-purple-200 bg-white p-0.5 text-sm">
          <button
            type="button"
            onClick={() => setView('manager')}
            className={`px-4 py-1.5 rounded-md ${
              view === 'manager' ? 'bg-purple-600 text-white' : 'text-purple-700 hover:bg-purple-50'
            }`}
          >
            דשבורד מנהל
          </button>
          <button
            type="button"
            onClick={() => setView('collections')}
            className={`px-4 py-1.5 rounded-md ${
              view === 'collections' ? 'bg-purple-600 text-white' : 'text-purple-700 hover:bg-purple-50'
            }`}
          >
            דשבורד גבייה
          </button>
        </div>
      </div>
      {view === 'manager' && <AdminDashboard />}
      {view === 'collections' && <AdministrationDashboard />}
    </div>
  )
}
