// Silent anonymous auth so we have a stable auth.users.id for the
// Google Drive App User Connector. The user never sees a login screen.
import { supabase } from "@/integrations/supabase/client";

let bootPromise: Promise<string | null> | null = null;

export async function ensureAuth(): Promise<string | null> {
  if (bootPromise) return bootPromise;
  bootPromise = (async () => {
    try {
      const { data: existing } = await supabase.auth.getSession();
      if (existing.session?.user?.id) return existing.session.user.id;
      const { data, error } = await supabase.auth.signInAnonymously();
      if (error) {
        console.warn("[auth] anonymous sign-in failed:", error.message);
        return null;
      }
      return data.user?.id ?? null;
    } catch (e) {
      console.warn("[auth] bootstrap failed:", e);
      return null;
    }
  })();
  return bootPromise;
}

export async function getCurrentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user?.id ?? null;
}
