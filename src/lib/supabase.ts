// Supabase not used in this version
// Keeping this file for future integration if needed
export const supabase = null;
export const isSupabaseConfigured = () => false;
interface SupabaseClient {}
export function getSupabase(): SupabaseClient {
  throw new Error('Supabase is not configured.');
}
