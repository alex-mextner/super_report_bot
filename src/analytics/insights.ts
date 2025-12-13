import { llmThink } from "../llm/index.ts";
import { llmLog } from "../logger.ts";
import type { GroupStats } from "./compute.ts";

const INSIGHTS_PROMPT = `Ты аналитик Telegram-группы. Проанализируй статистику и напиши краткий обзор на русском языке (3-5 предложений).

Статистика за {periodDays} дней:
- Уникальных продавцов: {uniqueSellers}
- Всего сообщений: {totalMessages}
- Топ-3 продавца: {topSellers}
- Популярные категории: {categories}
- Динамика активности: {activityTrend}
- Бот нашел для пользователей: {botFound} объявлений

Напиши инсайты:
1. Общая активность группы
2. Топ-продавцы и их доля
3. Популярные категории товаров
4. Краткий вывод

Формат: простой текст без markdown, 3-5 предложений.`;

function calculateActivityTrend(activityByDay: { date: string; count: number }[]): string {
  if (activityByDay.length < 7) {
    return "недостаточно данных";
  }

  const recentWeek = activityByDay.slice(-7);
  const previousWeek = activityByDay.slice(-14, -7);

  if (previousWeek.length === 0) {
    return "недостаточно данных для сравнения";
  }

  const recentSum = recentWeek.reduce((sum, d) => sum + d.count, 0);
  const previousSum = previousWeek.reduce((sum, d) => sum + d.count, 0);

  if (previousSum === 0) {
    return recentSum > 0 ? "активность появилась" : "нет активности";
  }

  const changePercent = ((recentSum - previousSum) / previousSum) * 100;

  if (changePercent > 20) {
    return `растет (+${Math.round(changePercent)}% за неделю)`;
  } else if (changePercent < -20) {
    return `падает (${Math.round(changePercent)}% за неделю)`;
  } else {
    return "стабильна";
  }
}

function buildPrompt(stats: GroupStats): string {
  const activityTrend = calculateActivityTrend(stats.activityByDay);

  const topSellersText = stats.topSellers
    .slice(0, 3)
    .map((s) => {
      const name = s.senderName || s.senderUsername || `#${s.senderId}`;
      return `${name}: ${s.postCount} постов`;
    })
    .join(", ") || "нет данных";

  const categoriesText = stats.categoryCounts
    .slice(0, 3)
    .map((c) => `${c.categoryName}: ${c.count}`)
    .join(", ") || "нет данных";

  return INSIGHTS_PROMPT
    .replace("{periodDays}", String(stats.periodDays))
    .replace("{uniqueSellers}", String(stats.uniqueSellersCount))
    .replace("{totalMessages}", String(stats.totalMessages))
    .replace("{topSellers}", topSellersText)
    .replace("{categories}", categoriesText)
    .replace("{activityTrend}", activityTrend)
    .replace("{botFound}", String(stats.botFoundPosts.notified));
}

export async function generateInsights(stats: GroupStats): Promise<string | null> {
  if (!process.env.HF_TOKEN) {
    llmLog.warn("HF_TOKEN not set, skipping insights generation");
    return null;
  }

  // Skip if not enough data
  if (stats.totalMessages < 10) {
    return "Недостаточно данных для анализа (менее 10 сообщений за период).";
  }

  const prompt = buildPrompt(stats);

  try {
    const response = await llmThink({
      messages: [{ role: "user", content: prompt }],
      maxTokens: 500,
    });

    const cleaned = response.trim();

    llmLog.info({ statsTotal: stats.totalMessages }, "Insights generated");
    return cleaned;
  } catch (error) {
    llmLog.error({ error }, "Failed to generate insights");
    return null;
  }
}
