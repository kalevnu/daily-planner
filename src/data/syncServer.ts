// The account server every copy of the app syncs through (Supabase).
// Both values are public by design: the publishable key only lets a
// signed-in user reach their own rows (row level security in
// supabase/schema.sql).
export const SYNC_SERVER_URL = "https://uxlzxjbpqqluqxumskvi.supabase.co";
export const SYNC_SERVER_ANON_KEY = "sb_publishable_FZUi1Lc0pjJxWoVzC6D8zg_AbMACd6s";
