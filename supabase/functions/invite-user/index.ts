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

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Invite user via Supabase Auth (sends invite email)
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
      data: { full_name, role: role || 'employee' },
    })

    if (error) {
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // The auth trigger (handle_new_user) auto-creates the profile row,
    // but we also ensure portal_token is set
    await admin.from('profiles').update({
      portal_token: crypto.randomUUID(),
    }).eq('id', data.user.id)

    return new Response(
      JSON.stringify({ success: true, user_id: data.user.id }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
