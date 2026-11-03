require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL || 'https://placeholder-instance.supabase.co';
const supabaseSecret = process.env.SUPABASE_SECRET_KEY || 'placeholder-secret-key-for-local-fallback';
const supabasePublishable = process.env.SUPABASE_PUBLISHABLE_KEY || 'placeholder-publishable-key';

/**
 * Supabase client using the SECRET key (for server-side / admin operations).
 * Never expose this client or key to the frontend.
 */
const supabaseAdmin = createClient(
  supabaseUrl,
  supabaseSecret,
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
  supabaseUrl,
  supabasePublishable,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

module.exports = { supabaseAdmin, supabasePublic };
