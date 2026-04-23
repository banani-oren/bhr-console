import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { LogOut, Smartphone } from 'lucide-react'
import ProfileEditor from '@/components/ProfileEditor'

export default function MobileProfile() {
  const { user, profile, signOut } = useAuth()
  const navigate = useNavigate()

  const inStandalone =
    typeof window !== 'undefined' &&
    (
      (window.matchMedia?.('(display-mode: standalone)').matches) ||
      // @ts-expect-error legacy iOS navigator.standalone
      window.navigator?.standalone === true
    )

  const handleSignOut = async () => {
    await signOut()
    navigate('/login')
  }

  return (
    <div className="p-4 space-y-3">
      <Card className="p-4">
        <p className="text-sm font-semibold">{profile?.full_name ?? user?.email}</p>
        <p className="text-[11px] text-muted-foreground" dir="ltr">{user?.email}</p>
        <p className="text-[11px] text-purple-600 mt-1">
          {profile?.role === 'admin'
            ? 'מנהל'
            : profile?.role === 'administration'
            ? 'מנהלה'
            : 'רכז/ת גיוס'}
        </p>
      </Card>

      <ProfileEditor variant="mobile" />

      <Card className="p-4 space-y-2">
        <div className="flex items-center gap-2 text-sm">
          <Smartphone className="h-4 w-4 text-purple-600" />
          <span>מצב מכשיר:</span>
          <span className="font-medium">
            {inStandalone ? 'פועל כאפליקציה (מותקן)' : 'פועל בדפדפן'}
          </span>
        </div>
        {!inStandalone && (
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            כדי להתקין ב-iOS: לחץ "שתף" בתחתית Safari, ואז "הוסף למסך הבית".
          </p>
        )}
      </Card>
      <Button
        onClick={handleSignOut}
        variant="outline"
        className="w-full text-destructive border-destructive/40 hover:bg-destructive/5"
      >
        <LogOut className="h-4 w-4 ml-1" /> התנתק מהמכשיר
      </Button>
      <p className="text-[10px] text-muted-foreground text-center">
        בכניסה הבאה ניתן יהיה להשתמש בחיוב Face-ID למילוי הסיסמה אוטומטית.
      </p>
    </div>
  )
}
