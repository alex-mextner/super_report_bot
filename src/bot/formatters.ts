/**
 * Formatters for bot messages
 */

import type { DeepAnalysisResult } from "../llm/deep-analyze.ts";

const LISTING_TYPE_LABELS: Record<string, string> = {
  sale: "Продажа",
  rent: "Аренда",
  service: "Услуга",
  other: "Другое",
};

const CONDITION_LABELS: Record<string, string> = {
  new: "новый",
  used: "б/у",
};

const VERDICT_EMOJI: Record<string, string> = {
  good_deal: "✅",
  overpriced: "❌",
  fair: "👍",
  unknown: "❓",
};

/**
 * Format deep analysis result as HTML for Telegram
 */
export function formatDeepAnalysisHtml(result: DeepAnalysisResult): string {
  if (!result.isListing) {
    const reason = result.notListingReason || "Не удалось определить тип";
    return `❌ Это не объявление\n\nПричина: ${reason}`;
  }

  let text = `📊 <b>Анализ объявления</b>\n`;
  text += `Тип: ${LISTING_TYPE_LABELS[result.listingType || "other"] || "Неизвестно"}\n\n`;

  // Image analysis section
  if (result.imageAnalysis?.description) {
    text += `📷 <b>Фото:</b> ${result.imageAnalysis.description}\n`;
    if (result.imageAnalysis.condition !== "unknown") {
      text += `   Состояние: ${CONDITION_LABELS[result.imageAnalysis.condition] || "—"}\n`;
    }
    if (result.imageAnalysis.conditionDetails) {
      text += `   Детали: ${result.imageAnalysis.conditionDetails}\n`;
    }
    text += `\n`;
  }

  // Scam risk section
  const riskEmoji = result.scamRisk.level === "high" ? "🚨" : result.scamRisk.level === "medium" ? "⚠️" : "✅";
  text += `${riskEmoji} <b>Риск мошенничества:</b> ${result.scamRisk.score}/100\n`;
  if (result.scamRisk.flags.length > 0) {
    text += `Флаги: ${result.scamRisk.flags.join(", ")}\n`;
  }
  text += `${result.scamRisk.recommendation}\n\n`;

  // Items table
  if (result.items.length > 0) {
    text += `<b>📋 Товары/услуги:</b>\n`;
    text += `<blockquote expandable>`;

    for (const item of result.items) {
      const verdict = VERDICT_EMOJI[item.priceVerdict] || "❓";
      const marketPrice = item.marketPriceAvg
        ? `~${item.marketPriceAvg.toLocaleString("ru-RU")}`
        : "н/д";
      text += `${verdict} <b>${item.name}</b>\n`;
      text += `   Цена: ${item.extractedPrice || "—"}\n`;
      text += `   Рынок: ${marketPrice}\n\n`;
    }

    text += `</blockquote>\n`;

    // Worth buying warnings
    const notWorth = result.items.filter((i) => !i.worthBuying);
    if (notWorth.length > 0) {
      text += `🚫 <b>Не рекомендуется:</b>\n`;
      for (const item of notWorth) {
        text += `• ${item.name}: ${item.worthBuyingReason}\n`;
      }
      text += `\n`;
    }

    // Sources
    const allSources = result.items.flatMap((i) => i.sources).filter((s) => s.price);
    if (allSources.length > 0) {
      text += `<b>🔗 Источники цен:</b>\n`;
      const uniqueSources = allSources.slice(0, 5);
      for (const src of uniqueSources) {
        const title = src.title.slice(0, 40);
        text += `• <a href="${src.url}">${title}</a>: ${src.price || "—"}\n`;
      }
      text += `\n`;
    }
  }

  // Overall verdict
  text += `<b>📝 Итог:</b>\n${result.overallVerdict}`;

  return text;
}
