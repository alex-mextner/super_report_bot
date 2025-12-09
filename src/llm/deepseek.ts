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
 */
export async function verifyWithDeepSeek(
  messageText: string,
  subscriptionDescription: string
): Promise<DeepSeekVerificationResult> {
  if (!DEEPSEEK_API_KEY) {
    throw new Error("DEEPSEEK_API_KEY not configured");
  }

  const systemPrompt = `You are a message classifier. Your task is to determine if a message matches a search criteria.

Respond ONLY with a JSON object in this exact format:
{"match": true/false, "confidence": 0.0-1.0, "reason": "brief explanation"}

Be strict but reasonable:
- Match if the message is clearly relevant to the search criteria
- Don't match if the message is only tangentially related
- Consider synonyms and related concepts
- Ignore formatting, emoji, typos`;

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
