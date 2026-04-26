import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://ijxdbhufamxvokotmsdi.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlqeGRiaHVmYW14dm9rb3Rtc2RpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY4Nzc4NTYsImV4cCI6MjA5MjQ1Mzg1Nn0.NxdqNSDayqdEnAqO25EePmuCfssrtAWM9Lo1Cw1cXRA'

export const supabase = createClient(supabaseUrl, supabaseKey)
