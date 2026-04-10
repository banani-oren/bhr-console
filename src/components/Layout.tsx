import { NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard,
  Users,
  FileText,
  Receipt,
  Clock,
  UserCog,
  Shield,
  LogOut,
} from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { cn } from '@/lib/utils'

interface NavItem {
  label: string
  to: string
  icon: React.ReactNode
}

const NAV_ITEMS: NavItem[] = [
  { label: 'דשבורד', to: '/', icon: <LayoutDashboard size={18} /> },
  { label: 'לקוחות', to: '/clients', icon: <Users size={18} /> },
  { label: 'הסכמים', to: '/agreements', icon: <FileText size={18} /> },
  { label: 'עסקאות', to: '/transactions', icon: <Receipt size={18} /> },
  { label: 'יומן שעות', to: '/hours', icon: <Clock size={18} /> },
  { label: 'צוות', to: '/team', icon: <UserCog size={18} /> },
  { label: 'ניהול משתמשים', to: '/users', icon: <Shield size={18} /> },
]

interface LayoutProps {
  children: React.ReactNode
}

export default function Layout({ children }: LayoutProps) {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()

  const handleSignOut = async () => {
    await signOut()
    navigate('/login')
  }

  return (
    <div className="flex flex-row-reverse min-h-screen bg-background" dir="rtl">
      {/* Sidebar — rendered on the right in RTL */}
      <aside className="w-64 flex flex-col bg-sidebar text-sidebar-foreground shrink-0">
        {/* Logo / App title */}
        <div className="flex items-center gap-2 px-5 py-5 border-b border-sidebar-border">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-sidebar-primary text-sidebar-primary-foreground font-bold text-sm select-none">
            B
          </div>
          <span className="text-lg font-bold tracking-wide text-sidebar-foreground">
            BHR Console
          </span>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                    : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'
                )
              }
            >
              <span className="shrink-0 text-sidebar-primary">{item.icon}</span>
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        {/* User info + sign out */}
        <div className="border-t border-sidebar-border px-4 py-4">
          {user && (
            <div className="flex items-center gap-3 mb-3">
              {/* Avatar placeholder */}
              <div className="flex items-center justify-center w-8 h-8 rounded-full bg-sidebar-primary text-sidebar-primary-foreground text-xs font-semibold shrink-0 select-none">
                {(user.email ?? '?').charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-sidebar-foreground truncate">
                  {user.email}
                </p>
              </div>
            </div>
          )}

          <button
            onClick={handleSignOut}
            className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-sm text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground transition-colors"
          >
            <LogOut size={16} />
            <span>יציאה</span>
          </button>
        </div>
      </aside>

      {/* Main content area */}
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  )
}
