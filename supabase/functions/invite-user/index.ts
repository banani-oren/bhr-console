import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { email, full_name, role } = await req.json()

    if (!email || !full_name) {
      return new Response(
        JSON.stringify({ error: 'email and full_name are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const resendKey = Deno.env.get('RESEND_API_KEY')!

    const admin = createClient(supabaseUrl, serviceKey)

    // 1. Generate an invite link via Supabase Admin (creates user, does NOT send email)
    const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
      type: 'invite',
      email,
      options: {
        data: { full_name, role: role || 'employee' },
      },
    })

    if (linkError) {
      return new Response(
        JSON.stringify({ error: linkError.message }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const userId = linkData.user?.id
    const actionLink = linkData.properties?.action_link

    if (!userId || !actionLink) {
      return new Response(
        JSON.stringify({ error: 'Failed to generate invite link' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 2. Ensure profile row has portal_token (auth trigger creates profile automatically)
    await admin.from('profiles').update({
      portal_token: crypto.randomUUID(),
      full_name,
      role: role || 'employee',
    }).eq('id', userId)

    // 3. Send the invite email via Resend HTTP API
    const emailHtml = `
      <!DOCTYPE html>
      <html dir="rtl" lang="he">
      <body style="font-family: system-ui, -apple-system, sans-serif; background: #f9f5ff; padding: 40px 20px;">
        <div style="max-width: 560px; margin: 0 auto; background: white; border-radius: 12px; padding: 32px; border: 1px solid #e9d5ff;">
          <h1 style="color: #7c3aed; margin: 0 0 16px 0; font-size: 22px;">ברוכים הבאים ל-BHR Console</h1>
          <p style="color: #374151; font-size: 15px; line-height: 1.6;">שלום ${full_name},</p>
          <p style="color: #374151; font-size: 15px; line-height: 1.6;">הוזמנת להצטרף למערכת BHR Console. לחץ על הקישור הבא כדי להגדיר סיסמה ולהתחבר:</p>
          <div style="text-align: center; margin: 32px 0;">
            <a href="${actionLink}" style="display: inline-block; background: #7c3aed; color: white; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600;">הגדר סיסמה והתחבר</a>
          </div>
          <p style="color: #6b7280; font-size: 13px; line-height: 1.5;">אם הכפתור לא עובד, העתק את הקישור הבא לדפדפן:</p>
          <p style="color: #6b7280; font-size: 12px; word-break: break-all; direction: ltr; text-align: left;">${actionLink}</p>
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 32px 0;">
          <p style="color: #9ca3af; font-size: 12px;">BHR Console — מערכת ניהול פיננסי</p>
        </div>
      </body>
      </html>
    `

    // The user + profile are now created. The invite is considered successful
    // at this point — email delivery is a secondary concern because the Resend
    // free tier (onboarding@resend.dev sender) only reaches the Resend account
    // owner. We treat a send failure as a warning, not a hard error, so the
    // admin UI still advances (user appears in /users and /team immediately),
    // and the admin can copy the portal link or trigger password reset manually.
    let emailSent = false
    let emailError: string | null = null
    let emailId: string | null = null

    try {
      const resendRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'BHR Console <onboarding@resend.dev>',
          to: email,
          subject: 'הוזמנת להצטרף ל-BHR Console',
          html: emailHtml,
        }),
      })

      const resendData = await resendRes.json()
      if (resendRes.ok) {
        emailSent = true
        emailId = resendData.id ?? null
      } else {
        emailError = resendData?.message || resendData?.error || `HTTP ${resendRes.status}`
      }
    } catch (err) {
      emailError = err instanceof Error ? err.message : 'Unknown email send error'
    }

    return new Response(
      JSON.stringify({
        success: true,
        user_id: userId,
        email_sent: emailSent,
        email_id: emailId,
        email_warning: emailError,
        action_link: actionLink,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
