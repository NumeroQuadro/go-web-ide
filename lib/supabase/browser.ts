import { createBrowserClient } from "@supabase/ssr";
import { type SupabaseClient } from "@supabase/supabase-js";

import { getSupabasePublishableKey, getSupabaseUrl } from "./env";

export function createSupabaseBrowserClient(config?: {
  supabaseUrl: string;
  supabasePublishableKey: string;
}): SupabaseClient {
  if (config) {
    return createBrowserClient(config.supabaseUrl, config.supabasePublishableKey);
  }

  // Fallback for local/dev usage when values are inlined at build-time.
  return createBrowserClient(getSupabaseUrl(), getSupabasePublishableKey());
}
