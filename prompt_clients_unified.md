# BHR Console — Unified Clients Module

Start by reading **BHR_CONSOLE_PROJECT.MD** in full before making any changes.

---

## Overview

This prompt consolidates the clients and agreements into a single unified entity across the entire system: DB, logic, navigation, and UI. There is no "agreements" concept separate from clients. A client record contains everything.

---

## 1. Database — Migration

Drop the separation between `clients` and `agreements`. Replace with:

**Keep `clients` as the single source of truth.**  
**Keep `agreements` as a 1:1 child table** (one agreement per client, always fetched together via JOIN). Do not merge into one table — keep the relational structure — but treat them as one entity everywhere in the application.

Ensure the `clients` table has ALL of the following fields:

```sql
alter table clients add column if not exists group_name text;
alter table clients add column if not exists notes text;
-- status already exists: 'active' | 'inactive'
```

Ensure the `agreements` table has ALL of the following fields:

```sql
create table if not exists agreements (
  id                   uuid primary key default gen_random_uuid(),
  client_id            uuid not null references clients(id) on delete cascade,
  agreement_type       text check (agreement_type in ('השמה','ריטיינר','ליווי','אחר')),
  commission_pct       numeric(5,2),        -- e.g. 100 = 100%
  salary_base          numeric(5,2),        -- number of salaries (e.g. 1, 1.5)
  payment_split        text,               -- e.g. "30/70"
  warranty_days        integer,            -- e.g. 60
  payment_terms        text,               -- e.g. "שוטף + 30"
  advance              text,               -- e.g. "30% מקדמה" or "1,500 ₪"
  exclusivity          boolean default false,
  contact_name         text,
  contact_email        text,
  contact_phone        text,
  contract_file        text,               -- filename only, e.g. "הסכם_לקוח.pdf"
  status               text default 'active' check (status in ('active','inactive','pending')),
  notes                text,
  created_at           timestamptz default now(),
  updated_at           timestamptz default now()
);

create unique index if not exists agreements_client_id_unique on agreements(client_id);
```

Add updated_at trigger to agreements if not already present.

Write this as a new Supabase migration file.

---

## 2. Data Layer — `lib/clients.ts`

Replace any existing separate client/agreement query functions with these unified ones:

```typescript
// Always returns client + agreement joined
getClients(filters?: { search?: string; status?: string; group?: string })
getClientById(id: string)   // returns { ...client, agreement: {...} | null }
upsertClient(data: ClientFormData)   // creates/updates client + agreement in one transaction
deleteClient(id: string)
```

`ClientFormData` type must include ALL fields from both tables:

```typescript
type ClientFormData = {
  // Client fields
  name: string
  tax_id?: string
  group_name?: string
  address?: string
  phone?: string
  email?: string
  contact_name?: string
  status: 'active' | 'inactive'
  notes?: string
  // Agreement fields
  agreement_type?: string
  commission_pct?: number
  salary_base?: number
  payment_split?: string
  warranty_days?: number
  payment_terms?: string
  advance?: string
  exclusivity?: boolean
  agreement_contact_name?: string
  agreement_contact_email?: string
  agreement_contact_phone?: string
  contract_file?: string
  agreement_status?: string
  agreement_notes?: string
}
```

`upsertClient` must write to both tables atomically. Use Supabase's RPC or sequential inserts with error rollback.

Do NOT put queries inside dialog or modal components. All data fetching happens in the page component and is passed down as props.

---

## 3. Navigation — Sidebar to the Right

Move the sidebar to the **right** side of the screen. Hebrew RTL standard.

- `fixed right-0` instead of `fixed left-0`
- `mr-64` on main content instead of `ml-64`
- Remove any `/agreements` link from the sidebar entirely
- The sidebar should show: דשבורד, לקוחות, עסקאות, בונוס נועה פולק (and any other existing links)
- System name displayed at the top of the right sidebar: **BHR Console**

---

## 4. Remove /agreements Route

- Delete or redirect `app/agreements/page.tsx` → redirect to `/clients`
- Remove all internal `href="/agreements"` links
- Remove `agreements` from any navigation config arrays

---

## 5. Clients Page — `/clients`

### List view
- Table with columns: שם לקוח, קבוצה, ח.פ, סוג הסכם, איש קשר, סטטוס, פעולות
- Live search by client name
- Filter: status (הכל / פעיל / לא פעיל)
- Filter: group (dropdown, distinct values from DB)
- Button: **לקוח חדש** → opens the unified card in create mode
- Button: **ייבוא מאקסל** → opens import flow (see section 6)
- Clicking a row → opens the unified card in view/edit mode

### Unified client card (drawer or modal)
Single scrollable form with two visual sections separated by a divider:

**Section 1 — פרטי החברה**
| Field | Type |
|---|---|
| שם לקוח | text input (required) |
| ח.פ | text input |
| קבוצה | text input (with autocomplete from existing group_name values) |
| כתובת | text input |
| טלפון | text input |
| מייל | email input |
| איש/אשת קשר | text input |
| סטטוס | toggle or select: פעיל / לא פעיל |
| הערות | textarea |

**Section 2 — תנאי הסכם**
| Field | Type |
|---|---|
| סוג הסכם | select: השמה / ריטיינר / ליווי / אחר |
| אחוז עמלה | number input (%) |
| בסיס משכורות | number input |
| חלוקת תשלום | text input (e.g. "30/70") |
| תקופת אחריות | number input (days) |
| תנאי תשלום | text input |
| מקדמה | text input |
| בלעדיות | checkbox |
| איש/אשת קשר להסכם | text input |
| מייל איש קשר | email input |
| טלפון איש קשר | text input |
| שם קובץ הסכם | text input |
| סטטוס הסכם | select: active / inactive / pending |
| הערות הסכם | textarea |

**Actions:**
- Edit button → entire card becomes editable
- Save → upserts both tables, closes card
- Cancel → discards changes
- Status toggle (active/inactive) available without entering full edit mode
- Delete button (with confirmation dialog)

---

## 6. Excel Import

Add an import button on the clients page. The import flow:

### Step 1 — File upload
Accept `.xlsx` files. Parse using a library already in the project (SheetJS / xlsx).

### Step 2 — Sheet & column mapping
The import must handle the two source sheets from the existing Excel:
- Sheet `פרטי לקוחות` → maps to client fields
- Sheet `תנאי הסכמים` → maps to agreement fields

**Column mapping for `פרטי לקוחות`:**
| Excel column | DB field |
|---|---|
| שם העסק | clients.name |
| שם איש הקשר | clients.contact_name |
| דואל | clients.email |
| נייד | clients.phone |
| מספר עסק | clients.tax_id |
| כתובת | clients.address |

**Column mapping for `תנאי הסכמים`:**
| Excel column | DB field |
|---|---|
| שם הלקוח | used to match client by name |
| סטטוס | clients.status (פעיל → active) |
| סוג הסכם | agreements.agreement_type |
| אחוז עמלה | agreements.commission_pct |
| בסיס משכורות | agreements.salary_base |
| חלוקת תשלום | agreements.payment_split |
| תקופת אחריות | agreements.warranty_days |
| תנאי תשלום | agreements.payment_terms |
| מקדמה | agreements.advance |
| בלעדיות | agreements.exclusivity (כן → true) |
| ח.פ | clients.tax_id (use as dedup key) |
| איש/אשת קשר | agreements.contact_name |
| מייל | agreements.contact_email |
| טלפון | agreements.contact_phone |
| שם קובץ הסכם | agreements.contract_file |

### Step 3 — Preview & dedup
- Show a preview table of records to be imported
- Highlight rows where `tax_id` already exists in the DB (will update, not duplicate)
- Highlight rows with no `tax_id` (will create new)
- Allow user to deselect rows before confirming

### Step 4 — Confirm import
- Upsert all selected rows (insert new, update existing by tax_id)
- Show success count and any errors
- Refresh the clients list
