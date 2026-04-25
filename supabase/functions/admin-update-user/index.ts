// admin-update-user edge function — admin updates another user's
// full_name / email / role. Email change is immediate (no verification)
// because the admin has authority. Self-edit allowed for name/email but
// the existing /users self-demote guard still applies; this function
// will refuse to change `role` when caller_id === user_id.
//
// POST { user_id, full_name?, email?, role? }
// Auth: caller's JWT must resolve to a profile with role='admin'.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// @ts-expect-error Deno
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders })
  }

  // @ts-expect-error Deno
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  // @ts-expect-error Deno
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  // @ts-expect-error Deno
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!

  // 1. Authorize: the caller's bearer token must belong to a profile with
  //    role='admin'. We resolve the caller via getUser() against the user's
  //    JWT (passing it through to a fresh client) and then check their
  //    profile via service role.
  const authHeader = req.headers.get('Authorization') || ''
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!token) {
    return new Response(JSON.stringify({ error: 'missing Authorization' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
  const { data: callerData, error: callerErr } = await userClient.auth.getUser()
  if (callerErr || !callerData.user) {
    return new Response(JSON.stringify({ error: 'invalid token' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  const callerId = callerData.user.id

  const admin = createClient(supabaseUrl, serviceKey)
  const { data: callerProfile, error: profErr } = await admin
    .from('profiles')
    .select('id, role')
    .eq('id', callerId)
    .single()
  if (profErr || callerProfile?.role !== 'admin') {
    return new Response(JSON.stringify({ error: 'forbidden — admin role required' }), {
      status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // 2. Parse the request.
  let body: { user_id?: string; full_name?: string; email?: string; role?: string }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'invalid JSON body' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  const { user_id, full_name, email, role } = body
  if (!user_id || typeof user_id !== 'string') {
    return new Response(JSON.stringify({ error: 'user_id required' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  if (role && !['admin', 'administration', 'recruiter'].includes(role)) {
    return new Response(JSON.stringify({ error: 'invalid role' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // 3. Self-demote guard: caller cannot change their own role.
  if (role && user_id === callerId) {
    return new Response(JSON.stringify({ error: 'cannot change your own role' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const updatedFields: string[] = []
  const profileUpdate: Record<string, unknown> = {}

  // 4. Email change via auth admin API first — this is the path that can
  //    return 'email already in use'. If it fails we surface that and
  //    skip the profile update.
  if (typeof email === 'string' && email.trim()) {
    const cleanEmail = email.trim().toLowerCase()
    const { error: authErr } = await admin.auth.admin.updateUserById(user_id, { email: cleanEmail })
    if (authErr) {
      // Map known Supabase errors to friendlier Hebrew text.
      const msg = (authErr.message || '').toLowerCase()
      let userMsg: string = authErr.message || 'email update failed'
      if (msg.includes('already') && (msg.includes('registered') || msg.includes('exists') || msg.includes('use'))) {
        userMsg = 'הכתובת תפוסה'
      } else if (msg.includes('invalid') && msg.includes('email')) {
        userMsg = 'כתובת המייל לא תקינה'
      }
      return new Response(JSON.stringify({ error: userMsg, raw: authErr.message }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    profileUpdate.email = cleanEmail
    updatedFields.push('email')
  }

  if (typeof full_name === 'string' && full_name.trim()) {
    profileUpdate.full_name = full_name.trim()
    updatedFields.push('full_name')
  }
  if (typeof role === 'string') {
    profileUpdate.role = role
    updatedFields.push('role')
  }

  if (Object.keys(profileUpdate).length > 0) {
    const { error: updErr } = await admin
      .from('profiles')
      .update(profileUpdate)
      .eq('id', user_id)
    if (updErr) {
      return new Response(JSON.stringify({ error: 'profile update failed', detail: updErr.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
  }

  return new Response(
    JSON.stringify({ success: true, updated_fields: updatedFields }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  )
})
