import { Clock } from 'lucide-react'
import MyHoursView from './MyHoursView'

export default function HoursPage() {
  return (
    <div className="p-6 space-y-4" dir="rtl">
      <div className="flex items-center gap-2">
        <Clock className="w-6 h-6 text-purple-600" />
        <h1 className="text-2xl font-bold text-purple-900">יומן שעות</h1>
      </div>
      <MyHoursView />
    </div>
  )
}
