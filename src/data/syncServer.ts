// The account server every copy of the app syncs through (Supabase).
// Both values are public by design: the anon key only lets a signed-in user
// reach their own rows (row level security in supabase/schema.sql).
export const SYNC_SERVER_URL = "";
export const SYNC_SERVER_ANON_KEY = "";
