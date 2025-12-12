/**
 * Telegram Stars Payments Integration
 *
 * Handles:
 * - Plan subscriptions (Basic/Pro/Business)
 * - One-time payments (analyze, presets, promotions)
 * - Pre-checkout validation
 * - Payment processing
 */

import type { Bot } from "gramio";
import { queries } from "../db/index.ts";
import { botLog } from "../logger.ts";
import { startInteractivePublication } from "../publisher/interactive.ts";

// Plan prices in Stars
export const PLAN_PRICES = {
  basic: 50,
  pro: 150,
  business: 500,
} as const;

// One-time purchase prices in Stars
export const PRICES = {
  analyze: { free: 20, basic: 20, pro: 10, business: 0 },
  preset_lifetime: 1000,
  preset_subscription: 300, // per month
  promotion_group: 300, // 3 days
  promotion_product: 100, // 3 days
  publication: 100, // per preset
} as const;

export type Plan = "free" | "basic" | "pro" | "business";
export type PaymentType =
  | "analyze"
  | "subscription"
  | "preset"
  | "promotion_group"
  | "promotion_product"
  | "publication";

export interface PaymentPayload {
  type: PaymentType;
  plan?: Plan;
  messageId?: number;
  groupId?: number;
  presetId?: number;
  accessType?: "lifetime" | "subscription";
  days?: number; // for promotions duration
  publicationId?: number; // for publications
}

/**
 * Get analyze price for user's plan
 */
export function getAnalyzePrice(telegramId: number): number {
  const { plan } = queries.getUserPlan(telegramId);
  return PRICES.analyze[plan];
}

/**
 * Check if user can use free analyze (1 per 6 months)
 */
export function canUseFreeAnalyze(telegramId: number): boolean {
  const { plan } = queries.getUserPlan(telegramId);
  if (plan !== "free") return false;

  const used = queries.getFreeAnalyzesUsed(telegramId);
  return used < 1;
}

/**
 * Check subscription limits
 */
export function checkSubscriptionLimits(telegramId: number): {
  canCreate: boolean;
  current: number;
  max: number;
  plan: Plan;
} {
  const { plan } = queries.getUserPlan(telegramId);
  const limits = queries.getPlanLimits(plan);
  const current = queries.getUserSubscriptionCount(telegramId);

  return {
    canCreate: current < limits.maxSubscriptions,
    current,
    max: limits.maxSubscriptions,
    plan,
  };
}

/**
 * Check group limits for subscription
 */
export function checkGroupLimits(
  telegramId: number,
  subscriptionId: number
): {
  canAdd: boolean;
  current: number;
  max: number;
} {
  const { plan } = queries.getUserPlan(telegramId);
  const limits = queries.getPlanLimits(plan);
  const current = queries.getSubscriptionGroupCount(subscriptionId);

  return {
    canAdd: current < limits.maxGroupsPerSubscription,
    current,
    max: limits.maxGroupsPerSubscription,
  };
}

/**
 * Create invoice for one-time payment
 */
export async function sendPaymentInvoice(
  bot: Bot,
  chatId: number,
  options: {
    type: PaymentType;
    title: string;
    description: string;
    amount: number;
    payload: PaymentPayload;
  }
): Promise<void> {
  await bot.api.sendInvoice({
    chat_id: chatId,
    title: options.title,
    description: options.description,
    payload: JSON.stringify(options.payload),
    currency: "XTR",
    prices: [{ label: options.title, amount: options.amount }],
  });
}

/**
 * Create subscription invoice link (for monthly plans)
 */
export async function createSubscriptionLink(
  bot: Bot,
  plan: "basic" | "pro" | "business",
  userId: number
): Promise<string> {
  const descriptions = {
    basic: "10 подписок, 20 групп, приоритетные пуши",
    pro: "50 подписок, безлимит групп, фора, скидка 50% на анализ",
    business: "Безлимит всего, бесплатный анализ",
  };

  // Note: subscription_period is a valid Telegram API param but not in gramio types yet
  // Using type assertion to bypass TypeScript check
  const result = await bot.api.createInvoiceLink({
    title: `Подписка ${plan.charAt(0).toUpperCase() + plan.slice(1)}`,
    description: descriptions[plan],
    payload: JSON.stringify({
      type: "subscription",
      plan,
    } satisfies PaymentPayload),
    currency: "XTR",
    prices: [{ label: `${plan} план`, amount: PLAN_PRICES[plan] }],
    subscription_period: 30 * 24 * 60 * 60, // 30 days in seconds
  } as Parameters<typeof bot.api.createInvoiceLink>[0]);

  if (typeof result !== "string") {
    throw new Error(`Failed to create invoice link: ${JSON.stringify(result)}`);
  }

  return result;
}

/**
 * Handle pre_checkout_query - validate before payment
 */
export async function handlePreCheckout(
  bot: Bot,
  preCheckoutQueryId: string,
  telegramId: number,
  payload: PaymentPayload
): Promise<boolean> {
  try {
    // Validate based on payment type
    switch (payload.type) {
      case "analyze":
        // Check if message still exists (optional validation)
        break;

      case "subscription":
        // Always allow subscription upgrades
        break;

      case "preset":
        // Check if preset exists
        if (payload.presetId) {
          const presets = queries.getRegionPresets();
          if (!presets.some((p) => p.id === payload.presetId)) {
            await bot.api.answerPreCheckoutQuery({
              pre_checkout_query_id: preCheckoutQueryId,
              ok: false,
              error_message: "Пресет не найден",
            });
            return false;
          }
        }
        break;
    }

    await bot.api.answerPreCheckoutQuery({
      pre_checkout_query_id: preCheckoutQueryId,
      ok: true,
    });
    return true;
  } catch (error) {
    botLog.error({ error, payload }, "Pre-checkout validation failed");
    await bot.api.answerPreCheckoutQuery({
      pre_checkout_query_id: preCheckoutQueryId,
      ok: false,
      error_message: "Ошибка проверки платежа",
    });
    return false;
  }
}

/**
 * Handle successful payment
 */
export async function handleSuccessfulPayment(
  bot: Bot,
  telegramId: number,
  chargeId: string,
  amount: number,
  payloadStr: string
): Promise<{ success: boolean; message: string }> {
  try {
    const payload = JSON.parse(payloadStr) as PaymentPayload;

    // Log payment
    queries.logPayment({
      telegramId,
      chargeId,
      type: payload.type,
      amount,
      payload: { ...payload },
    });

    switch (payload.type) {
      case "subscription": {
        if (!payload.plan || payload.plan === "free") {
          return { success: false, message: "Неверный план" };
        }

        const expiresAt = new Date(
          Date.now() + 30 * 24 * 60 * 60 * 1000
        ).toISOString();
        queries.updateUserPlan(telegramId, payload.plan, expiresAt, chargeId);

        const planNames = { basic: "Basic", pro: "Pro", business: "Business" };
        return {
          success: true,
          message: `✅ Подписка ${planNames[payload.plan]} активирована до ${new Date(expiresAt).toLocaleDateString("ru")}`,
        };
      }

      case "analyze": {
        // Analyze will be handled separately after payment confirmation
        return {
          success: true,
          message: "✅ Оплата принята, запускаю анализ...",
        };
      }

      case "preset": {
        if (!payload.presetId) {
          return { success: false, message: "Пресет не указан" };
        }

        const accessType = payload.accessType || "lifetime";
        const expiresAt =
          accessType === "subscription"
            ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
            : null;

        queries.grantPresetAccess(
          telegramId,
          payload.presetId,
          accessType,
          expiresAt
        );

        const preset = queries
          .getRegionPresets()
          .find((p) => p.id === payload.presetId);
        return {
          success: true,
          message: `✅ Доступ к пресету "${preset?.region_name}" активирован${accessType === "subscription" ? " на 30 дней" : " навсегда"}`,
        };
      }

      case "promotion_group": {
        if (!payload.groupId) {
          return { success: false, message: "Группа не указана" };
        }

        const groupDays = payload.days || 3;
        queries.createPromotion({
          telegramId,
          type: "group",
          groupId: payload.groupId,
          durationDays: groupDays,
        });

        return {
          success: true,
          message: `✅ Продвижение группы активировано на ${groupDays} дней`,
        };
      }

      case "promotion_product": {
        if (!payload.messageId || !payload.groupId) {
          return { success: false, message: "Товар не указан" };
        }

        const productDays = payload.days || 3;
        queries.createPromotion({
          telegramId,
          type: "product",
          messageId: payload.messageId,
          productGroupId: payload.groupId,
          durationDays: productDays,
        });

        return {
          success: true,
          message: `✅ Продвижение товара активировано на ${productDays} дней`,
        };
      }

      case "publication": {
        if (!payload.publicationId) {
          return { success: false, message: "Публикация не указана" };
        }

        // Interactive publication will be started by the caller
        // Just return success here, the actual flow starts in bot handler
        return {
          success: true,
          message: "✅ Оплата принята! Сейчас начнём публикацию...",
        };
      }

      default:
        return { success: false, message: "Неизвестный тип платежа" };
    }
  } catch (error) {
    botLog.error({ error, chargeId }, "Failed to process payment");
    return { success: false, message: "Ошибка обработки платежа" };
  }
}

/**
 * Format plan info for display
 */
export function formatPlanInfo(telegramId: number): string {
  const { plan, plan_expires_at } = queries.getUserPlan(telegramId);
  const limits = queries.getPlanLimits(plan);
  const subCount = queries.getUserSubscriptionCount(telegramId);
  const freeAnalyzes = queries.getFreeAnalyzesUsed(telegramId);

  const planNames = {
    free: "Free",
    basic: "Basic",
    pro: "Pro",
    business: "Business",
  };

  const maxSubsDisplay =
    limits.maxSubscriptions === Infinity ? "∞" : limits.maxSubscriptions;
  const maxGroupsDisplay =
    limits.maxGroupsPerSubscription === Infinity
      ? "∞"
      : limits.maxGroupsPerSubscription;

  let info = `💎 Твой план: ${planNames[plan]}\n\n`;
  info += `Лимиты:\n`;
  info += `• Подписок: ${subCount}/${maxSubsDisplay}\n`;
  info += `• Групп на подписку: ${maxGroupsDisplay}\n`;

  if (plan === "free") {
    info += `• Бесплатных анализов: ${1 - freeAnalyzes}/1 (в 6 мес)\n`;
  }

  if (limits.hasPriority) {
    info += `• ⚡ Приоритетные пуши\n`;
  }
  if (limits.hasFora) {
    info += `• 👥 Видишь сколько людей ищут то же\n`;
  }
  if (limits.analyzePrice === 0) {
    info += `• 🔍 Бесплатный анализ товаров\n`;
  } else if (plan === "pro") {
    info += `• 🔍 Анализ со скидкой 50% (${limits.analyzePrice}⭐)\n`;
  }

  if (plan_expires_at && plan !== "free") {
    info += `\n📅 Действует до: ${new Date(plan_expires_at).toLocaleDateString("ru")}`;
  }

  return info;
}

/**
 * Check if user has priority notifications
 */
export function hasPriorityNotifications(telegramId: number): boolean {
  const { plan, plan_expires_at } = queries.getUserPlan(telegramId);
  if (plan === "free") return false;

  // Check if plan is still active
  if (plan_expires_at && new Date(plan_expires_at) < new Date()) {
    return false;
  }

  return true;
}

/**
 * Check if user can see "fora" (competitor count)
 */
export function canSeeFora(telegramId: number): boolean {
  const { plan, plan_expires_at } = queries.getUserPlan(telegramId);
  if (plan !== "pro" && plan !== "business") return false;

  // Check if plan is still active
  if (plan_expires_at && new Date(plan_expires_at) < new Date()) {
    return false;
  }

  return true;
}
