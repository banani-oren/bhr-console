import { NavLink, useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import {
  LayoutDashboard,
  Users,
  Receipt,
  Clock,
  UserCog,
  Shield,
  Briefcase,
  FileText,
  Trophy,
  LogOut,
  Download,
  Smartphone,
  Handshake,
} from 'lucide-react'
import { useAuth } from '@/lib/auth'
import type { UserRole } from '@/lib/types'
import { cn } from '@/lib/utils'

// Captured by the beforeinstallprompt listener so the sidebar can call prompt()
// at a user-initiated moment (Chrome / Edge on desktop + Android only).
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const ROLE_LABELS_HE: Record<UserRole, string> = {
  admin: 'מנהל',
  administration: 'מנהלה',
  recruiter: 'רכז/ת גיוס',
}

interface NavItem {
  label: string
  to: string
  icon: React.ReactNode
  allow: UserRole[]
}

const NAV_ITEMS: NavItem[] = [
  { label: 'דשבורד',        to: '/',             icon: <LayoutDashboard size={18} />, allow: ['admin', 'administration', 'recruiter'] },
  { label: 'לקוחות',        to: '/clients',      icon: <Users size={18} />,           allow: ['admin', 'administration'] },
  { label: 'עסקאות',        to: '/transactions', icon: <Receipt size={18} />,         allow: ['admin', 'administration', 'recruiter'] },
  { label: 'יומן שעות',     to: '/hours',        icon: <Clock size={18} />,           allow: ['admin', 'administration', 'recruiter'] },
  { label: 'דוחות חיוב',    to: '/billing-reports', icon: <FileText size={18} />,     allow: ['admin', 'administration'] },
  { label: 'בונוסים',       to: '/bonuses',      icon: <Trophy size={18} />,          allow: ['admin'] },
  { label: 'צוות',          to: '/team',         icon: <UserCog size={18} />,         allow: ['admin'] },
  { label: 'שירותים',       to: '/services',     icon: <Briefcase size={18} />,       allow: ['admin'] },
  { label: 'ספקים',         to: '/suppliers',    icon: <Handshake size={18} />,       allow: ['admin'] },
  { label: 'ניהול משתמשים', to: '/users',        icon: <Shield size={18} />,          allow: ['admin'] },
]

interface LayoutProps {
  children: React.ReactNode
}

export default function Layout({ children }: LayoutProps) {
  const { user, profile, signOut } = useAuth()
  const navigate = useNavigate()
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [isStandalone, setIsStandalone] = useState(false)

  const visibleItems = profile
    ? NAV_ITEMS.filter((item) => item.allow.includes(profile.role))
    : []

  useEffect(() => {
    if (typeof window === 'undefined') return
    setIsStandalone(
      window.matchMedia?.('(display-mode: standalone)').matches ||
        // @ts-expect-error legacy iOS navigator.standalone
        !!window.navigator?.standalone,
    )
    const handler = (e: Event) => {
      e.preventDefault()
      setInstallPrompt(e as BeforeInstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  const handleInstall = async () => {
    if (!installPrompt) return
    await installPrompt.prompt()
    const choice = await installPrompt.userChoice
    if (choice.outcome === 'accepted') setInstallPrompt(null)
  }

  const handleSignOut = async () => {
    await signOut()
    navigate('/login')
  }

  return (
    <div className="flex min-h-screen bg-background">
      {/* Sidebar — rendered on the right in RTL */}
      <aside className="admin-sidebar w-64 h-screen flex flex-col bg-sidebar text-sidebar-foreground shrink-0 sticky top-0">
        {/* Logo / App title */}
        <div className="flex items-center gap-2 px-5 py-5 border-b border-sidebar-border">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-sidebar-primary text-sidebar-primary-foreground font-bold text-sm select-none">
            B
          </div>
          <span className="text-lg font-bold tracking-wide text-sidebar-foreground">
            BHR Console
          </span>
        </div>

        {/* Navigation — min-h-0 lets the overflow-y-auto kick in inside a
            flex column parent so the footer stays anchored at the bottom. */}
        <nav className="flex-1 min-h-0 px-3 py-4 space-y-1 overflow-y-auto">
          {visibleItems.map((item) => (
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

        {/* Phase E: profile + actions footer. mt-auto + shrink-0 anchors
            it to the bottom; data-testid for the QA assertion. */}
        <div
          className="sidebar-footer mt-auto shrink-0 border-t border-sidebar-border px-4 py-4"
          data-testid="sidebar-footer"
        >
          <button
            type="button"
            onClick={() => navigate('/profile')}
            className="w-full flex items-center gap-3 mb-3 text-right rounded-lg px-2 py-1.5 -mx-2 hover:bg-sidebar-accent/50 transition-colors"
            title="הפרופיל שלי"
          >
            <div className="flex items-center justify-center w-8 h-8 rounded-full bg-sidebar-primary text-sidebar-primary-foreground text-xs font-semibold shrink-0 select-none">
              {(((profile?.full_name?.trim() || user?.email) ?? '?')).charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-sidebar-foreground truncate">
                {profile?.full_name?.trim() || user?.email || 'אורח'}
              </p>
              {profile?.role && (
                <p className="text-[10px] tracking-wider text-sidebar-foreground/60">
                  {ROLE_LABELS_HE[profile.role]}
                </p>
              )}
            </div>
          </button>

          {installPrompt && !isStandalone && (
            <button
              onClick={handleInstall}
              className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-sm text-purple-300 hover:bg-sidebar-accent/50 transition-colors mb-1"
            >
              <Download size={16} />
              <span>התקן BHR Console</span>
            </button>
          )}
          <button
            onClick={() => {
              if (typeof window !== 'undefined') {
                window.localStorage.setItem('bhr_force_desktop', '0')
              }
              navigate('/m/hours')
            }}
            className="flex items-center justify-center gap-2 w-full px-3 py-2 rounded-lg text-sm font-medium border border-purple-400 text-purple-200 hover:bg-purple-600 hover:text-white transition-colors mb-1"
          >
            <Smartphone size={16} />
            <span>תצוגת מובייל</span>
          </button>
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
