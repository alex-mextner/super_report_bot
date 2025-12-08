/**
 * Standalone auth script for MTProto client
 * Run with: bun run src/listener/auth.ts
 */

import { TelegramClient } from "@mtcute/bun";

const API_ID = Number(process.env.API_ID);
const API_HASH = process.env.API_HASH;
const PHONE_NUMBER = process.env.PHONE_NUMBER;

if (!API_ID || !API_HASH) {
  console.error("Error: API_ID and API_HASH are required");
  console.error("Set them in .env file:");
  console.error("  API_ID=your_api_id");
  console.error("  API_HASH=your_api_hash");
  process.exit(1);
}

const client = new TelegramClient({
  apiId: API_ID,
  apiHash: API_HASH,
  storage: "userbot.session",
});

console.log("Starting MTProto authentication...");
console.log("You can authorize via phone number or QR code.\n");

async function main() {
  const user = await client.start({
    phone: () => PHONE_NUMBER || client.input("Enter phone number (with country code, e.g. +79001234567): "),
    code: () => client.input("Enter the code you received: "),
    password: () => client.input("Enter 2FA password (if enabled): "),
  });

  console.log(`\nSuccess! Logged in as ${user.displayName} (@${user.username || "no username"})`);
  console.log(`User ID: ${user.id}`);
  console.log("\nSession saved to userbot.session");
  console.log("You can now run the main bot with: bun run start");

  await client.destroy();
}

main().catch((err) => {
  console.error("Auth failed:", err);
  process.exit(1);
});
