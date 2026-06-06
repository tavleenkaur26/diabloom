import { createClient } from '@supabase/supabase-js'

const supabaseUrl  = 'your_project_url_here'
const supabaseKey  = 'your_anon_key_here'

export const supabase = createClient(supabaseUrl, supabaseKey)