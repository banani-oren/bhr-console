# Repair 2 — Payment Terms + Billing Event Documents
## Claude Code Execution Prompt

---

## Persistence Header

You are implementing 2 feature fixes in BHR Console. Work autonomously through all steps.
Do not stop between steps. Fix errors and continue. Only stop after printing `QA COMPLETE ✓` and `REPAIR 2 COMPLETE ✓`.

Read `App Dev/CLAUDE.md` first — authoritative stack and constraint reference.

**Project:** `banani-oren/bhr-console` · `https://bhr-console-banani-orens-projects.vercel.app` · Supabase `szunbwkmldepkwpxojma`  
Stack: React 19 + Vite + TypeScript + TailwindCSS v4 + shadcn/ui + @tanstack/react-query v5. RTL. Hebrew UI.

---

## Business Logic (read carefully before writing code)

### Payment Terms — "שוטף+X"

"שוטף" means: from the date the חשבון עסקה (proforma/transaction invoice) is issued,
advance to the **last day of that calendar month**, then add X additional days.

Example:
- חשבון עסקה issued: 11 May 2026
- Terms: שוטף+30
- Step 1: end of May = 31 May 2026
- Step 2: add 30 days = 30 June 2026
- ∴ חשבונית מס קבלה expected by: 30 June 2026

"שוטף+0" = payment expected by last day of the same month the invoice was issued.

### Two-document flow per billing event

Each billing event represents money to be collected. It goes through two documents:

**Document 1 — חשבון עסקה** (Proforma / Transaction Invoice)
- When: `billing_date` (system-calculated at transaction creation)
- Number: `invoice_number` — typed manually when sent to client
- Entering `invoice_number` → status becomes `billed`

**Document 2 — חשבונית מס קבלה** (Tax Invoice + Receipt — confirms payment received)
- When: auto-calculated = `end_of_month(billing_date) + payment_term_days`
- This calculated date can be manually overridden (stored in `payment_date` field)
- Number: `receipt_number` — typed manually when payment is confirmed
- Entering `receipt_number` → status becomes `paid`
- **Only at this point is the transaction considered financially closed.**

### Status progression
```
pending → to_bill → billed → paid
                  ↘ cancelled (manual or work_end_date)
```
- `pending`: created, billing_date in future
- `to_bill`: billing_date ≤ today AND transaction approved (automatic)
- `billed`: invoice_number entered (חשבון עסקה issued)
- `paid`: receipt_number entered (חשבונית מס קבלה = money received)
- `cancelled`: manual override or work_end_date set

---

## STEP 1 — DB Migration: add `paid` status

### 1a. Create migration file

Create `supabase/migrations/20260512_billing_events_paid_status.sql`:

```sql
-- Add 'paid' to billing_events status enum
-- Postgres CHECK constraints must be dropped and re-added

ALTER TABLE billing_events
  DROP CONSTRAINT IF EXISTS billing_events_status_check;

ALTER TABLE billing_events
  ADD CONSTRAINT billing_events_status_check
  CHECK (status IN ('pending', 'to_bill', 'billed', 'paid', 'cancelled'));

-- Backfill: any event that has receipt_number set but status='billed' → mark as paid
UPDATE billing_events
SET status = 'paid'
WHERE status = 'billed'
  AND receipt_number IS NOT NULL
  AND receipt_number != '';
```

### 1b. Apply migration

```bash
cd "App Dev"
supabase db push --project-ref szunbwkmldepkwpxojma
```

Verify:
```bash
curl -s "https://api.supabase.com/v1/projects/szunbwkmldepkwpxojma/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query": "SELECT status, COUNT(*) FROM billing_events GROUP BY status ORDER BY status"}'
```

Confirm `paid` appears as a valid status (even if count is 0 for now).

---

## STEP 2 — Update `src/lib/types.ts`

Change `BillingEventStatus`:

```typescript
export type BillingEventStatus = 'pending' | 'to_bill' | 'billed' | 'paid' | 'cancelled'
```

---

## STEP 3 — Update `src/lib/billingEvents.ts`

### 3a. Fix `computeEventStatus` to include `paid`

Replace the existing `computeEventStatus` function:

```typescript
export function computeEventStatus(
  event: Pick<BillingEvent, 'status' | 'billing_date' | 'invoice_number' | 'receipt_number'>,
  transactionApproved: boolean,
): BillingEvent['status'] {
  if (event.status === 'cancelled') return 'cancelled'
  // receipt_number = חשבונית מס קבלה number → payment confirmed
  if (event.receipt_number) return 'paid'
  // invoice_number = חשבון עסקה number → proforma sent
  if (event.status === 'billed' || event.invoice_number) return 'billed'
  if (!transactionApproved) return 'pending'
  const today = new Date().toISOString().slice(0, 10)
  if (event.billing_date && event.billing_date <= today) return 'to_bill'
  return 'pending'
}
```

### 3b. Add `calculateTaxInvoiceDate` function

Add after `addDays`:

```typescript
/**
 * Calculates the expected חשבונית מס קבלה date using Israeli "שוטף+X" logic:
 * - Advance to the last day of the invoice month ("שוטף")
 * - Then add the specified number of additional days
 *
 * Example: invoice 11 May 2026, days=30 → end of May (31 May) + 30 days = 30 June 2026
 */
export function calculateTaxInvoiceDate(invoiceDate: string, paymentTermsDays: number): string {
  const d = new Date(invoiceDate)
  if (isNaN(d.getTime())) return invoiceDate
  // Last day of the invoice month
  const endOfMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0)
  // Add additional days
  endOfMonth.setDate(endOfMonth.getDate() + paymentTermsDays)
  return endOfMonth.toISOString().slice(0, 10)
}

/**
 * Parses "שוטף+30", "שוטף +30", "שוטף+0", "30", etc. into just the number of days.
 * "שוטף" alone = 0 additional days.
 * Returns 30 as a safe default if nothing can be parsed.
 */
export function parsePaymentTermDays(terms: string | null | undefined): number {
  if (!terms) return 30
  const s = String(terms).replace(/\s+/g, '')
  // Pure number stored directly
  if (/^\d+$/.test(s)) return Number(s)
  if (s === 'שוטף') return 0
  const m = s.match(/שוטף\+(\d+)/)
  if (m) return Number(m[1])
  return 30
}
```

---

## STEP 4 — Update `src/pages/Clients.tsx` — payment terms field

Find the payment_terms input in the ClientDialog (around line 907–914):

```tsx
<div className="space-y-1.5">
  <Label>תנאי תשלום</Label>
  <Input
    value={form.payment_terms}
    onChange={(e) => setField('payment_terms', e.target.value)}
    placeholder="שוטף + 30"
  />
</div>
```

Replace with:

```tsx
<div className="space-y-1.5">
  <Label>תנאי תשלום</Label>
  <div className="flex items-center gap-1">
    <span className="text-sm font-medium text-gray-700 bg-gray-100 border border-r-0 border-input rounded-r-md px-3 py-2 whitespace-nowrap select-none">
      שוטף +
    </span>
    <Input
      type="number"
      min={0}
      max={365}
      dir="ltr"
      className="rounded-r-none w-24 text-center"
      value={
        // Parse existing stored value (e.g. "שוטף+30") to show just the number
        (() => {
          const s = (form.payment_terms ?? '').replace(/\s+/g, '')
          if (!s || s === 'שוטף') return '0'
          const m = s.match(/שוטף\+(\d+)/)
          if (m) return m[1]
          if (/^\d+$/.test(s)) return s
          return '0'
        })()
      }
      onChange={(e) => {
        const days = e.target.value === '' ? '0' : e.target.value
        setField('payment_terms', `שוטף+${days}`)
      }}
    />
    <span className="text-xs text-muted-foreground mr-1">ימים</span>
  </div>
  <p className="text-[11px] text-muted-foreground">
    שוטף = עד סוף חודש החשבון + הימים שהזנת
  </p>
</div>
```

Note: This stores the value as "שוטף+X" format, preserving all existing parsing code.

---

## STEP 5 — Restructure `BillingEventRow` in `src/components/TransactionDialog.tsx`

### 5a. Update status constants

Find and replace `STATUS_COLOR` and `STATUS_LABEL`:

```typescript
const STATUS_COLOR: Record<BillingEvent['status'], string> = {
  pending:   'bg-amber-400',
  to_bill:   'bg-blue-500',
  billed:    'bg-green-500',
  paid:      'bg-emerald-600',
  cancelled: 'bg-red-400',
}

const STATUS_LABEL: Record<BillingEvent['status'], string> = {
  pending:   'ממתין',
  to_bill:   'לחיוב',
  billed:    'חויב',
  paid:      'שולם',
  cancelled: 'מבוטל',
}
```

### 5b. Update `BillingEventsPanel` to pass payment terms days

The `BillingEventsPanel` already receives `selectedClient` as a prop (added in Repair 1).
Parse the payment terms and pass `paymentTermsDays` to each `BillingEventRow`.

Find the BillingEventsPanel component and update it:

```typescript
function BillingEventsPanel({
  events,
  approved,
  onChange,
  transaction,
  selectedClient,
}: {
  events: BillingEvent[]
  approved: boolean
  onChange: () => void
  transaction: Transaction
  selectedClient: Client | null
}) {
  // Import parsePaymentTermDays at the top of the file from '@/lib/billingEvents'
  const paymentTermsDays = parsePaymentTermDays(selectedClient?.payment_terms)

  return (
    <div>
      <h3 className="text-sm font-semibold text-purple-700 mb-3">
        חיובים ותשלומים{!approved && <span className="text-amber-600 text-xs ms-2">(העסקה ממתינה לאישור)</span>}
      </h3>
      {events.length === 0 ? (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">אין אירועי חיוב לעסקה זו.</p>
          {transaction.kind === 'service' && transaction.work_start_date && (
            <GenerateBillingEventsButton
              transaction={transaction}
              selectedClient={selectedClient}
              onGenerated={onChange}
            />
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {events.map((e) => (
            <BillingEventRow
              key={e.id}
              event={e}
              paymentTermsDays={paymentTermsDays}
              onSaved={onChange}
            />
          ))}
        </div>
      )}
    </div>
  )
}
```

### 5c. Rewrite `BillingEventRow` with two-document layout

Replace the entire `BillingEventRow` function with:

```tsx
function BillingEventRow({
  event,
  paymentTermsDays,
  onSaved,
}: {
  event: BillingEvent
  paymentTermsDays: number
  onSaved: () => void
}) {
  // חשבון עסקה fields
  const [invoiceNumber, setInvoiceNumber] = useState(event.invoice_number ?? '')
  // חשבונית מס קבלה fields
  const [receiptNumber, setReceiptNumber] = useState(event.receipt_number ?? '')
  const [taxInvoiceDateOverride, setTaxInvoiceDateOverride] = useState(event.payment_date ?? '')
  const [savingField, setSavingField] = useState<string | null>(null)

  useEffect(() => {
    setInvoiceNumber(event.invoice_number ?? '')
    setReceiptNumber(event.receipt_number ?? '')
    setTaxInvoiceDateOverride(event.payment_date ?? '')
  }, [event.id, event.invoice_number, event.receipt_number, event.payment_date])

  // Auto-calculated tax invoice date (חשבונית מס קבלה date)
  const calculatedTaxDate = event.billing_date
    ? calculateTaxInvoiceDate(event.billing_date, paymentTermsDays)
    : null

  // Display: override takes priority, then calculated, then blank
  const taxDateDisplay = taxInvoiceDateOverride || calculatedTaxDate || ''

  const saveField = async (
    field: 'invoice_number' | 'payment_date' | 'receipt_number',
    value: string,
  ) => {
    setSavingField(field)
    const patch: Record<string, unknown> = { [field]: value || null }

    // Status transitions
    if (field === 'invoice_number') {
      if (value && event.status !== 'billed' && event.status !== 'paid') {
        patch.status = 'billed'
      } else if (!value && event.status === 'billed') {
        patch.status = 'to_bill'
      }
    }
    if (field === 'receipt_number') {
      if (value) {
        patch.status = 'paid'
        // Also set the tax invoice date if it hasn't been manually set
        if (!event.payment_date && calculatedTaxDate) {
          patch.payment_date = calculatedTaxDate
        }
      } else if (!value && event.status === 'paid') {
        // Cleared receipt number → revert to billed if invoice_number still set
        patch.status = event.invoice_number ? 'billed' : 'to_bill'
      }
    }

    const { error } = await supabase.from('billing_events').update(patch).eq('id', event.id)
    setSavingField(null)
    if (error) {
      console.error('BillingEventRow save error:', error)
      return
    }
    onSaved()
  }

  const ILS = new Intl.NumberFormat('he-IL', {
    style: 'currency',
    currency: 'ILS',
    maximumFractionDigits: 0,
  })

  return (
    <Card className="p-3 space-y-3">
      {/* Header row: status dot + description + billing date + amount */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span className={`inline-block w-2.5 h-2.5 rounded-full flex-shrink-0 ${STATUS_COLOR[event.status]}`} />
          <span className="text-sm font-medium">{event.description ?? '—'}</span>
          <Badge variant="outline" className="text-xs">{STATUS_LABEL[event.status]}</Badge>
        </div>
        <span className="text-base font-bold text-purple-900">{ILS.format(event.amount)}</span>
      </div>

      {/* Two-document grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* Document 1: חשבון עסקה */}
        <div className="space-y-2 border border-blue-100 rounded-lg p-3 bg-blue-50/30">
          <h4 className="text-xs font-semibold text-blue-800 flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-full bg-blue-400" />
            חשבון עסקה
          </h4>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">תאריך חשבון</Label>
              <p className="text-sm font-medium">
                {event.billing_date
                  ? new Intl.DateTimeFormat('he-IL', {
                      day: '2-digit', month: '2-digit', year: 'numeric',
                      timeZone: 'Asia/Jerusalem',
                    }).format(new Date(event.billing_date))
                  : '—'}
              </p>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">מספר חשבון עסקה</Label>
              <Input
                className="h-7 text-sm"
                value={invoiceNumber}
                onChange={(e) => setInvoiceNumber(e.target.value)}
                onBlur={() => {
                  if (invoiceNumber !== (event.invoice_number ?? '')) {
                    void saveField('invoice_number', invoiceNumber)
                  }
                }}
                placeholder={savingField === 'invoice_number' ? 'שומר...' : 'מספר חשבון'}
              />
            </div>
          </div>
        </div>

        {/* Document 2: חשבונית מס קבלה */}
        <div className="space-y-2 border border-green-100 rounded-lg p-3 bg-green-50/30">
          <h4 className="text-xs font-semibold text-green-800 flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />
            חשבונית מס קבלה
          </h4>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">
                תאריך פירעון
                {calculatedTaxDate && !taxInvoiceDateOverride && (
                  <span className="text-purple-600 mr-1">(מחושב)</span>
                )}
                {taxInvoiceDateOverride && (
                  <span className="text-amber-600 mr-1">(ידני)</span>
                )}
              </Label>
              <div className="flex gap-1 items-center">
                <Input
                  type="date"
                  className="h-7 text-sm"
                  value={taxDateDisplay}
                  onChange={(e) => setTaxInvoiceDateOverride(e.target.value)}
                  onBlur={() => {
                    const newVal = taxInvoiceDateOverride || calculatedTaxDate || ''
                    if (newVal !== (event.payment_date ?? '')) {
                      void saveField('payment_date', newVal)
                    }
                  }}
                />
                {taxInvoiceDateOverride && (
                  <button
                    type="button"
                    className="text-xs text-muted-foreground hover:text-foreground"
                    title="אפס לתאריך מחושב"
                    onClick={() => {
                      setTaxInvoiceDateOverride('')
                      if (calculatedTaxDate) {
                        void saveField('payment_date', calculatedTaxDate)
                      }
                    }}
                  >
                    ↩
                  </button>
                )}
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">מספר חשבונית מס קבלה</Label>
              <Input
                className="h-7 text-sm"
                value={receiptNumber}
                onChange={(e) => setReceiptNumber(e.target.value)}
                onBlur={() => {
                  if (receiptNumber !== (event.receipt_number ?? '')) {
                    void saveField('receipt_number', receiptNumber)
                  }
                }}
                placeholder={savingField === 'receipt_number' ? 'שומר...' : 'מספר חשבונית'}
              />
            </div>
          </div>
        </div>
      </div>
    </Card>
  )
}
```

Make sure `calculateTaxInvoiceDate` is imported at the top of `TransactionDialog.tsx` from `@/lib/billingEvents`.

---

## STEP 6 — Update STATUS_COLOR and STATUS_LABEL in `src/pages/Transactions.tsx`

The `STATUS_COLOR` map in `Transactions.tsx` also needs the `paid` status:

```typescript
const STATUS_COLOR: Record<BillingEventStatus, string> = {
  pending:   'bg-amber-400',
  to_bill:   'bg-blue-500',
  billed:    'bg-green-500',
  paid:      'bg-emerald-600',
  cancelled: 'bg-red-400',
}
```

---

## STEP 7 — Update STATUS_COLOR in `src/pages/BillingReports.tsx`

Read BillingReports.tsx and find its status color map. Add `paid: 'bg-emerald-600'`.
Also add `paid: 'שולם'` to any status label map in that file.

If BillingReports filters by status, make sure the `paid` status option is available in the filter dropdown.

---

## STEP 8 — Update `generateServiceBillingEvents` in `src/lib/billingEvents.ts`

The billing events generation currently doesn't pre-calculate the tax invoice date.
This is fine — the date is calculated on-the-fly in the UI using `calculateTaxInvoiceDate`.
No change needed to `generateServiceBillingEvents`.

However, update the `generateTimePeriodBillingEvent` to NOT use `addDays(today, termDays)`
for `billing_date` anymore — that was applying payment terms to the initial billing date,
which is wrong. For time_period transactions, `billing_date` = the date the hours billing
transaction was created (today). The tax invoice date is calculated in the UI.

```typescript
// In generateTimePeriodBillingEvent, change billing_date to just today:
const billingDate = today  // The proforma date = today when billing is generated
// Remove: const termDays = parsePaymentTermDays(paymentTerms)
// Remove: const billingDate = addDays(today, termDays)
// Keep paymentTerms parameter for future use but don't apply it to billing_date
```

---

## STEP 9 — Build and type-check

```bash
cd "App Dev"
npm run build
npx tsc --noEmit
```

Zero errors required. Fix all TypeScript errors before proceeding.

Common issues to watch for:
- `BillingEvent['status']` type now includes `'paid'` — check all switch/Record statements
- `calculateTaxInvoiceDate` needs to be imported in TransactionDialog.tsx
- `parsePaymentTermDays` needs to be imported in TransactionDialog.tsx

---

## STEP 10 — Commit and push

```bash
git add -A
git commit -m "feat: payment terms שוטף+X field, two-document billing event layout (חשבון עסקה + חשבונית מס קבלה), paid status"
git push origin main
```

---

## STEP 11 — Verify Vercel deploy

```bash
curl -s -o /dev/null -w "%{http_code}" https://bhr-console-banani-orens-projects.vercel.app/
```

---

## STEP 12 — Full QA

### 12a. DB — paid status exists
```bash
curl -s "https://api.supabase.com/v1/projects/szunbwkmldepkwpxojma/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query": "SELECT status, COUNT(*) FROM billing_events GROUP BY status"}'
```
Confirm `paid` is a valid value (constraint allows it).

### 12b. Payment terms field
- Open any client, go to "תנאי הסכם" section
- Confirm the payment_terms field shows "שוטף +" as a fixed label with a number input next to it
- Enter "30" — confirm it saves as "שוטף+30"
- Enter "0" — confirm it saves as "שוטף+0"
- Reload the client dialog — confirm the field shows "30" (not "שוטף+30")

### 12c. Tax invoice date calculation
Test the calculation logic directly:
- Client with payment_terms "שוטף+30"
- Open a transaction with a billing event dated 11 May 2026
- Confirm the חשבונית מס קבלה date shows 30 June 2026 (end of May + 30 days)
- Client with payment_terms "שוטף+0" and billing event dated 11 May 2026
- Confirm date shows 31 May 2026 (end of May + 0 days)

### 12d. Billing event two-document layout
- Open any transaction with billing events in the edit dialog
- Confirm each billing event shows TWO sections:
  - "חשבון עסקה" (blue background): date (read-only) + invoice number input
  - "חשבונית מס קבלה" (green background): calculated due date (with manual override) + receipt number input
- Enter an invoice number → confirm status changes to "חויב" (billed)
- Enter a receipt number → confirm status changes to "שולם" (paid)
- The ↩ reset button on the tax date appears when manually overridden; clicking it restores the calculated date

### 12e. Status dot colors
- In the transactions table, billing dots show 5 possible colors
- "שולם" events show emerald-600 (darker green, distinct from "חויב" green)

### 12f. Build + RTL
- No console errors
- All sections maintain dir="rtl"

### 12g. Print results
```
QA COMPLETE ✓
- DB: paid status constraint applied ✓
- payment_terms field: שוטף+ prefix + number input ✓
- שוטף+30 calculation: 11/5/26 → 30/6/26 ✓
- שוטף+0 calculation: 11/5/26 → 31/5/26 ✓
- Billing event: two-document layout (חשבון עסקה + חשבונית מס קבלה) ✓
- invoice_number → billed status ✓
- receipt_number → paid status ✓
- Tax date: calculated from billing_date + שוטף+X, manual override + reset ✓
- Status dots: 5 colors including paid (emerald) ✓
- Live URL: HTTP 200 ✓

REPAIR 2 COMPLETE ✓
```

---

## Run this prompt

```powershell
cd "C:\Users\Oren\BHR Console\App Dev"; claude --dangerously-skip-permissions "$(Get-Content '.\REPAIR2_PROMPT.md' -Raw)"
```
