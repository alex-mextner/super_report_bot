import { db, queries } from "../db/index.ts";
import { logger } from "../logger.ts";

export interface TopSeller {
  senderId: number;
  senderName: string | null;
  senderUsername: string | null;
  postCount: number;
}

export interface CategoryCount {
  categoryCode: string;
  categoryName: string;
  count: number;
}

export interface ActivityPoint {
  date: string;
  count: number;
}

export interface PriceStats {
  categoryCode: string;
  categoryName: string;
  currency: string;
  min: number;
  max: number;
  avg: number;
  count: number;
}

export interface GroupStats {
  uniqueSellersCount: number;
  topSellers: TopSeller[];
  categoryCounts: CategoryCount[];
  activityByDay: ActivityPoint[];
  pricesByCategory: PriceStats[];
  botFoundPosts: {
    matched: number;
    notified: number;
  };
  totalMessages: number;
  periodDays: number;
}

const PERIOD_DAYS = 30;

export function computeGroupStats(groupId: number): GroupStats {
  const now = Math.floor(Date.now() / 1000);
  const periodStart = now - PERIOD_DAYS * 24 * 60 * 60;

  // 1. Unique sellers count
  const uniqueSellersResult = db
    .prepare<{ count: number }, [number, number]>(
      `SELECT COUNT(DISTINCT sender_id) as count
       FROM messages
       WHERE group_id = ? AND timestamp > ? AND is_deleted = 0 AND sender_id IS NOT NULL`
    )
    .get(groupId, periodStart);
  const uniqueSellersCount = uniqueSellersResult?.count || 0;

  // 2. Top sellers (top 10)
  const topSellersRaw = db
    .prepare<
      { sender_id: number; sender_name: string | null; sender_username: string | null; post_count: number },
      [number, number]
    >(
      `SELECT sender_id, sender_name, sender_username, COUNT(*) as post_count
       FROM messages
       WHERE group_id = ? AND timestamp > ? AND is_deleted = 0 AND sender_id IS NOT NULL
       GROUP BY sender_id
       ORDER BY post_count DESC
       LIMIT 10`
    )
    .all(groupId, periodStart);

  const topSellers: TopSeller[] = topSellersRaw.map((s) => ({
    senderId: s.sender_id,
    senderName: s.sender_name,
    senderUsername: s.sender_username,
    postCount: s.post_count,
  }));

  // 3. Category counts (from products table)
  const categoriesRaw = db
    .prepare<{ category_code: string; name_ru: string | null; count: number }, [number, number]>(
      `SELECT p.category_code, c.name_ru, COUNT(*) as count
       FROM products p
       LEFT JOIN categories c ON p.category_code = c.code
       WHERE p.group_id = ? AND p.message_date > ?
       GROUP BY p.category_code
       ORDER BY count DESC`
    )
    .all(groupId, periodStart);

  const categoryCounts: CategoryCount[] = categoriesRaw.map((c) => ({
    categoryCode: c.category_code,
    categoryName: c.name_ru || c.category_code,
    count: c.count,
  }));

  // 4. Activity by day (last 30 days)
  const activityRaw = db
    .prepare<{ date: string; count: number }, [number, number]>(
      `SELECT date(timestamp, 'unixepoch') as date, COUNT(*) as count
       FROM messages
       WHERE group_id = ? AND timestamp > ? AND is_deleted = 0
       GROUP BY date
       ORDER BY date`
    )
    .all(groupId, periodStart);

  const activityByDay: ActivityPoint[] = activityRaw.map((a) => ({
    date: a.date,
    count: a.count,
  }));

  // 5. Price analytics by category and currency
  const pricesRaw = db
    .prepare<
      {
        category_code: string;
        name_ru: string | null;
        price_currency: string | null;
        min_price: number;
        max_price: number;
        avg_price: number;
        count: number;
      },
      [number, number]
    >(
      `SELECT
         p.category_code,
         c.name_ru,
         p.price_currency,
         MIN(p.price_normalized) as min_price,
         MAX(p.price_normalized) as max_price,
         AVG(p.price_normalized) as avg_price,
         COUNT(*) as count
       FROM products p
       LEFT JOIN categories c ON p.category_code = c.code
       WHERE p.group_id = ? AND p.message_date > ? AND p.price_normalized IS NOT NULL
       GROUP BY p.category_code, p.price_currency
       ORDER BY count DESC`
    )
    .all(groupId, periodStart);

  const pricesByCategory: PriceStats[] = pricesRaw.map((p) => ({
    categoryCode: p.category_code,
    categoryName: p.name_ru || p.category_code,
    currency: p.price_currency || "RUB",
    min: p.min_price,
    max: p.max_price,
    avg: Math.round(p.avg_price),
    count: p.count,
  }));

  // 6. Bot effectiveness (from found_posts_analyzes)
  const botStatsResult = db
    .prepare<{ matched: number; notified: number }, [number, number]>(
      `SELECT
         SUM(CASE WHEN result = 'matched' THEN 1 ELSE 0 END) as matched,
         SUM(CASE WHEN notified_at IS NOT NULL THEN 1 ELSE 0 END) as notified
       FROM found_posts_analyzes
       WHERE group_id = ? AND analyzed_at > ?`
    )
    .get(groupId, periodStart);

  const botFoundPosts = {
    matched: botStatsResult?.matched || 0,
    notified: botStatsResult?.notified || 0,
  };

  // 7. Total messages
  const totalMessagesResult = db
    .prepare<{ count: number }, [number, number]>(
      `SELECT COUNT(*) as count FROM messages
       WHERE group_id = ? AND timestamp > ? AND is_deleted = 0`
    )
    .get(groupId, periodStart);
  const totalMessages = totalMessagesResult?.count || 0;

  return {
    uniqueSellersCount,
    topSellers,
    categoryCounts,
    activityByDay,
    pricesByCategory,
    botFoundPosts,
    totalMessages,
    periodDays: PERIOD_DAYS,
  };
}

export async function computeAndSaveGroupAnalytics(groupId: number): Promise<GroupStats> {
  const now = Math.floor(Date.now() / 1000);
  const periodStart = now - PERIOD_DAYS * 24 * 60 * 60;

  logger.info({ groupId }, "Computing group analytics");

  const stats = computeGroupStats(groupId);
  queries.saveGroupAnalytics(groupId, JSON.stringify(stats), periodStart, now);

  logger.info({ groupId, totalMessages: stats.totalMessages }, "Group analytics computed");

  return stats;
}
