// ============================================================================
//  Supabase client
//  Fill in your project's URL and anon (public) key below — both are found
//  in Supabase → Project Settings → API. The anon key is safe to expose in
//  browser code; it is constrained by the Row Level Security policies in
//  schema.sql.
// ============================================================================

const SUPABASE_URL = "https://nljbbepcbwjdteoxjafv.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5samJiZXBjYndqZHRlb3hqYWZ2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY3MTA0ODQsImV4cCI6MjEwMjI4NjQ4NH0.u-cFr02_vPERva28YJ3wNteX5z8DH_-oNCGcK2WImzo";

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);