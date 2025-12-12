/**
 * Text Rephrasing for Publications
 *
 * Uses DeepSeek to rephrase ad text to avoid spam detection.
 * Each group gets a unique version of the same message.
 */

import { chatWithDeepSeek, type ChatMessage } from "./deepseek.ts";
import { llmLog } from "../logger.ts";

export interface RephraseResult {
  text: string;
  success: boolean;
  error?: string;
}

/**
 * Rephrase ad text to create a unique version
 * Preserves meaning, contact info, and prices
 */
export async function rephraseAdText(
  originalText: string,
  groupName?: string
): Promise<RephraseResult> {
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: `Ты помощник для перефразирования объявлений о продаже.

Твоя задача: переписать текст объявления так, чтобы он выглядел уникальным, но сохранял:
- Все контактные данные (телефоны, ссылки, username)
- Все цены и числа
- Суть предложения
- Эмоциональный тон (если есть)

Правила:
1. НЕ меняй контакты, цены, размеры, характеристики
2. Перефразируй описание своими словами
3. Можно менять порядок предложений
4. Можно добавить/убрать эмодзи (но не переусердствуй)
5. Длина должна быть примерно такой же
6. Пиши на том же языке что и оригинал

Отвечай ТОЛЬКО перефразированным текстом, без комментариев.`,
    },
    {
      role: "user",
      content: `Перефразируй это объявление${groupName ? ` для группы "${groupName}"` : ""}:

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
