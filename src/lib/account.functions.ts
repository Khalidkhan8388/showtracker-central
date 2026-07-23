import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const deleteAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const userId = context.userId;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Delete storage objects belonging to this user (voice-notes bucket is user-prefixed).
    try {
      const { data: files } = await supabaseAdmin.storage
        .from("voice-notes")
        .list(userId, { limit: 1000 });
      if (files && files.length > 0) {
        await supabaseAdmin.storage
          .from("voice-notes")
          .remove(files.map((f) => `${userId}/${f.name}`));
      }
    } catch {
      // best-effort; continue
    }

    // Delete notes (RLS-owned rows will cascade for that user).
    await supabaseAdmin.from("voice_notes").delete().eq("user_id", userId);

    // Finally, remove the auth user.
    const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
