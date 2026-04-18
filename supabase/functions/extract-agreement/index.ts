// Edge function: extract-agreement
//
// Receives { storage_path }, downloads the PDF from the client-agreements
// bucket, and sends it to Claude as a document content block. Claude OCRs
// scanned PDFs and handles RTL Hebrew natively — no local pdf-parse path.
//
// Returns { extracted, document_kind, fuzzy_matches }.
//
// CORS: allows any origin (tightened at the site level by RequireRole gates).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

const SYSTEM_PROMPT = `You are extracting structured fields from a Hebrew-language recruitment-services
agreement between Banani HR (the supplier) and a client business. The input is a
single PDF (possibly scanned). Some PDFs in this folder are NOT agreements but
vendor-onboarding forms filled out by Banani HR — you must recognize those and
return {"document_kind": "vendor_form"} with no agreement fields.

Return ONLY a JSON object matching this schema, no prose:

{
  "document_kind": "agreement" | "vendor_form" | "other",
  "matched_client_name": string | null,
  "company_id": string | null,
  "client_address": string | null,
  "agreement_type": "השמה" | "הד האנטינג" | "גיוס מסה" | "הדרכה" | "ריטיינר" | "שעתי" | "אחר" | null,
  "commission_percent": number | null,
  "salary_basis": string | null,
  "warranty_days": integer | null,
  "payment_terms": string | null,
  "payment_split": string | null,
  "advance": string | null,
  "exclusivity": boolean | null,
  "non_solicit_months": integer | null,
  "hourly_rate": number | null,
  "notes": string | null
}

Hebrew patterns:
- Business name appears after "בין" / "לבין" — CLIENT is whichever party is NOT Banani HR.
- "ח.פ." / "מ.ע." → followed by 9-digit company id.
- "100% משכורת חודש ראשון" → commission_percent=100, salary_basis="משכורת אחת".
- "שיעור עמלה של 90%" → commission_percent=90.
- "מקדמה בסך X ₪" → advance="X ₪".
- "תקופת אחריות" + "60 ימים" → warranty_days=60.
- "שוטף+30" → payment_terms="שוטף+30".
- "בלעדיות מלאה" → exclusivity=true.
- "לא יפנה ... ל-X חודשים מתום תקופת ההסכם" → non_solicit_months=X.

Anti-hallucination:
- Never output 039230214 as company_id (that is Banani HR's own number).
- If a field is unreadable, null it and mention in "notes".
- If the PDF is a vendor form, return document_kind="vendor_form" with all agreement fields null.
- If document_kind="agreement" and matched_client_name is null, return document_kind="other" instead.`

function cors(origin: string | null) {
  return {
    'Access-Control-Allow-Origin': origin ?? '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, content-type, apikey',
  }
}

// Dice coefficient over 3-grams.
function dice(a: string, b: string): number {
  const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase()
  const na = norm(a)
  const nb = norm(b)
  if (na.length < 3 || nb.length < 3) return na === nb ? 1 : 0
  const grams = (s: string) => {
    const set = new Set<string>()
    for (let i = 0; i <= s.length - 3; i++) set.add(s.slice(i, i + 3))
    return set
  }
  const ga = grams(na)
  const gb = grams(nb)
  let inter = 0
  for (const g of ga) if (gb.has(g)) inter += 1
  return (2 * inter) / (ga.size + gb.size)
}

function toBase64(bytes: Uint8Array): string {
  let s = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)) as number[])
  }
  // @ts-expect-error Deno has btoa
  return btoa(s)
}

// @ts-expect-error Deno global
Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin')
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: cors(origin) })
  }
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: cors(origin) })
  }

  try {
    // @ts-expect-error Deno global
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
    // @ts-expect-error Deno global
    const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    // @ts-expect-error Deno global
    const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!
    // @ts-expect-error Deno global
    const MODEL = Deno.env.get('AGREEMENT_EXTRACTION_MODEL') ?? 'claude-sonnet-4-6'

    if (!ANTHROPIC_API_KEY) {
      return new Response(
        JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }),
        { status: 500, headers: { ...cors(origin), 'content-type': 'application/json' } },
      )
    }

    const body = await req.json()
    const storage_path = (body?.storage_path as string | undefined) ?? ''
    if (!storage_path) {
      return new Response(
        JSON.stringify({ error: 'storage_path is required' }),
        { status: 400, headers: { ...cors(origin), 'content-type': 'application/json' } },
      )
    }

    const sb = createClient(SUPABASE_URL, SERVICE_KEY)
    const { data: fileData, error: dlErr } = await sb.storage
      .from('client-agreements')
      .download(storage_path)
    if (dlErr || !fileData) {
      return new Response(
        JSON.stringify({ error: 'download failed', detail: dlErr?.message }),
        { status: 500, headers: { ...cors(origin), 'content-type': 'application/json' } },
      )
    }
    const bytes = new Uint8Array(await fileData.arrayBuffer())
    const base64 = toBase64(bytes)

    const anthropicBody = {
      model: MODEL,
      max_tokens: 1024,
      temperature: 0,
      system: SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: base64 },
          },
          {
            type: 'text',
            text: 'Extract per the system prompt. Return ONLY the JSON object.',
          },
        ],
      }],
    }

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify(anthropicBody),
    })

    if (!res.ok) {
      const errBody = await res.text()
      return new Response(
        JSON.stringify({ error: 'anthropic api error', status: res.status, detail: errBody }),
        { status: 500, headers: { ...cors(origin), 'content-type': 'application/json' } },
      )
    }

    const payload = await res.json()
    const textBlock = (payload?.content ?? []).find((b: unknown) => {
      return typeof b === 'object' && b !== null && (b as { type?: string }).type === 'text'
    }) as { text?: string } | undefined
    let raw = (textBlock?.text ?? '').trim()

    // Strip code fences.
    if (raw.startsWith('```')) {
      raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
    }

    let extracted: Record<string, unknown> = {}
    try {
      extracted = JSON.parse(raw)
    } catch {
      return new Response(
        JSON.stringify({ error: 'Claude response not valid JSON', raw }),
        { status: 500, headers: { ...cors(origin), 'content-type': 'application/json' } },
      )
    }

    const documentKind = (extracted['document_kind'] as string | null) ?? 'other'

    // Extraction failure guard.
    if (documentKind === 'agreement' && !extracted['matched_client_name']) {
      ;(extracted as Record<string, unknown>)['document_kind'] = 'other'
    }

    // Fuzzy-match client name against clients.name.
    let fuzzy_matches: Array<{ client_id: string; name: string; score: number }> = []
    const matched = (extracted['matched_client_name'] as string | null) ?? null
    if (matched) {
      const { data: all, error: cErr } = await sb.from('clients').select('id, name')
      if (!cErr && all) {
        fuzzy_matches = (all as Array<{ id: string; name: string }>)
          .map((c) => ({ client_id: c.id, name: c.name, score: dice(matched, c.name) }))
          .filter((x) => x.score > 0.6)
          .sort((a, b) => b.score - a.score)
          .slice(0, 3)
      }
    }

    return new Response(
      JSON.stringify({
        extracted,
        document_kind: extracted['document_kind'],
        fuzzy_matches,
      }),
      { status: 200, headers: { ...cors(origin), 'content-type': 'application/json' } },
    )
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'unhandled', detail: String(err) }),
      { status: 500, headers: { ...cors(origin), 'content-type': 'application/json' } },
    )
  }
})
