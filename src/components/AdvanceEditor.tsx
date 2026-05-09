import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export type AdvanceType = 'fixed' | 'percent' | ''

export default function AdvanceEditor({
  advanceType,
  advanceAmount,
  onTypeChange,
  onAmountChange,
}: {
  advanceType: AdvanceType
  advanceAmount: string
  onTypeChange: (t: AdvanceType) => void
  onAmountChange: (v: string) => void
}) {
  const tabClass = (active: boolean) =>
    `flex-1 px-3 py-2 text-sm rounded-md border transition-colors ${
      active
        ? 'bg-purple-600 text-white border-purple-600'
        : 'bg-white text-purple-700 border-purple-200 hover:bg-purple-50'
    }`

  return (
    <div className="space-y-2 rounded border border-purple-100 bg-purple-50/40 p-3">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => {
            onTypeChange('')
            onAmountChange('')
          }}
          className={tabClass(advanceType === '')}
        >
          ללא מקדמה
        </button>
        <button
          type="button"
          onClick={() => onTypeChange('fixed')}
          className={tabClass(advanceType === 'fixed')}
        >
          סכום קבוע
        </button>
        <button
          type="button"
          onClick={() => onTypeChange('percent')}
          className={tabClass(advanceType === 'percent')}
        >
          אחוז מהשכר
        </button>
      </div>

      {advanceType === 'fixed' && (
        <div className="space-y-1">
          <Label className="text-xs">סכום מקדמה (₪)</Label>
          <Input
            type="number"
            dir="ltr"
            value={advanceAmount}
            onChange={(e) => onAmountChange(e.target.value)}
            placeholder="למשל 1500"
          />
          <p className="text-xs text-muted-foreground">המקדמה תנוכה מחשבון הסופי</p>
        </div>
      )}

      {advanceType === 'percent' && (
        <div className="space-y-1">
          <Label className="text-xs">אחוז מהשכר (%)</Label>
          <Input
            type="number"
            dir="ltr"
            value={advanceAmount}
            onChange={(e) => onAmountChange(e.target.value)}
            placeholder="למשל 30"
          />
          <p className="text-xs text-muted-foreground">
            % מהשכר הברוטו יגבה מראש וינוכה מהעמלה
          </p>
        </div>
      )}
    </div>
  )
}
