import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requiredEnv } from "@/lib/aws";

let supabaseClient: SupabaseClient | undefined;

/**
 * Server-only Supabase client using the service-role key, which bypasses RLS.
 * Never import this from client components; callers must scope every query
 * by session_id themselves (see lib/conversations.ts).
 */
export function getSupabaseClient(): SupabaseClient {
  if (!supabaseClient) {
    supabaseClient = createClient(requiredEnv("SUPABASE_URL"), requiredEnv("SUPABASE_SERVICE_ROLE_KEY"));
  }
  return supabaseClient;
}
