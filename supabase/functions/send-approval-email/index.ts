// Supabase edge function: notify admins/administration that a recruiter created
// a transaction that needs approval.
//
// POST body: { transactionId, createdByName, clientName, serviceType, amount }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

Deno.serve(async (req) => {
  try {
    const { transactionId, createdByName, clientName, serviceType, amount } = await req.json()

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { data: recipients } = await supabase
      .from('profiles')
      .select('email, full_name')
      .in('role', ['admin', 'administration'])

    if (!recipients || recipients.length === 0) {
      return new Response(JSON.stringify({ ok: true, sent: 0 }), { status: 200 })
    }

    const RESEND_KEY = Deno.env.get('RESEND_API_KEY')!
    const appUrl = Deno.env.get('APP_URL') ?? 'https://app.banani-hr.com'

    const formattedAmount = new Intl.NumberFormat('he-IL', {
      style: 'currency',
      currency: 'ILS',
      maximumFractionDigits: 0,
    }).format(Number(amount ?? 0))

    let sent = 0
    const errors: string[] = []
    for (const r of recipients) {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${RESEND_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'BHR Console <noreply@banani-hr.com>',
          to: r.email,
          subject: `עסקה חדשה ממתינה לאישורך — ${clientName}`,
          html: `
            <div dir="rtl" style="font-family: sans-serif; max-width: 500px;">
              <h2 style="color:#7c3aed">עסקה חדשה ממתינה לאישור</h2>
              <p>שלום ${r.full_name},</p>
              <p>${createdByName ?? 'משתמש'} הזין עסקה חדשה הדורשת אישורך:</p>
              <table style="border-collapse:collapse; width:100%">
                <tr><td style="padding:4px 8px"><strong>לקוח:</strong></td><td>${clientName ?? ''}</td></tr>
                <tr><td style="padding:4px 8px"><strong>שירות:</strong></td><td>${serviceType ?? ''}</td></tr>
                <tr><td style="padding:4px 8px"><strong>סכום:</strong></td><td>${formattedAmount}</td></tr>
              </table>
              <p style="margin-top:16px">
                <a href="${appUrl}/transactions" style="background:#7c3aed;color:white;padding:10px 20px;text-decoration:none;border-radius:6px;display:inline-block">
                  אשר עסקה במערכת
                </a>
              </p>
              <p style="color:#888;font-size:11px;margin-top:24px">
                עסקה: ${transactionId}
              </p>
            </div>
          `,
        }),
      })
      if (res.ok) sent += 1
      else errors.push(`${r.email}: ${res.status}`)
    }

    return new Response(JSON.stringify({ ok: true, sent, errors }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})
