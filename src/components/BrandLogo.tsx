import { cn } from '@/lib/utils'

// The one React placement of the company logo (Repair 30). navy = light
// backgrounds, white = dark ones (sidebar, mobile header). The mark itself is
// never redrawn — assets come from scripts/generate-icons.mjs.
export default function BrandLogo({
  variant = 'navy',
  size = 32,
  className,
}: {
  variant?: 'navy' | 'white'
  /** rendered height in px */
  size?: number
  className?: string
}) {
  return (
    <img
      src={variant === 'white' ? '/brand/bhr-logo-white.png' : '/brand/bhr-logo.png'}
      alt="Banani HR"
      style={{ height: size, width: 'auto' }}
      className={cn('select-none shrink-0', className)}
      draggable={false}
    />
  )
}
