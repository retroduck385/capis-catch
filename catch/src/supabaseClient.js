import {createClient} from '@supabase/supabase-js'

const {SUPABASE_URL, SUPABASE_ANON_KEY} = import.meta.env

const supabaseUrl = 'SUPABASE_URL'
const supabaseAnonKey = 'SUPABASE_ANON_KEY'

export const supabase = createClient(supabaseUrl,supabaseAnonKey)
