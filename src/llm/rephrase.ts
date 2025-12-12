/**
 * Text Rephrasing for Publications
 *
 * Uses DeepSeek to rephrase ad text to avoid spam detection.
 * Each group gets a unique version of the same message.
 * Adapts to group's posting style if analysis is provided.
 */

import { chatWithDeepSeek, type ChatMessage } from "./deepseek.ts";
import { llmLog } from "../logger.ts";

export interface RephraseResult {
  text: string;
  success: boolean;
  error?: string;
}

export interface GroupStyleContext {
  groupName: string;
  avgLength?: number;
  hasEmojis?: boolean;
  hasHashtags?: boolean;
  styleHints?: string;
  sampleMessages?: string[];
}

/**
 * Rephrase ad text to create a unique version
 * Preserves meaning, contact info, and prices
 * Adapts to group style if provided
 */
export async function rephraseAdText(
  originalText: string,
  styleContext?: GroupStyleContext
): Promise<RephraseResult> {
  // Build style guidance based on group analysis
  let styleGuidance = "";
  if (styleContext) {
    const parts: string[] = [];

    if (styleContext.styleHints) {
      parts.push(`В этой группе ${styleContext.styleHints}.`);
    }

    if (styleContext.avgLength) {
      if (styleContext.avgLength < 200) {
        parts.push("Сделай текст короче и лаконичнее.");
      } else if (styleContext.avgLength > 500) {
        parts.push("Можно сделать текст подробнее.");
      }
    }

    if (styleContext.hasEmojis === false) {
      parts.push("НЕ используй эмодзи — в этой группе их не любят.");
    } else if (styleContext.hasEmojis === true) {
      parts.push("Можно использовать эмодзи умеренно.");
    }

    if (styleContext.hasHashtags) {
      parts.push("Можно добавить релевантные хэштеги.");
    }

    if (parts.length > 0) {
      styleGuidance = `\n\nСТИЛЬ ГРУППЫ "${styleContext.groupName}":\n${parts.join("\n")}`;
    }

    // Add sample messages if available
    if (styleContext.sampleMessages && styleContext.sampleMessages.length > 0) {
      styleGuidance += `\n\nПРИМЕРЫ ОБЪЯВЛЕНИЙ ИЗ ЭТОЙ ГРУППЫ (для понимания стиля):\n${styleContext.sampleMessages.slice(0, 3).map((m, i) => `${i + 1}. ${m.slice(0, 300)}${m.length > 300 ? "..." : ""}`).join("\n\n")}`;
    }
  }

  const messages: ChatMessage[] = [
    {
      role: "system",
      content: `Ты помощник для перефразирования объявлений о продаже.

Твоя задача: переписать текст объявления так, чтобы он:
1. Выглядел уникальным и естественным
2. Соответствовал стилю группы (если указан)
3. Сохранял ВСЕ важные данные

ОБЯЗАТЕЛЬНО СОХРАНЯЙ:
- Все контактные данные (телефоны, ссылки, @username)
- Все цены и числа
- Размеры, характеристики, адреса
- Суть предложения

ПРАВИЛА ПЕРЕФРАЗИРОВАНИЯ:
1. НЕ меняй контакты, цены, размеры — копируй как есть
2. Перефразируй описательную часть своими словами
3. Можно менять порядок предложений
4. Адаптируй стиль под группу (эмодзи, длина, тон)
5. Пиши на том же языке что и оригинал${styleGuidance}

Отвечай ТОЛЬКО перефразированным текстом, без комментариев и пояснений.`,
    },
    {
      role: "user",
      content: `Перефразируй это объявление${styleContext?.groupName ? ` для группы "${styleContext.groupName}"` : ""}:

${originalText}`,
    },
  ];

  try {
    const rephrased = await chatWithDeepSeek(messages, {
      temperature: 0.7, // Higher for more variation
      max_tokens: Math.max(500, originalText.length * 2),
    });

    // Basic validation - should contain some original elements
    const hasNumbers = /\d/.test(originalText) ? /\d/.test(rephrased) : true;

    if (!rephrased || rephrased.length < originalText.length * 0.3) {
      llmLog.warn({ originalLen: originalText.length, rephrasedLen: rephrased?.length }, "Rephrase too short");
      return { text: originalText, success: false, error: "Rephrase too short" };
    }

    if (!hasNumbers) {
      llmLog.warn("Rephrase lost numbers from original");
      return { text: originalText, success: false, error: "Lost important numbers" };
    }

    llmLog.debug(
      { originalLen: originalText.length, rephrasedLen: rephrased.length },
      "Text rephrased successfully"
    );

    return { text: rephrased.trim(), success: true };
  } catch (error) {
    llmLog.error({ error }, "Failed to rephrase text");
    return {
      text: originalText,
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
