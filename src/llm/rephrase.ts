/**
 * Text Rephrasing for Publications
 *
 * Rephrases ad text to avoid spam detection.
 * Each group gets a unique version of the same message.
 * Adapts to group's posting style if analysis is provided.
 */

import { llmFast, type LLMMessage } from "./index.ts";
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
      parts.push(`In this group ${styleContext.styleHints}.`);
    }

    if (styleContext.avgLength) {
      if (styleContext.avgLength < 200) {
        parts.push("Make the text shorter and more concise.");
      } else if (styleContext.avgLength > 500) {
        parts.push("You can make the text more detailed.");
      }
    }

    if (styleContext.hasEmojis === false) {
      parts.push("DO NOT use emojis — this group doesn't like them.");
    } else if (styleContext.hasEmojis === true) {
      parts.push("You can use emojis moderately.");
    }

    if (styleContext.hasHashtags) {
      parts.push("You can add relevant hashtags.");
    }

    if (parts.length > 0) {
      styleGuidance = `\n\nGROUP STYLE "${styleContext.groupName}":\n${parts.join("\n")}`;
    }

    // Add sample messages if available
    if (styleContext.sampleMessages && styleContext.sampleMessages.length > 0) {
      styleGuidance += `\n\nSAMPLE LISTINGS FROM THIS GROUP (for style reference):\n${styleContext.sampleMessages.slice(0, 3).map((m, i) => `${i + 1}. ${m.slice(0, 300)}${m.length > 300 ? "..." : ""}`).join("\n\n")}`;
    }
  }

  const messages: LLMMessage[] = [
    {
      role: "system",
      content: `You are an assistant for rephrasing sales listings.

Your task: rewrite the listing text so that it:
1. Looks unique and natural
2. Matches group style (if specified)
3. Preserves ALL important data

MUST PRESERVE:
- All contact info (phones, links, @username)
- All prices and numbers
- Sizes, characteristics, addresses
- The essence of the offer

REPHRASING RULES:
1. DO NOT change contacts, prices, sizes — copy as-is
2. Rephrase the descriptive part in your own words
3. You can change the order of sentences
4. Adapt style to the group (emojis, length, tone)
5. Write in the same language as the original${styleGuidance}

Respond ONLY with the rephrased text, no comments or explanations.`,
    },
    {
      role: "user",
      content: `Rephrase this listing${styleContext?.groupName ? ` for group "${styleContext.groupName}"` : ""}:

${originalText}`,
    },
  ];

  try {
    const rephrased = await llmFast({
      messages,
      temperature: 0.7,
      maxTokens: Math.max(500, originalText.length * 2),
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
