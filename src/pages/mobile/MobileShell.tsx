import { NavLink, Outlet } from 'react-router-dom'
import { Clock, CalendarCheck, UserCircle } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { cn } from '@/lib/utils'

// Batch 8 Phase 1: the mobile lock has no desktop opt-out (see
// MobileAutoRoute + RequireRole), so the "תצוגת דסקטופ" escape-hatch button
// that used to live in this header was removed — it would no longer do
// anything (any navigation to a desktop route bounces straight back to /m).
export default function MobileShell() {
  const { profile, user } = useAuth()

  return (
    <div dir="rtl" className="min-h-[100dvh] flex flex-col bg-gray-50">
      <header className="px-4 py-3 bg-purple-950 text-white flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-white/15 text-white font-bold text-sm">
            B
          </div>
          <div className="min-w-0">
            <p className="text-xs text-purple-100 truncate">
              {profile?.full_name ?? user?.email}
            </p>
            <p className="text-[10px] tracking-wide text-purple-300">
              {profile?.role === 'admin'
                ? 'מנהל'
                : profile?.role === 'administration'
                ? 'מנהלה'
                : 'רכז/ת גיוס'}
            </p>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto pb-16">
        <Outlet />
      </main>

      <nav className="fixed bottom-0 inset-x-0 bg-white border-t grid grid-cols-3 text-sm pb-[env(safe-area-inset-bottom)]">
        <BottomTab to="/m/hours" icon={<Clock className="h-6 w-6" />} label="שעות" />
        <BottomTab to="/m/attendance" icon={<CalendarCheck className="h-6 w-6" />} label="נוכחות" />
        <BottomTab to="/m/profile" icon={<UserCircle className="h-6 w-6" />} label="פרופיל" />
      </nav>
    </div>
  )
}

function BottomTab({ to, icon, label }: { to: string; icon: React.ReactNode; label: string }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          'flex flex-col items-center justify-center gap-0.5 min-h-[56px] active:scale-95 transition-transform border-t-2',
          isActive ? 'text-purple-700 border-purple-700' : 'text-muted-foreground border-transparent hover:text-foreground',
        )
      }
    >
      {icon}
      <span>{label}</span>
    </NavLink>
  )
}
