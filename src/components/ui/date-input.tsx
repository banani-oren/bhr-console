import * as React from 'react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

// Batch 4.2 Phase C: wrap <input type="date"> with a consistent styling
// so the native date control can never clip in RTL layouts. Problem: a
// bare `<Input type="date">` inside a flex/grid cell under `dir="rtl"`
// sometimes renders `23/04/2026` as `3/04/2026` because the leading digit
// gets pushed behind the calendar-icon edge.
//
// Fix: force the INPUT itself to `dir="ltr"` + `text-left` (date values
// are numeric LTR regardless of page direction), take the full width of
// its cell, and guarantee a ~150px minimum so narrow grids don't
// squeeze the control past the glyph-rendering threshold.

export type DateInputProps = Omit<React.ComponentProps<typeof Input>, 'type' | 'dir'>

const DateInput = React.forwardRef<HTMLInputElement, DateInputProps>(function DateInput(
  { className, ...props },
  ref,
) {
  return (
    <Input
      ref={ref}
      type="date"
      dir="ltr"
      className={cn('w-full min-w-[150px] text-left', className)}
      {...props}
    />
  )
})

export { DateInput }
