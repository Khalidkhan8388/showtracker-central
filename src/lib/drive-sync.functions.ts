// Server functions for Google Drive backup sync.
// - Stores per-user OAuth connection key encrypted in public.app_user_connections
// - Uploads / downloads a single "braintape-backup.json" in Drive appDataFolder
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  authorizeAppUserOAuth,
  callAsAppUser,
  disconnectAppUser,
} from "@/integrations/lovable/appUserConnector";

const GATEWAY_BASE_URL = "https://connector-gateway.lovable.dev";
const CONNECTOR_ID = "google_drive";
const BACKUP_FILENAME = "braintape-backup.json";
const SCOPES = [
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/drive.appdata",
];

async function getKey(userId: string): Promise<string | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { decryptConnectionKey } = await import("@/lib/connectionKeyCrypto.server");
  const { data, error } = await supabaseAdmin
    .from("app_user_connections")
    .select("connection_key_ciphertext")
    .eq("user_id", userId)
    .eq("connector_id", CONNECTOR_ID)
    .maybeSingle();
  if (error) throw error;
  return data ? decryptConnectionKey(data.connection_key_ciphertext) : null;
}

async function findBackupFileId(connectionAPIKey: string): Promise<string | null> {
  const res = await callAsAppUser({
    gatewayBaseUrl: GATEWAY_BASE_URL,
    connectionAPIKey,
    connectorId: CONNECTOR_ID,
    path: `/drive/v3/files?spaces=appDataFolder&q=${encodeURIComponent(
      `name='${BACKUP_FILENAME}' and trashed=false`,
    )}&fields=files(id,modifiedTime,size)`,
  });
  if (!res.ok) throw new Error(`Drive list failed (${res.status}): ${await res.text()}`);
  const body = (await res.json()) as { files?: Array<{ id: string }> };
  return body.files?.[0]?.id ?? null;
}

// ============ Server fns ============

export const startDriveConnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((targetOrigin: string) => z.string().url().parse(targetOrigin))
  .handler(async ({ data: targetOrigin, context }) => {
    const clientKey = process.env.GOOGLE_DRIVE_APP_USER_CONNECTOR_CLIENT_API_KEY;
    if (!clientKey) throw new Error("Google Drive connector client not configured.");
    const { authorizationUrl } = await authorizeAppUserOAuth({
      gatewayBaseUrl: GATEWAY_BASE_URL,
      connectorId: CONNECTOR_ID,
      appUserId: context.userId,
      clientAPIKey: clientKey,
      returnUrl: targetOrigin,
      responseMode: "web_message",
      webMessageTargetOrigin: targetOrigin,
      credentialsConfiguration: { scopes: SCOPES },
    });
    return { authorizationUrl };
  });

export const saveDriveConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { connectionAPIKey: string }) =>
    z.object({ connectionAPIKey: z.string().min(1) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { encryptConnectionKey } = await import("@/lib/connectionKeyCrypto.server");
    const { error } = await supabaseAdmin.from("app_user_connections").upsert(
      {
        user_id: context.userId,
        connector_id: CONNECTOR_ID,
        connection_key_ciphertext: encryptConnectionKey(data.connectionAPIKey),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,connector_id" },
    );
    if (error) throw error;
    return { ok: true };
  });

export const getDriveStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const key = await getKey(context.userId);
    if (!key) return { connected: false as const };
    // Try to fetch remote backup metadata (also validates the key still works)
    try {
      const res = await callAsAppUser({
        gatewayBaseUrl: GATEWAY_BASE_URL,
        connectionAPIKey: key,
        connectorId: CONNECTOR_ID,
        path: `/drive/v3/files?spaces=appDataFolder&q=${encodeURIComponent(
          `name='${BACKUP_FILENAME}' and trashed=false`,
        )}&fields=files(id,modifiedTime,size)`,
      });
      if (!res.ok) return { connected: true as const, remote: null };
      const body = (await res.json()) as {
        files?: Array<{ id: string; modifiedTime?: string; size?: string }>;
      };
      const f = body.files?.[0];
      return {
        connected: true as const,
        remote: f
          ? { id: f.id, modifiedTime: f.modifiedTime ?? null, size: f.size ? Number(f.size) : null }
          : null,
      };
    } catch {
      return { connected: true as const, remote: null };
    }
  });

export const disconnectDrive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const key = await getKey(context.userId);
    if (key) {
      try {
        await disconnectAppUser({
          gatewayBaseUrl: GATEWAY_BASE_URL,
          connectionAPIKey: key,
          connectorId: CONNECTOR_ID,
        });
      } catch (e) {
        console.warn("[drive] gateway disconnect failed:", e);
      }
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("app_user_connections")
      .delete()
      .eq("user_id", context.userId)
      .eq("connector_id", CONNECTOR_ID);
    return { ok: true };
  });

// Upload a backup JSON string. Overwrites existing backup file.
export const uploadDriveBackup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { json: string }) =>
    z.object({ json: z.string().min(2) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const key = await getKey(context.userId);
    if (!key) throw new Error("Google Drive is not connected.");
    const existingId = await findBackupFileId(key);
    const boundary = `braintape-${Math.random().toString(36).slice(2)}`;
    const metadata = existingId
      ? { name: BACKUP_FILENAME }
      : { name: BACKUP_FILENAME, parents: ["appDataFolder"] };
    const body =
      `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: application/json\r\n\r\n` +
      `${data.json}\r\n` +
      `--${boundary}--`;
    const path = existingId
      ? `/upload/drive/v3/files/${existingId}?uploadType=multipart&fields=id,modifiedTime,size`
      : `/upload/drive/v3/files?uploadType=multipart&fields=id,modifiedTime,size`;
    const res = await callAsAppUser({
      gatewayBaseUrl: GATEWAY_BASE_URL,
      connectionAPIKey: key,
      connectorId: CONNECTOR_ID,
      path,
      init: {
        method: existingId ? "PATCH" : "POST",
        headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
        body,
      },
    });
    if (!res.ok) throw new Error(`Drive upload failed (${res.status}): ${await res.text()}`);
    const out = (await res.json()) as { id: string; modifiedTime?: string; size?: string };
    return {
      id: out.id,
      modifiedTime: out.modifiedTime ?? new Date().toISOString(),
      size: out.size ? Number(out.size) : data.json.length,
    };
  });

// Returns { modifiedTime, json } — the backup content as raw JSON.
export const downloadDriveBackup = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const key = await getKey(context.userId);
    if (!key) throw new Error("Google Drive is not connected.");
    const listRes = await callAsAppUser({
      gatewayBaseUrl: GATEWAY_BASE_URL,
      connectionAPIKey: key,
      connectorId: CONNECTOR_ID,
      path: `/drive/v3/files?spaces=appDataFolder&q=${encodeURIComponent(
        `name='${BACKUP_FILENAME}' and trashed=false`,
      )}&fields=files(id,modifiedTime)`,
    });
    if (!listRes.ok) throw new Error(`Drive list failed (${listRes.status}): ${await listRes.text()}`);
    const list = (await listRes.json()) as {
      files?: Array<{ id: string; modifiedTime?: string }>;
    };
    const f = list.files?.[0];
    if (!f) return { found: false as const };
    const dl = await callAsAppUser({
      gatewayBaseUrl: GATEWAY_BASE_URL,
      connectionAPIKey: key,
      connectorId: CONNECTOR_ID,
      path: `/drive/v3/files/${f.id}?alt=media`,
    });
    if (!dl.ok) throw new Error(`Drive download failed (${dl.status}): ${await dl.text()}`);
    const json = await dl.text();
    return { found: true as const, modifiedTime: f.modifiedTime ?? null, json };
  });
