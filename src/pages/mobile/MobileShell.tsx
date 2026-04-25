import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { Clock, UserCircle, Monitor } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { cn } from '@/lib/utils'

// Batch 5 Phase C: stripped-down mobile shell — only two tabs (שעות,
// פרופיל). Header has a "תצוגת דסקטופ" link that sets the localStorage
// override flag so the auto-redirect in MobileAutoRoute won't bounce
// back to /m on the next navigation.
export default function MobileShell() {
  const { profile, user } = useAuth()
  const navigate = useNavigate()

  const handleDesktopView = () => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('bhr_force_desktop', '1')
    }
    navigate('/')
  }

  return (
    <div dir="rtl" className="min-h-[100dvh] flex flex-col bg-background">
      <header className="px-4 py-3 border-b bg-card flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-purple-600 text-white font-bold text-sm">
            B
          </div>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground truncate">
              {profile?.full_name ?? user?.email}
            </p>
            <p className="text-[10px] tracking-wide text-purple-600">
              {profile?.role === 'admin'
                ? 'מנהל'
                : profile?.role === 'administration'
                ? 'מנהלה'
                : 'רכז/ת גיוס'}
            </p>
          </div>
        </div>
        <button
          onClick={handleDesktopView}
          className="text-xs text-purple-700 hover:text-purple-900 flex items-center gap-1 px-2 py-1 rounded-md hover:bg-purple-50"
          aria-label="תצוגת דסקטופ"
        >
          <Monitor className="h-3.5 w-3.5" />
          <span>תצוגת דסקטופ</span>
        </button>
      </header>

      <main className="flex-1 overflow-y-auto pb-16">
        <Outlet />
      </main>

      <nav className="fixed bottom-0 inset-x-0 h-16 bg-card border-t grid grid-cols-2 text-sm">
        <BottomTab to="/m/hours" icon={<Clock className="h-6 w-6" />} label="שעות" />
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
          'flex flex-col items-center justify-center gap-0.5 active:scale-95 transition-transform',
          isActive ? 'text-purple-600' : 'text-muted-foreground hover:text-foreground',
        )
      }
    >
      {icon}
      <span>{label}</span>
    </NavLink>
  )
}
