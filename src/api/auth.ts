import { createHmac } from "crypto";

const BOT_TOKEN = process.env.BOT_TOKEN || "";

/**
 * Validate Telegram WebApp initData
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
export function validateInitData(initData: string): boolean {
  if (!initData || !BOT_TOKEN) return false;

  try {
    const params = new URLSearchParams(initData);
    const hash = params.get("hash");
    if (!hash) return false;

    params.delete("hash");

    // Sort params alphabetically
    const dataCheckString = Array.from(params.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join("\n");

    // Create secret key
    const secretKey = createHmac("sha256", "WebAppData")
      .update(BOT_TOKEN)
      .digest();

    // Calculate expected hash
    const expectedHash = createHmac("sha256", secretKey)
      .update(dataCheckString)
      .digest("hex");

    return hash === expectedHash;
  } catch {
    return false;
  }
}

/**
 * Parse user from initData
 */
export function parseInitDataUser(initData: string): { id: number; first_name: string } | null {
  try {
    const params = new URLSearchParams(initData);
    const userJson = params.get("user");
    if (!userJson) return null;

    const user = JSON.parse(userJson);
    return {
      id: user.id,
      first_name: user.first_name || "User",
    };
  } catch {
    return null;
  }
}

/**
 * Parse language_code from initData user object
 */
export function parseInitDataLanguage(initData: string): string | null {
  try {
    const params = new URLSearchParams(initData);
    const userJson = params.get("user");
    if (!userJson) return null;

    const user = JSON.parse(userJson);
    return user.language_code || null;
  } catch {
    return null;
  }
}
