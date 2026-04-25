import { useState } from 'react'
import { Clock } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import MyHoursView from './MyHoursView'
import ManageHoursView from './ManageHoursView'

type Tab = 'mine' | 'manage'

export default function HoursPage() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const [tab, setTab] = useState<Tab>('mine')

  return (
    <div className="p-6 space-y-4" dir="rtl">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Clock className="w-6 h-6 text-purple-600" />
          <h1 className="text-2xl font-bold text-purple-900">יומן שעות</h1>
        </div>
        {isAdmin && (
          <div className="inline-flex rounded-lg border border-purple-200 bg-white p-0.5 text-sm">
            <button
              type="button"
              onClick={() => setTab('mine')}
              className={`px-4 py-1.5 rounded-md ${
                tab === 'mine' ? 'bg-purple-600 text-white' : 'text-purple-700 hover:bg-purple-50'
              }`}
            >
              השעות שלי
            </button>
            <button
              type="button"
              onClick={() => setTab('manage')}
              className={`px-4 py-1.5 rounded-md ${
                tab === 'manage' ? 'bg-purple-600 text-white' : 'text-purple-700 hover:bg-purple-50'
              }`}
            >
              ניהול שעות
            </button>
          </div>
        )}
      </div>

      {tab === 'mine' || !isAdmin ? <MyHoursView /> : <ManageHoursView />}
    </div>
  )
}
