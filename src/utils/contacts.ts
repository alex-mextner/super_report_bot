export interface ParsedContact {
  type: "phone" | "username" | "telegram_link" | "whatsapp";
  value: string;
}

export function parseContacts(text: string): ParsedContact[] {
  const contacts: ParsedContact[] = [];
  const seen = new Set<string>();

  // Phone numbers: +7/8 xxx xxx xx xx
  const phonePattern =
    /(?:\+7|8)[\s\-]?\(?\d{3}\)?[\s\-]?\d{3}[\s\-]?\d{2}[\s\-]?\d{2}/g;
  let match;
  while ((match = phonePattern.exec(text)) !== null) {
    const normalized = normalizePhone(match[0]);
    if (!seen.has(normalized)) {
      seen.add(normalized);
      contacts.push({ type: "phone", value: normalized });
    }
  }

  // Telegram usernames: @username
  const usernamePattern = /@([a-zA-Z][a-zA-Z0-9_]{4,31})\b/g;
  while ((match = usernamePattern.exec(text)) !== null) {
    const value = `@${match[1]}`;
    if (!seen.has(value)) {
      seen.add(value);
      contacts.push({ type: "username", value });
    }
  }

  // Telegram links: t.me/xxx, tg://
  const tgLinkPattern =
    /(?:https?:\/\/)?t\.me\/(?:\+|joinchat\/)?([a-zA-Z0-9_]+)/gi;
  while ((match = tgLinkPattern.exec(text)) !== null) {
    const value = match[0].startsWith("http") ? match[0] : `https://${match[0]}`;
    if (!seen.has(value)) {
      seen.add(value);
      contacts.push({ type: "telegram_link", value });
    }
  }

  // WhatsApp: wa.me/xxx
  const waPattern = /(?:https?:\/\/)?wa\.me\/(\d+)/gi;
  while ((match = waPattern.exec(text)) !== null) {
    const value = match[0].startsWith("http") ? match[0] : `https://${match[0]}`;
    if (!seen.has(value)) {
      seen.add(value);
      contacts.push({ type: "whatsapp", value });
    }
  }

  return contacts;
}

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("8") && digits.length === 11) {
    return "+7" + digits.slice(1);
  }
  if (digits.startsWith("7") && digits.length === 11) {
    return "+" + digits;
  }
  return phone;
}
