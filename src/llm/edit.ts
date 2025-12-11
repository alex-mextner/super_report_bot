import { chatWithDeepSeek, type ChatMessage } from "./deepseek.ts";
import { hf, MODELS, withRetry } from "./index.ts";
import { llmLog } from "../logger.ts";

export interface EditInterpretationResult {
  positive_keywords: string[];
  negative_keywords: string[];
  llm_description: string;
  summary: string; // Human-readable summary of changes
}

const EDIT_SYSTEM_PROMPT = `Ты помощник для редактирования подписок на мониторинг Telegram-групп.
Пользователь отправляет команды на изменение параметров подписки в свободной форме.

## Текущие параметры подписки
- Позитивные слова: {positive_keywords}
- Негативные слова: {negative_keywords}
- Описание: {llm_description}

## Твоя задача

Интерпретируй команду пользователя и верни ПОЛНЫЙ обновлённый список параметров.

### Типы команд

1. **Добавить слово**: "добавь аренда", "ещё добавь квартира", "+ слово"
   → Добавить в positive_keywords

2. **Убрать слово**: "убери продажа", "удали слово дом", "- слово"
   → Убрать из positive_keywords

3. **Добавить исключение**: "исключи коммерческая", "добавь в негативные офис", "минус офис"
   → Добавить в negative_keywords

4. **Убрать исключение**: "убери из исключений посуточно", "верни посуточно"
   → Убрать из negative_keywords

5. **Изменить описание**: "измени описание на ...", "сделай описание про ...", "описание: ..."
   → Обновить llm_description

6. **Комбинированные**: "добавь аренда и убери продажа"
   → Применить все изменения

### Правила

- Сохраняй ВСЕ существующие слова которые не нужно удалять
- При добавлении слова проверь что его нет в списке (не дублируй)
- Генерируй summary на русском: что именно изменилось
- Если команда непонятна, верни текущие значения без изменений и summary с уточняющим вопросом

## Формат ответа

Ответь ТОЛЬКО JSON без дополнительного текста:
{
  "positive_keywords": [...],
  "negative_keywords": [...],
  "llm_description": "...",
  "summary": "Добавлено: аренда. Удалено: продажа."
}`;

interface CurrentParams {
  positive_keywords: string[];
  negative_keywords: string[];
  llm_description: string;
}

/**
 * Parse LLM response JSON
 */
function parseEditResponse(
  response: string,
  current: CurrentParams
): EditInterpretationResult {
  const jsonMatch = response.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    llmLog.warn({ response: response.slice(0, 200) }, "Failed to parse edit response");
    return {
      ...current,
      summary: "Не удалось интерпретировать команду. Попробуй переформулировать.",
    };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      positive_keywords: parsed.positive_keywords || current.positive_keywords,
      negative_keywords: parsed.negative_keywords || current.negative_keywords,
      llm_description: parsed.llm_description || parsed.description || current.llm_description,
      summary: parsed.summary || "Изменения применены",
    };
  } catch {
    llmLog.warn({ json: jsonMatch[0].slice(0, 200) }, "Invalid JSON in edit response");
    return {
      ...current,
      summary: "Ошибка парсинга ответа. Попробуй ещё раз.",
    };
  }
}

/**
 * Try HuggingFace (Qwen) for fast response
 */
async function tryHuggingFace(
  systemPrompt: string,
  messages: Array<{ role: "user" | "assistant" | "system"; content: string }>
): Promise<string> {
  const result = await hf.chatCompletion({
    model: MODELS.QWEN_FAST,
    provider: "nebius",
    messages: [
      { role: "system", content: systemPrompt },
      ...messages,
    ],
    max_tokens: 1500,
    temperature: 0.3,
  });
  return result.choices[0]?.message?.content || "";
}

/**
 * Interpret user's free-form edit command and return updated subscription parameters
 * Uses HuggingFace (Qwen) with retry, falls back to DeepSeek API
 */
export async function interpretEditCommand(
  command: string,
  current: CurrentParams,
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }>
): Promise<EditInterpretationResult> {
  // Build system prompt with current values
  const systemPrompt = EDIT_SYSTEM_PROMPT
    .replace("{positive_keywords}", current.positive_keywords.join(", ") || "нет")
    .replace("{negative_keywords}", current.negative_keywords.join(", ") || "нет")
    .replace("{llm_description}", current.llm_description || "нет");

  // Limit conversation history to last 6 messages to avoid token overflow
  const recentHistory = conversationHistory.slice(-6);

  const chatMessages = [
    ...recentHistory.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
    { role: "user" as const, content: command },
  ];

  // Try HuggingFace (Qwen) first — faster
  try {
    const response = await withRetry(
      () => tryHuggingFace(systemPrompt, chatMessages),
      3, // 3 retries
      1000 // 1s base delay
    );
    llmLog.debug({ provider: "huggingface", response: response.slice(0, 200) }, "Edit command via HF");
    return parseEditResponse(response, current);
  } catch (hfError) {
    llmLog.warn({ error: hfError }, "HuggingFace edit failed, trying DeepSeek fallback");
  }

  // Fallback to DeepSeek API
  try {
    const messages: ChatMessage[] = [
      { role: "system", content: systemPrompt },
      ...chatMessages,
    ];
    const response = await chatWithDeepSeek(messages, { temperature: 0.3 });
    llmLog.debug({ provider: "deepseek", response: response.slice(0, 200) }, "Edit command via DeepSeek");
    return parseEditResponse(response, current);
  } catch (dsError) {
    llmLog.error({ error: dsError }, "Both HuggingFace and DeepSeek failed for edit");
    return {
      ...current,
      summary: "Ошибка LLM. Попробуй позже или переформулируй.",
    };
  }
}
