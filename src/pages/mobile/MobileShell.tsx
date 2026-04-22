import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { Clock, Receipt, UserCircle, LogOut } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { cn } from '@/lib/utils'

// Batch 4 Phase D2: mobile-optimized shell with a bottom-tab nav. Used at
// /m/* routes. Admins can preview it from the desktop sidebar; non-admins
// are auto-redirected here on narrow viewports.
export default function MobileShell() {
  const { profile, user, signOut } = useAuth()
  const navigate = useNavigate()

  const handleSignOut = async () => {
    await signOut()
    navigate('/login')
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
          onClick={handleSignOut}
          className="text-muted-foreground hover:text-destructive p-2 rounded-md"
          aria-label="יציאה"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </header>

      <main className="flex-1 overflow-y-auto pb-16">
        <Outlet />
      </main>

      <nav className="fixed bottom-0 inset-x-0 h-14 bg-card border-t grid grid-cols-3 text-[11px]">
        <BottomTab to="/m/hours" icon={<Clock className="h-5 w-5" />} label="שעות" />
        <BottomTab to="/m/transactions" icon={<Receipt className="h-5 w-5" />} label="משרות" />
        <BottomTab to="/m/profile" icon={<UserCircle className="h-5 w-5" />} label="פרופיל" />
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
          'flex flex-col items-center justify-center gap-0.5',
          isActive ? 'text-purple-600' : 'text-muted-foreground hover:text-foreground',
        )
      }
    >
      {icon}
      <span>{label}</span>
    </NavLink>
  )
}
