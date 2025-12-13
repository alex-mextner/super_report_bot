/**
 * Unified LLM Client
 *
 * Primary: Z.AI GLM models with HuggingFace fallbacks.
 * Models are grouped by use case:
 * - llmLight: Fast simple tasks (Qwen 72B → Qwen 4B fallback)
 * - llmThink: Reasoning tasks (GLM-4.6 → Qwen 72B fallback)
 * - llmFast: Classification/verification (GLM-4.6 → Qwen fallbacks)
 * - llmVision: Image analysis (GLM-4.6V)
 */

import { InferenceClient } from "@huggingface/inference";
import { llmLog } from "../logger.ts";

const HF_TOKEN = process.env.HF_TOKEN;
const ZAI_API_KEY = process.env.ZAI_API_KEY;
const ZAI_BASE_URL = process.env.ZAI_BASE_URL || "https://api.z.ai/api/paas/v4";

if (!HF_TOKEN) {
  llmLog.warn("HF_TOKEN not set. HuggingFace fallback will not work.");
}

if (!ZAI_API_KEY) {
  llmLog.warn("ZAI_API_KEY not set. Primary LLM (GLM) will not work.");
}

export const hf = new InferenceClient(HF_TOKEN);

// =====================================================
// Models & Providers
// =====================================================

export const MODELS = {
  // Z.AI models (primary) - $5/$10 per 1M
  GLM_46: "glm-4.6",
  GLM_46V: "glm-4.6v",
  // HuggingFace fallbacks
  QWEN_FAST: "Qwen/Qwen2.5-72B-Instruct",
  QWEN_SMALL: "Qwen/Qwen3-4B-Instruct-2507",
  // Zero-shot classification
  BART_MNLI: "facebook/bart-large-mnli",
} as const;

type HFProvider = "nebius" | "nscale" | "novita" | "fireworks-ai" | "together" | "groq" | "sambanova";
type Provider = HFProvider | "zai";

interface ProviderConfig {
  model: string;
  provider: Provider;
  retries: number;
}

// Provider chains for different use cases
const LIGHT_PROVIDERS: ProviderConfig[] = [
  { model: MODELS.QWEN_FAST, provider: "nebius", retries: 3 },
  { model: MODELS.QWEN_SMALL, provider: "nscale", retries: 2 },
];

const THINK_PROVIDERS: ProviderConfig[] = [
  { model: MODELS.GLM_46, provider: "zai", retries: 3 },
  { model: MODELS.QWEN_FAST, provider: "nebius", retries: 2 }, // fallback to non-reasoning
];

const FAST_PROVIDERS: ProviderConfig[] = [
  { model: MODELS.GLM_46, provider: "zai", retries: 3 },
  { model: MODELS.QWEN_FAST, provider: "nebius", retries: 2 },
  { model: MODELS.QWEN_SMALL, provider: "nscale", retries: 2 },
];

const VISION_PROVIDERS: ProviderConfig[] = [
  { model: MODELS.GLM_46V, provider: "zai", retries: 3 },
];

// =====================================================
// Rate Limiting & Retry Logic
// =====================================================

let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 500; // ms

export async function withRateLimit<T>(fn: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;

  if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
    await new Promise((resolve) =>
      setTimeout(resolve, MIN_REQUEST_INTERVAL - timeSinceLastRequest)
    );
  }

  lastRequestTime = Date.now();
  return fn();
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 5,
  baseDelay: number = 2000
): Promise<T> {
  let lastError: Error | null = null;

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await withRateLimit(fn);
    } catch (error) {
      lastError = error as Error;
      const errorMsg = error instanceof Error ? error.message : String(error);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const httpStatus = (error as any)?.httpResponse?.status;

      const isRetryable =
        errorMsg.includes("rate limit") ||
        errorMsg.includes("429") ||
        errorMsg.includes("502") ||
        errorMsg.includes("503") ||
        errorMsg.includes("504") ||
        errorMsg.includes("timeout") ||
        errorMsg.includes("ECONNRESET") ||
        errorMsg.includes("ETIMEDOUT") ||
        httpStatus === 429 ||
        httpStatus === 502 ||
        httpStatus === 503 ||
        httpStatus === 504;

      if (isRetryable && i < maxRetries - 1) {
        const is504 = errorMsg.includes("504") || httpStatus === 504;
        const multiplier = is504 ? 3 : 2;
        const delay = baseDelay * Math.pow(multiplier, i);
        llmLog.warn({ delay, attempt: i + 1, httpStatus, error: errorMsg.slice(0, 100) }, "Retryable error, retrying");
        await new Promise((resolve) => setTimeout(resolve, delay));
      } else {
        throw error;
      }
    }
  }

  throw lastError;
}

// =====================================================
// Types
// =====================================================

export type LLMMessage = {
  role: "system" | "user" | "assistant";
  content: string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;
  [key: string]: unknown;
};

export interface LLMOptions {
  messages: LLMMessage[];
  maxTokens?: number;
  temperature?: number;
}

// =====================================================
// Z.AI Client
// =====================================================

interface ZAIResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

export async function callZAI(
  model: string,
  messages: LLMMessage[],
  maxTokens: number,
  temperature: number
): Promise<string> {
  if (!ZAI_API_KEY) {
    throw new Error("ZAI_API_KEY not set");
  }

  const response = await fetch(`${ZAI_BASE_URL}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ZAI_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: maxTokens,
      temperature,
    }),
    signal: AbortSignal.timeout(60000), // 60s timeout
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Z.AI error ${response.status}: ${text.slice(0, 200)}`);
  }

  const data = (await response.json()) as ZAIResponse;
  return data.choices[0]?.message?.content || "";
}

// =====================================================
// Core LLM Functions
// =====================================================

async function callWithFallback(
  providers: ProviderConfig[],
  messages: LLMMessage[],
  maxTokens: number,
  temperature: number,
  taskName: string
): Promise<string> {
  let lastError: Error | null = null;

  for (const config of providers) {
    try {
      const result = await withRetry(
        async () => {
          if (config.provider === "zai") {
            // Z.AI direct call
            return await callZAI(config.model, messages, maxTokens, temperature);
          } else {
            // HuggingFace provider call
            const response = await hf.chatCompletion({
              model: config.model,
              provider: config.provider as HFProvider,
              messages: messages as Parameters<typeof hf.chatCompletion>[0]["messages"],
              max_tokens: maxTokens,
              temperature,
            });
            return response.choices[0]?.message?.content || "";
          }
        },
        config.retries,
        1000
      );

      if (result) {
        llmLog.debug({ task: taskName, provider: config.provider, model: config.model }, "LLM success");
        return result;
      }
    } catch (error) {
      lastError = error as Error;
      llmLog.warn(
        { task: taskName, error: lastError.message?.slice(0, 100), provider: config.provider },
        "LLM provider failed, trying next"
      );
    }
  }

  throw lastError || new Error(`All providers failed for ${taskName}`);
}

/**
 * Light tasks: fast simple completions
 * Best for: editing, simple Q&A, formatting
 * Models: Qwen 72B → Qwen 4B
 */
export async function llmLight(options: LLMOptions): Promise<string> {
  const { messages, maxTokens = 2000, temperature = 0.3 } = options;
  return callWithFallback(LIGHT_PROVIDERS, messages, maxTokens, temperature, "light");
}

/**
 * Think tasks: reasoning with chain-of-thought
 * Best for: keyword generation, complex analysis, planning
 * Models: GLM-4.6 → Qwen 72B
 */
export async function llmThink(options: LLMOptions): Promise<string> {
  const { messages, maxTokens = 2500, temperature = 0.6 } = options;
  const response = await callWithFallback(THINK_PROVIDERS, messages, maxTokens, temperature, "think");
  // Strip <think>...</think> blocks from reasoning models
  return response.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

/**
 * Fast tasks: quick classification/verification
 * Best for: message verification, yes/no decisions, simple classification
 * Models: GLM-4.6 → Qwen 72B → Qwen 4B
 */
export async function llmFast(options: LLMOptions): Promise<string> {
  const { messages, maxTokens = 500, temperature = 0.1 } = options;
  const response = await callWithFallback(FAST_PROVIDERS, messages, maxTokens, temperature, "fast");
  // Strip <think>...</think> blocks (GLM may include them)
  return response.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

/**
 * Vision tasks: image analysis
 * Best for: photo verification, image description
 * Models: GLM-4.6V
 */
export async function llmVision(options: LLMOptions): Promise<string> {
  const { messages, maxTokens = 1000, temperature = 0.3 } = options;
  const response = await callWithFallback(VISION_PROVIDERS, messages, maxTokens, temperature, "vision");
  // Strip <think>...</think> blocks (GLM-V may include them)
  return response.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

// =====================================================
// Verification Functions (moved from deepseek.ts)
// =====================================================

export interface VerificationResult {
  isMatch: boolean;
  confidence: number;
  reasoning?: string;
}

export interface BatchVerificationInput {
  index: number;
  text: string;
}

export interface BatchVerificationResult {
  index: number;
  isMatch: boolean;
  confidence: number;
  reasoning?: string;
}

/**
 * Verify if a message matches a subscription description
 * @param hasPhoto - if true, the message contains photo(s) that LLM cannot see
 * @param language - language for the response (default: Russian)
 */
export async function verifyMessage(
  messageText: string,
  subscriptionDescription: string,
  hasPhoto?: boolean,
  language: string = "English"
): Promise<VerificationResult> {
  const photoWarning = hasPhoto
    ? "\n\nIMPORTANT: This message contains photo(s) that you CANNOT see. Do NOT guess about photo content based on emojis or text descriptions. Focus ONLY on analyzing the text content itself."
    : "";

  const systemPrompt = `You are a message classifier. Your task is to determine if a message matches a search criteria.

Respond ONLY with a JSON object in this exact format:
{"match": true/false, "confidence": 0.0-1.0, "reason": "brief explanation in ${language}"}

Be strict but reasonable:
- Match if the message is clearly relevant to the search criteria
- Don't match if the message is only tangentially related
- Consider synonyms and related concepts
- Ignore formatting, emoji, typos
- Don't match if item is sold as part of something larger (e.g. "keyboard" in laptop listing, "wheels" in car listing - impractical to buy whole thing for a component)
- Don't match SOLD items: if item name is strikethrough (~~name~~), or text contains "Sold", "SOLD", "Продано", "продан". Note: strikethrough price is OK (just discount).

CRITICAL - Check listing type (buy vs sell):
- If search criteria implies BUYING (looking for a product) → DON'T match "looking for/want to buy/need" listings (those are also buyers!)
- If search criteria implies SELLING → DON'T match "selling/for sale" listings (those are also sellers!)
- Match only opposite types: buyer searches → seller listings, seller searches → buyer listings
- Common buyer keywords: куплю, ищу, нужен, looking for, want to buy, WTB
- Common seller keywords: продам, продаю, selling, for sale, WTS${photoWarning}`;

  const userPrompt = `Search criteria: "${subscriptionDescription}"

Message to classify:
"""
${messageText.slice(0, 2000)}
"""

Does this message match the search criteria?`;

  const response = await llmFast({
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    maxTokens: 200,
    temperature: 0.1,
  });

  return parseVerificationResponse(response);
}

function parseVerificationResponse(content: string): VerificationResult {
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    const lowerContent = content.toLowerCase();
    const isMatch = lowerContent.includes('"match": true') ||
                    lowerContent.includes('"match":true') ||
                    (lowerContent.includes("yes") && !lowerContent.includes("no"));
    return {
      isMatch,
      confidence: isMatch ? 0.6 : 0.4,
      reasoning: content.slice(0, 200),
    };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      isMatch: Boolean(parsed.match),
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : (parsed.match ? 0.8 : 0.2),
      reasoning: parsed.reason || parsed.reasoning,
    };
  } catch {
    const isMatch = content.toLowerCase().includes('"match": true');
    return {
      isMatch,
      confidence: 0.5,
      reasoning: content.slice(0, 200),
    };
  }
}

/**
 * Verify multiple messages in a single API call (batch)
 * Much faster than individual calls for history scanning
 * @param language - language for the response (default: Russian)
 */
export async function verifyMessageBatch(
  messages: BatchVerificationInput[],
  subscriptionDescription: string,
  language: string = "English"
): Promise<BatchVerificationResult[]> {
  if (messages.length === 0) {
    return [];
  }

  const systemPrompt = `You are a message classifier. Your task is to classify MULTIPLE messages against a search criteria.

Respond ONLY with a JSON array. For each message, return:
[{"index": 0, "match": true/false, "confidence": 0.0-1.0, "reason": "brief explanation in ${language}"}, ...]

Be strict but reasonable:
- Match if the message is clearly relevant to the search criteria
- Don't match if the message is only tangentially related
- Consider synonyms and related concepts
- Ignore formatting, emoji, typos
- Don't match if item is sold as part of something larger (e.g. "keyboard" in laptop listing - impractical to buy whole thing for a component)

CRITICAL - Check listing type (buy vs sell):
- If search criteria implies BUYING → DON'T match buyer listings (куплю/ищу/нужен, looking for/want to buy/WTB)
- If search criteria implies SELLING → DON'T match seller listings (продам/продаю, selling/for sale/WTS)`;

  const messagesJson = messages
    .map((m) => `[${m.index}]: ${m.text.slice(0, 500)}`)
    .join("\n\n");

  const userPrompt = `Search criteria: "${subscriptionDescription}"

Messages to classify:
${messagesJson}

Classify each message. Return JSON array with results for all ${messages.length} messages.`;

  const response = await llmFast({
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    maxTokens: 100 * messages.length,
    temperature: 0.1,
  });

  return parseBatchResponse(response, messages);
}

function parseBatchResponse(
  content: string,
  originalMessages: BatchVerificationInput[]
): BatchVerificationResult[] {
  const jsonMatch = content.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    llmLog.warn({ content: content.slice(0, 200) }, "Failed to parse batch response as JSON array");
    return originalMessages.map((m) => ({
      index: m.index,
      isMatch: false,
      confidence: 0,
      reasoning: "Failed to parse LLM response",
    }));
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]) as Array<{
      index: number;
      match: boolean;
      confidence?: number;
      reason?: string;
    }>;

    const resultMap = new Map<number, BatchVerificationResult>();
    for (const item of parsed) {
      resultMap.set(item.index, {
        index: item.index,
        isMatch: Boolean(item.match),
        confidence: typeof item.confidence === "number" ? item.confidence : (item.match ? 0.8 : 0.2),
        reasoning: item.reason,
      });
    }

    return originalMessages.map((m) => {
      const result = resultMap.get(m.index);
      if (result) return result;
      return {
        index: m.index,
        isMatch: false,
        confidence: 0,
        reasoning: "Missing from LLM response",
      };
    });
  } catch {
    llmLog.warn({ content: content.slice(0, 200) }, "JSON parse failed for batch response");
    return originalMessages.map((m) => ({
      index: m.index,
      isMatch: false,
      confidence: 0,
      reasoning: "JSON parse failed",
    }));
  }
}

// =====================================================
// Health Check
// =====================================================

export async function checkLLMHealth(): Promise<boolean> {
  try {
    await llmFast({
      messages: [{ role: "user", content: "ping" }],
      maxTokens: 1,
    });
    return true;
  } catch {
    return false;
  }
}

// =====================================================
// Legacy exports for backward compatibility
// =====================================================

/** @deprecated Use llmLight instead */
export const llmChat = llmLight;

/** @deprecated Use verifyMessage instead */
export const verifyWithLLM = verifyMessage;

/** @deprecated Use verifyMessageBatch instead */
export const verifyBatchWithLLM = verifyMessageBatch;

/** @deprecated Use LLMMessage instead */
export type ChatMessage = LLMMessage;

/** @deprecated Use LLMMessage instead */
export type LLMChatMessage = LLMMessage;
