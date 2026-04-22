import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

// Batch 4 Phase A4: a switch with clearly-labeled off/on states on either side
// of the track. The active side is bold; the track is purple when on, zinc
// when off. Designed for binary booleans that need unambiguous state
// (is_billable, exclusivity, hours_category_enabled, time_log_enabled, etc.)

type Props = {
  label?: string
  checked: boolean
  onCheckedChange: (v: boolean) => void
  offText: string
  onText: string
  disabled?: boolean
  className?: string
}

export default function LabeledToggle({
  label,
  checked,
  onCheckedChange,
  offText,
  onText,
  disabled,
  className,
}: Props) {
  return (
    <div className={cn('flex items-center gap-3 flex-wrap', className)}>
      {label && <Label className="text-sm text-purple-700 shrink-0">{label}</Label>}
      <div className="inline-flex items-center gap-2">
        <span
          className={cn(
            'text-xs select-none',
            !checked ? 'font-semibold text-foreground' : 'text-muted-foreground',
          )}
        >
          {offText}
        </span>
        <Switch
          checked={checked}
          onCheckedChange={onCheckedChange}
          disabled={disabled}
          className={cn(
            'h-6 w-11 data-[state=checked]:bg-purple-600 data-[state=unchecked]:bg-zinc-300',
          )}
        />
        <span
          className={cn(
            'text-xs select-none',
            checked ? 'font-semibold text-foreground' : 'text-muted-foreground',
          )}
        >
          {onText}
        </span>
      </div>
    </div>
  )
}
