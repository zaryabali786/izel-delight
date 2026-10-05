const { createClient } = require('@supabase/supabase-js');

/**
 * Supabase client using the SECRET key (for server-side / admin operations).
 * Never expose this client or key to the frontend.
 */
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

/**
 * Supabase client using the PUBLISHABLE key (anon key).
 * Safe to use for public-facing auth operations like signUp / signIn.
 */
const supabasePublic = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_PUBLISHABLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

module.exports = { supabaseAdmin, supabasePublic };
