import { useNavigate } from 'react-router-dom'
import { Clock, CalendarCheck, ChevronLeft, UserCircle, LogOut } from 'lucide-react'
import { useAuth } from '@/lib/auth'

export default function MobileLanding() {
  const { profile, user, signOut } = useAuth()
  const navigate = useNavigate()

  const name = profile?.full_name ?? user?.email ?? ''
  const initials = name.trim().slice(0, 1) || 'B'

  const handleSignOut = async () => {
    await signOut()
    navigate('/login')
  }

  return (
    <div
      dir="rtl"
      className="min-h-[100dvh] flex flex-col items-center bg-gradient-to-b from-purple-900 via-purple-800 to-purple-950 px-5 pt-10 pb-8 text-white"
    >
      <div className="flex flex-col items-center gap-2 mb-8">
        <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-white/15 backdrop-blur text-white font-bold text-2xl">
          {initials}
        </div>
        <p className="text-sm text-purple-200">שלום,</p>
        <p className="text-lg font-semibold">{name}</p>
      </div>

      <div className="w-full max-w-sm space-y-4">
        <button
          onClick={() => navigate('/m/hours')}
          className="w-full min-h-[80px] flex items-center gap-4 rounded-2xl bg-white text-gray-900 px-5 py-4 shadow-lg active:scale-[0.98] transition-transform"
        >
          <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-purple-100 text-purple-700 shrink-0">
            <Clock className="h-6 w-6" />
          </div>
          <div className="flex-1 text-right">
            <p className="font-semibold text-base">שעות</p>
            <p className="text-xs text-gray-500">רישום שעות עבודה</p>
          </div>
          <ChevronLeft className="h-5 w-5 text-gray-400" />
        </button>

        <button
          onClick={() => navigate('/m/attendance')}
          className="w-full min-h-[80px] flex items-center gap-4 rounded-2xl bg-white text-gray-900 px-5 py-4 shadow-lg active:scale-[0.98] transition-transform"
        >
          <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-purple-100 text-purple-700 shrink-0">
            <CalendarCheck className="h-6 w-6" />
          </div>
          <div className="flex-1 text-right">
            <p className="font-semibold text-base">נוכחות</p>
            <p className="text-xs text-gray-500">כניסה ויציאה</p>
          </div>
          <ChevronLeft className="h-5 w-5 text-gray-400" />
        </button>
      </div>

      <div className="flex-1" />

      <div className="w-full max-w-sm flex items-center justify-between pt-4">
        <button
          onClick={() => navigate('/m/profile')}
          className="flex items-center gap-1.5 text-sm text-purple-200 hover:text-white px-2 py-2"
        >
          <UserCircle className="h-4 w-4" />
          פרופיל
        </button>
        <button
          onClick={handleSignOut}
          className="flex items-center gap-1.5 text-sm text-purple-200 hover:text-white px-2 py-2"
        >
          <LogOut className="h-4 w-4" />
          התנתק
        </button>
      </div>
    </div>
  )
}
