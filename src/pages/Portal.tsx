import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabasePublic as supabase } from '@/lib/supabasePublic'
import type { Profile, HoursLog, Transaction, BonusTier } from '@/lib/types'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Clock, Trophy, Plus, TrendingUp } from 'lucide-react'

// ── constants ──────────────────────────────────────────────────────────────
const ILS = new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS' })

const HE_MONTHS_FULL = [
  'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
]

// ── helpers ────────────────────────────────────────────────────────────────
function calculateBonus(revenue: number, tiers: BonusTier[]): number {
  const tier = [...tiers].reverse().find((t) => revenue >= t.min)
  return tier ? tier.bonus : 0
}

function getCurrentTier(revenue: number, tiers: BonusTier[]): BonusTier | null {
  let current: BonusTier | null = null
  for (const tier of tiers) {
    if (revenue >= tier.min) {
      current = tier
    }
  }
  return current
}

function getNextTierThreshold(revenue: number, tiers: BonusTier[]): number | null {
  for (const tier of tiers) {
    if (tier.min > revenue) return tier.min
  }
  return null
}

// ── sub-components ─────────────────────────────────────────────────────────

interface MonthSelectorProps {
  month: number
  year: number
  onChange: (month: number, year: number) => void
}

function MonthSelector({ month, year, onChange }: MonthSelectorProps) {
  const years = [year - 1, year, year + 1]
  return (
    <div className="flex items-center gap-2">
      <Select
        value={String(month)}
        onValueChange={(v) => onChange(Number(v), year)}
      >
        <SelectTrigger className="w-36">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {HE_MONTHS_FULL.map((name, i) => (
            <SelectItem key={i + 1} value={String(i + 1)}>
              {name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={String(year)}
        onValueChange={(v) => onChange(month, Number(v))}
      >
        <SelectTrigger className="w-24">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {years.map((y) => (
            <SelectItem key={y} value={String(y)}>
              {y}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

// ── Hours Tab ──────────────────────────────────────────────────────────────

interface HoursTabProps {
  member: Profile
}

function HoursTab({ member }: HoursTabProps) {
  const queryClient = useQueryClient()
  const now = new Date()
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [year, setYear] = useState(now.getFullYear())
  const [showForm, setShowForm] = useState(false)
  const [formDate, setFormDate] = useState('')
  const [formHours, setFormHours] = useState('')
  const [formDesc, setFormDesc] = useState('')
  const [formCategory, setFormCategory] = useState<'BHR' | 'איגוד'>('BHR')

  const { data: logs = [], isLoading } = useQuery<HoursLog[]>({
    queryKey: ['portal-hours', member.id, month, year],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('hours_log')
        .select('*')
        .eq('profile_id', member.id)
        .eq('month', month)
        .eq('year', year)
        .order('visit_date', { ascending: true })
      if (error) throw error
      return data as HoursLog[]
    },
  })

  const addMutation = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = {
        profile_id: member.id,
        visit_date: formDate,
        hours: Number(formHours),
        description: formDesc || null,
        month,
        year,
      }
      if (member.hours_category_enabled) {
        payload.hours_category = formCategory
      }
      const { error } = await supabase.from('hours_log').insert(payload)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portal-hours', member.id, month, year] })
      setShowForm(false)
      setFormDate('')
      setFormHours('')
      setFormDesc('')
      setFormCategory('BHR')
    },
  })

  const totalHours = logs.reduce((sum, l) => sum + (l.hours ?? 0), 0)

  const colSpan = member.hours_category_enabled ? 4 : 3

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <MonthSelector
          month={month}
          year={year}
          onChange={(m, y) => { setMonth(m); setYear(y) }}
        />
        <Button
          size="sm"
          className="bg-purple-600 hover:bg-purple-700 text-white gap-1"
          onClick={() => setShowForm((v) => !v)}
        >
          <Plus size={16} />
          הוסף דיווח
        </Button>
      </div>

      {showForm && (
        <Card className="border-purple-200 bg-purple-50/40">
          <CardContent className="pt-4 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="f-date">תאריך</Label>
                <Input
                  id="f-date"
                  type="date"
                  value={formDate}
                  onChange={(e) => setFormDate(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="f-hours">שעות</Label>
                <Input
                  id="f-hours"
                  type="number"
                  step={0.5}
                  min={0}
                  value={formHours}
                  onChange={(e) => setFormHours(e.target.value)}
                  placeholder="0.0"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="f-desc">תיאור</Label>
                <Input
                  id="f-desc"
                  value={formDesc}
                  onChange={(e) => setFormDesc(e.target.value)}
                  placeholder="תיאור קצר..."
                />
              </div>
              {member.hours_category_enabled && (
                <div className="space-y-1.5">
                  <Label>קטגוריה</Label>
                  <Select
                    value={formCategory}
                    onValueChange={(v) => setFormCategory(v as 'BHR' | 'איגוד')}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="BHR">BHR</SelectItem>
                      <SelectItem value="איגוד">איגוד</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
            <div className="flex gap-2 justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowForm(false)}
              >
                ביטול
              </Button>
              <Button
                size="sm"
                className="bg-purple-600 hover:bg-purple-700 text-white"
                disabled={!formDate || !formHours || addMutation.isPending}
                onClick={() => addMutation.mutate()}
              >
                {addMutation.isPending ? 'שומר...' : 'שמור'}
              </Button>
            </div>
            {addMutation.isError && (
              <p className="text-sm text-destructive">
                שגיאה בשמירה. נסה שוב.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="px-0">
          {isLoading ? (
            <p className="text-center py-8 text-muted-foreground text-sm">טוען...</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right px-4">תאריך</TableHead>
                  <TableHead className="text-right px-4">שעות</TableHead>
                  {member.hours_category_enabled && (
                    <TableHead className="text-right px-4">קטגוריה</TableHead>
                  )}
                  <TableHead className="text-right px-4">תיאור</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={colSpan}
                      className="text-center py-8 text-muted-foreground"
                    >
                      אין דיווחים לחודש זה
                    </TableCell>
                  </TableRow>
                ) : (
                  logs.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className="px-4">
                        {new Date(log.visit_date).toLocaleDateString('he-IL')}
                      </TableCell>
                      <TableCell className="px-4 font-medium">
                        {log.hours}
                      </TableCell>
                      {member.hours_category_enabled && (
                        <TableCell className="px-4">
                          <Badge
                            variant="outline"
                            className="border-purple-300 text-purple-700"
                          >
                            {log.hours_category ?? '—'}
                          </Badge>
                        </TableCell>
                      )}
                      <TableCell className="px-4 text-muted-foreground">
                        {log.description ?? '—'}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
              {logs.length > 0 && (
                <tfoot>
                  <TableRow className="border-t-2 bg-muted/30 font-semibold">
                    <TableCell className="px-4">סה"כ</TableCell>
                    <TableCell className="px-4">{totalHours}</TableCell>
                    {member.hours_category_enabled && <TableCell />}
                    <TableCell />
                  </TableRow>
                </tfoot>
              )}
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// ── Bonus Tab ──────────────────────────────────────────────────────────────

interface BonusTabProps {
  member: Profile
}

function BonusTab({ member }: BonusTabProps) {
  const now = new Date()
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [year, setYear] = useState(now.getFullYear())

  const bonusModel = member.bonus_model!
  const filter = bonusModel.filter
  const tiers = bonusModel.tiers

  const { data: transactions = [], isLoading } = useQuery<Transaction[]>({
    queryKey: ['portal-bonus-tx', month, year, filter.field, filter.contains],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('transactions')
        .select('*')
        .eq('billing_month', month)
        .eq('billing_year', year)
        .ilike(filter.field, `%${filter.contains}%`)
      if (error) throw error
      return data as Transaction[]
    },
  })

  const totalRevenue = transactions.reduce(
    (sum, t) => sum + (t.net_invoice_amount ?? 0),
    0,
  )
  const bonusAmount = calculateBonus(totalRevenue, tiers)
  const currentTier = getCurrentTier(totalRevenue, tiers)
  const nextThreshold = getNextTierThreshold(totalRevenue, tiers)
  const amountToNext = nextThreshold !== null ? nextThreshold - totalRevenue : null

  return (
    <div className="space-y-4">
      <div className="flex items-center">
        <MonthSelector
          month={month}
          year={year}
          onChange={(m, y) => { setMonth(m); setYear(y) }}
        />
      </div>

      {isLoading ? (
        <p className="text-center py-8 text-muted-foreground text-sm">טוען...</p>
      ) : (
        <div className="space-y-4">
          {/* KPI cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    הכנסות חודשיות
                  </CardTitle>
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-50">
                    <TrendingUp size={18} className="text-purple-600" />
                  </span>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold text-foreground">
                  {ILS.format(totalRevenue)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {transactions.length} עסקאות בחודש
                </p>
              </CardContent>
            </Card>

            <Card className="border-purple-200 bg-purple-50/30">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    בונוס מחושב
                  </CardTitle>
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-100">
                    <Trophy size={18} className="text-purple-600" />
                  </span>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold text-purple-700">
                  {ILS.format(bonusAmount)}
                </p>
                <div className="mt-2 flex items-center gap-2 flex-wrap">
                  {currentTier && (
                    <Badge className="bg-purple-600 text-white text-xs">
                      מדרגה נוכחית: ₪{currentTier.bonus.toLocaleString('he-IL')}
                    </Badge>
                  )}
                  {amountToNext !== null && amountToNext > 0 && (
                    <span className="text-xs text-muted-foreground">
                      עוד {ILS.format(amountToNext)} למדרגה הבאה
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Tiers table */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-semibold">מדרגות בונוס</CardTitle>
            </CardHeader>
            <CardContent className="px-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-right px-4">מינימום</TableHead>
                    <TableHead className="text-right px-4">בונוס</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tiers.map((tier, i) => {
                    const isCurrentTier =
                      currentTier !== null &&
                      tier.min === currentTier.min &&
                      tier.bonus === currentTier.bonus

                    return (
                      <TableRow
                        key={i}
                        className={
                          isCurrentTier
                            ? 'bg-purple-100 font-semibold'
                            : ''
                        }
                      >
                        <TableCell className="px-4">
                          {ILS.format(tier.min)}
                        </TableCell>
                        <TableCell className="px-4">
                          <Badge
                            variant={isCurrentTier ? 'default' : 'outline'}
                            className={
                              isCurrentTier
                                ? 'bg-purple-600 text-white'
                                : 'border-purple-300 text-purple-700'
                            }
                          >
                            ₪{tier.bonus.toLocaleString('he-IL')}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}

// ── Main Portal component ──────────────────────────────────────────────────

export default function Portal() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') ?? ''

  const { data: member, isLoading, isError } = useQuery<Profile | null>({
    queryKey: ['portal-member', token],
    queryFn: async () => {
      if (!token) return null
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('portal_token', token)
        .limit(1)
      if (error) throw error
      return (data?.[0] ?? null) as Profile | null
    },
    enabled: !!token,
    retry: false,
  })

  // ── loading state ──────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-purple-50 to-white">
        <p className="text-muted-foreground text-sm">טוען פורטל...</p>
      </div>
    )
  }

  // ── invalid token ──────────────────────────────────────────────────────
  if (isError || !token || !member) {
    return (
      <div
        className="min-h-screen flex items-center justify-center bg-gradient-to-br from-purple-50 to-white p-4"
        dir="rtl"
      >
        <Card className="max-w-md w-full border-red-200">
          <CardHeader>
            <CardTitle className="text-lg text-destructive">קישור לא תקין</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-sm">
              הקישור שהזנת אינו תקין או שפג תוקפו.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  // ── portal ─────────────────────────────────────────────────────────────
  const hasBonusTab = !!member.bonus_model

  return (
    <div
      className="min-h-screen bg-gradient-to-br from-purple-50 to-white"
      dir="rtl"
    >
      {/* Header */}
      <header className="bg-white border-b border-purple-100 shadow-sm">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <p className="text-xs text-muted-foreground">פורטל עובד</p>
            <h1 className="text-xl font-bold text-purple-700">{member.full_name}</h1>
          </div>
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-purple-100">
            <Clock size={20} className="text-purple-600" />
          </span>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-4xl mx-auto px-4 py-6">
        <Tabs defaultValue="hours">
          <TabsList className="mb-4 bg-purple-100">
            <TabsTrigger
              value="hours"
              className="data-[state=active]:bg-purple-600 data-[state=active]:text-white gap-1.5"
            >
              <Clock size={15} />
              שעות
            </TabsTrigger>
            {hasBonusTab && (
              <TabsTrigger
                value="bonus"
                className="data-[state=active]:bg-purple-600 data-[state=active]:text-white gap-1.5"
              >
                <Trophy size={15} />
                בונוס
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="hours">
            <HoursTab member={member} />
          </TabsContent>

          {hasBonusTab && (
            <TabsContent value="bonus">
              <BonusTab member={member} />
            </TabsContent>
          )}
        </Tabs>
      </main>
    </div>
  )
}
