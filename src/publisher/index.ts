/**
 * Publisher Module
 *
 * Handles publishing messages to Telegram groups from user's account.
 * Uses MTProto (user account) to post messages.
 */

import { TelegramClient } from "@mtcute/bun";
import { mkdirSync } from "fs";
import { queries } from "../db/index.ts";
import { botLog } from "../logger.ts";

// Ensure sessions directory exists
mkdirSync("sessions", { recursive: true });

const API_ID = Number(process.env.API_ID);
const API_HASH = process.env.API_HASH ?? "";

if (!API_ID || !API_HASH) {
  botLog.warn("API_ID/API_HASH not set, publisher disabled");
}

// Active clients cache (telegramId -> client)
const activeClients = new Map<number, TelegramClient>();

// Pending auth sessions (telegramId -> { client, phone, phoneCodeHash })
interface PendingAuth {
  client: TelegramClient;
  phone: string;
  phoneCodeHash: string;
}
const pendingAuths = new Map<number, PendingAuth>();

/**
 * Create a new TelegramClient for user session
 */
function createClient(userId: number): TelegramClient {
  return new TelegramClient({
    apiId: API_ID,
    apiHash: API_HASH,
    storage: `sessions/user_${userId}.session`,
  });
}

/**
 * Get or create client for user from saved session
 */
export async function getClientForUser(telegramId: number): Promise<TelegramClient | null> {
  // Check cache
  const cached = activeClients.get(telegramId);
  if (cached) {
    return cached;
  }

  // Check if user has session
  const session = queries.getUserSession(telegramId);
  if (!session || !session.is_active || !session.session_string) {
    return null;
  }

  try {
    const client = createClient(telegramId);

    // Import saved session
    await client.importSession(session.session_string);

    // Verify session is valid by getting user info
    const me = await client.start({
      phone: () => { throw new Error("Session invalid"); },
      code: () => { throw new Error("Session invalid"); },
      password: () => { throw new Error("Session invalid"); },
    });

    if (!me) {
      botLog.warn({ telegramId }, "Session invalid, deactivating");
      queries.deactivateUserSession(telegramId);
      return null;
    }

    // Cache and update last used
    activeClients.set(telegramId, client);
    queries.updateSessionLastUsed(telegramId);

    botLog.info({ telegramId, userId: me.id }, "User session restored");
    return client;
  } catch (error) {
    botLog.error({ error, telegramId }, "Failed to restore user session");
    queries.deactivateUserSession(telegramId);
    return null;
  }
}

/**
 * Start user authorization flow - sends code to user's Telegram
 */
export async function startUserAuth(
  telegramId: number,
  phone: string
): Promise<{ success: true } | { error: string }> {
  if (!API_ID || !API_HASH) {
    return { error: "Publisher not configured (API_ID/API_HASH missing)" };
  }

  try {
    const client = createClient(telegramId);

    // Connect to Telegram
    await client.connect();

    // Send verification code
    botLog.info({ telegramId, phone: phone.slice(0, 5) + "***" }, "Sending auth code");
    const sentCode = await client.sendCode({ phone });

    // sendCode returns User if already authorized, SentCode otherwise
    if ("phoneCodeHash" in sentCode) {
      // Store pending auth with phoneCodeHash
      pendingAuths.set(telegramId, {
        client,
        phone,
        phoneCodeHash: sentCode.phoneCodeHash,
      });

      botLog.info({ telegramId }, "Auth code sent successfully");
      return { success: true };
    } else {
      // Already authorized - save session
      const sessionString = await client.exportSession();
      queries.saveUserSession(telegramId, phone, sessionString);
      activeClients.set(telegramId, client);

      botLog.info({ telegramId, userId: sentCode.id }, "User already authorized");
      return { success: true };
    }
  } catch (error) {
    botLog.error({ error, telegramId }, "Failed to start auth");
    return { error: error instanceof Error ? error.message : "Failed to start auth" };
  }
}

/**
 * Check if user has pending auth
 */
export function hasPendingAuth(telegramId: number): boolean {
  return pendingAuths.has(telegramId);
}

/**
 * Get pending auth phone
 */
export function getPendingAuthPhone(telegramId: number): string | null {
  return pendingAuths.get(telegramId)?.phone ?? null;
}

/**
 * Complete user authorization with code (and optional password)
 */
export async function completeUserAuth(
  telegramId: number,
  code: string,
  password?: string
): Promise<{ success: true } | { error: string; needsPassword?: boolean }> {
  const pending = pendingAuths.get(telegramId);
  if (!pending) {
    return { error: "No pending auth, start again with /publish" };
  }

  try {
    const { client, phone, phoneCodeHash } = pending;

    let user;

    if (password) {
      // Complete 2FA
      user = await client.checkPassword(password);
    } else {
      // Sign in with code
      user = await client.signIn({
        phone,
        phoneCodeHash,
        phoneCode: code,
      });
    }

    // Success! Export and save session
    const sessionString = await client.exportSession();
    queries.saveUserSession(telegramId, phone, sessionString);

    // Move to active clients
    activeClients.set(telegramId, client);
    pendingAuths.delete(telegramId);

    botLog.info({ telegramId, userId: user.id }, "User authorized successfully");
    return { success: true };
  } catch (error: unknown) {
    // Check for 2FA requirement
    if (error && typeof error === "object" && "message" in error) {
      const msg = (error as { message: string }).message;
      if (msg.includes("SESSION_PASSWORD_NEEDED") || msg.includes("password")) {
        return { error: "2FA password required", needsPassword: true };
      }
    }

    botLog.error({ error, telegramId }, "Failed to complete auth");
    // Don't delete pending on error - user might retry with password
    return { error: error instanceof Error ? error.message : "Auth failed" };
  }
}

/**
 * Cancel pending auth
 */
export function cancelPendingAuth(telegramId: number): void {
  const pending = pendingAuths.get(telegramId);
  if (pending) {
    pending.client.destroy().catch(() => {});
    pendingAuths.delete(telegramId);
  }
}

/**
 * Send text message to a group from user's account
 */
export async function sendTextAsUser(
  telegramId: number,
  groupId: number,
  text: string
): Promise<{ success: true; messageId: number } | { error: string }> {
  const client = await getClientForUser(telegramId);
  if (!client) {
    return { error: "No active session. Authorize with /publish first." };
  }

  try {
    // Resolve the group peer
    const peer = await client.resolvePeer(groupId);

    // Send text message using mtcute's sendText method
    const result = await client.sendText(peer, text);

    return { success: true, messageId: result.id };
  } catch (error) {
    botLog.error({ error, telegramId, groupId }, "Failed to send message as user");
    return { error: error instanceof Error ? error.message : "Send failed" };
  }
}

/**
 * Send message with photos to a group from user's account
 * @param photoFileIds - Bot API file IDs (will be converted)
 */
export async function sendMediaAsUser(
  telegramId: number,
  groupId: number,
  text: string,
  photoFileIds: string[]
): Promise<{ success: true; messageId: number } | { error: string }> {
  const client = await getClientForUser(telegramId);
  if (!client) {
    return { error: "No active session. Authorize with /publish first." };
  }

  try {
    const peer = await client.resolvePeer(groupId);

    if (photoFileIds.length === 0) {
      // No photos - just send text
      const result = await client.sendText(peer, text);
      return { success: true, messageId: result.id };
    }

    if (photoFileIds.length === 1) {
      // Single photo with caption
      const { InputMedia } = await import("@mtcute/bun");
      const result = await client.sendMedia(peer, InputMedia.auto(photoFileIds[0]!, { caption: text }));
      return { success: true, messageId: result.id };
    }

    // Multiple photos - use media group
    // Caption goes on first photo only
    const { InputMedia } = await import("@mtcute/bun");
    const mediaItems = photoFileIds.map((fileId, index) =>
      InputMedia.auto(fileId, index === 0 ? { caption: text } : undefined)
    );

    const results = await client.sendMediaGroup(peer, mediaItems);
    const firstResult = results[0];
    return { success: true, messageId: firstResult?.id ?? 0 };
  } catch (error) {
    botLog.error({ error, telegramId, groupId, photoCount: photoFileIds.length }, "Failed to send media as user");
    return { error: error instanceof Error ? error.message : "Send failed" };
  }
}

/**
 * Disconnect and remove user client
 */
export async function disconnectUser(telegramId: number): Promise<void> {
  const client = activeClients.get(telegramId);
  if (client) {
    try {
      await client.destroy();
    } catch {
      // Ignore close errors
    }
    activeClients.delete(telegramId);
  }
  queries.deactivateUserSession(telegramId);
}

/**
 * Check if user has active session
 */
export function hasActiveSession(telegramId: number): boolean {
  const session = queries.getUserSession(telegramId);
  return !!session && session.is_active === 1;
}

/**
 * Check if publisher is enabled
 */
export function isPublisherEnabled(): boolean {
  return !!(API_ID && API_HASH);
}

// Re-export worker functions
export {
  startPublicationWorker,
  stopPublicationWorker,
  startPublication,
  triggerPublicationProcessing,
} from "./worker.ts";
