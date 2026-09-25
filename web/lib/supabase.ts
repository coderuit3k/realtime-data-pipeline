import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requiredEnv } from "@/lib/aws";

let supabaseClient: SupabaseClient | undefined;

export function getSupabaseClient(): SupabaseClient {
  if (!supabaseClient) {
    supabaseClient = createClient(requiredEnv("SUPABASE_URL"), requiredEnv("SUPABASE_SERVICE_ROLE_KEY"));
  }
  return supabaseClient;
}
