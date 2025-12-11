/**
 * DeepSeek API Client
 * For message verification using DeepSeek-V3.2 (deepseek-chat model)
 *
 * API docs: https://api-docs.deepseek.com/
 */

import { llmLog } from "../logger.ts";

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";

if (!DEEPSEEK_API_KEY) {
  llmLog.warn("DEEPSEEK_API_KEY not set. DeepSeek verification will not work.");
}

export interface DeepSeekVerificationResult {
  isMatch: boolean;
  confidence: number;
  reasoning?: string;
}

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface DeepSeekResponse {
  id: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * Verify if a message matches the subscription description using DeepSeek
 * @param hasPhoto - if true, the message contains photo(s) that DeepSeek cannot see
 */
export async function verifyWithDeepSeek(
  messageText: string,
  subscriptionDescription: string,
  hasPhoto?: boolean
): Promise<DeepSeekVerificationResult> {
  if (!DEEPSEEK_API_KEY) {
    throw new Error("DEEPSEEK_API_KEY not configured");
  }

  const photoWarning = hasPhoto
    ? "\n\nIMPORTANT: This message contains photo(s) that you CANNOT see. Do NOT guess about photo content based on emojis or text descriptions. Focus ONLY on analyzing the text content itself."
    : "";

  const systemPrompt = `You are a message classifier. Your task is to determine if a message matches a search criteria.

Respond ONLY with a JSON object in this exact format:
{"match": true/false, "confidence": 0.0-1.0, "reason": "brief explanation in Russian"}

Be strict but reasonable:
- Match if the message is clearly relevant to the search criteria
- Don't match if the message is only tangentially related
- Consider synonyms and related concepts
- Ignore formatting, emoji, typos${photoWarning}`;

  const userPrompt = `Search criteria: "${subscriptionDescription}"

Message to classify:
"""
${messageText.slice(0, 2000)}
"""

Does this message match the search criteria?`;

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];

  try {
    const response = await fetch(DEEPSEEK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages,
        temperature: 0.1, // Low temperature for consistent classification
        max_tokens: 200,
        stream: false,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`DeepSeek API error (${response.status}): ${error}`);
    }

    const data = (await response.json()) as DeepSeekResponse;
    const content = data.choices[0]?.message?.content;

    if (!content) {
      throw new Error("Empty response from DeepSeek");
    }

    // Parse JSON response
    const result = parseDeepSeekResponse(content);

    llmLog.debug(
      {
        isMatch: result.isMatch,
        confidence: result.confidence.toFixed(2),
        tokens: data.usage.total_tokens,
        reasoning: result.reasoning?.slice(0, 50),
      },
      "DeepSeek verification result"
    );

    return result;
  } catch (error) {
    llmLog.error({ error }, "DeepSeek verification failed");
    throw error;
  }
}

/**
 * Parse DeepSeek response content to extract match result
 */
function parseDeepSeekResponse(content: string): DeepSeekVerificationResult {
  // Try to extract JSON from response
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    // Fallback: look for keywords
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
    // JSON parse failed, use fallback
    const isMatch = content.toLowerCase().includes('"match": true');
    return {
      isMatch,
      confidence: 0.5,
      reasoning: content.slice(0, 200),
    };
  }
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
 * Verify multiple messages in a single API call (batch)
 * Much faster than individual calls for history scanning
 */
export async function verifyBatchWithDeepSeek(
  messages: BatchVerificationInput[],
  subscriptionDescription: string
): Promise<BatchVerificationResult[]> {
  if (!DEEPSEEK_API_KEY) {
    throw new Error("DEEPSEEK_API_KEY not configured");
  }

  if (messages.length === 0) {
    return [];
  }

  const systemPrompt = `You are a message classifier. Your task is to classify MULTIPLE messages against a search criteria.

Respond ONLY with a JSON array. For each message, return:
[{"index": 0, "match": true/false, "confidence": 0.0-1.0, "reason": "brief explanation in Russian"}, ...]

Be strict but reasonable:
- Match if the message is clearly relevant to the search criteria
- Don't match if the message is only tangentially related
- Consider synonyms and related concepts
- Ignore formatting, emoji, typos`;

  const messagesJson = messages
    .map((m) => `[${m.index}]: ${m.text.slice(0, 500)}`)
    .join("\n\n");

  const userPrompt = `Search criteria: "${subscriptionDescription}"

Messages to classify:
${messagesJson}

Classify each message. Return JSON array with results for all ${messages.length} messages.`;

  const chatMessages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];

  try {
    const response = await fetch(DEEPSEEK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: chatMessages,
        temperature: 0.1,
        max_tokens: 100 * messages.length, // ~100 tokens per message
        stream: false,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`DeepSeek API error (${response.status}): ${error}`);
    }

    const data = (await response.json()) as DeepSeekResponse;
    const content = data.choices[0]?.message?.content;

    if (!content) {
      throw new Error("Empty response from DeepSeek");
    }

    // Parse JSON array response
    const results = parseBatchResponse(content, messages);

    llmLog.info(
      {
        batchSize: messages.length,
        matched: results.filter((r) => r.isMatch).length,
        tokens: data.usage.total_tokens,
      },
      "Batch DeepSeek verification complete"
    );

    return results;
  } catch (error) {
    llmLog.error({ error, batchSize: messages.length }, "Batch DeepSeek verification failed");
    throw error;
  }
}

/**
 * Parse batch response from DeepSeek
 */
function parseBatchResponse(
  content: string,
  originalMessages: BatchVerificationInput[]
): BatchVerificationResult[] {
  // Try to extract JSON array
  const jsonMatch = content.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    llmLog.warn({ content: content.slice(0, 200) }, "Failed to parse batch response as JSON array");
    // Return all as no-match on parse failure
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

    // Build result map
    const resultMap = new Map<number, BatchVerificationResult>();
    for (const item of parsed) {
      resultMap.set(item.index, {
        index: item.index,
        isMatch: Boolean(item.match),
        confidence: typeof item.confidence === "number" ? item.confidence : (item.match ? 0.8 : 0.2),
        reasoning: item.reason,
      });
    }

    // Ensure all original messages have results
    return originalMessages.map((m) => {
      const result = resultMap.get(m.index);
      if (result) return result;
      // Missing result = no match
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

/**
 * Check if DeepSeek API is available
 */
export async function checkDeepSeekHealth(): Promise<boolean> {
  if (!DEEPSEEK_API_KEY) return false;

  try {
    // Simple ping with minimal tokens
    const response = await fetch(DEEPSEEK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 1,
      }),
      signal: AbortSignal.timeout(10000),
    });

    return response.ok;
  } catch {
    return false;
  }
}
