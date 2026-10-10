import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl,supabaseAnonKey)

// Second client that never stores its session. Used when a signed-in user creates a login for
// someone else (staff accounts), so the sign-up doesn't replace the current session.
export const createDetachedClient = () => createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'catch-detached' },
})
