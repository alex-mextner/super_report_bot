import { InlineKeyboard, Keyboard } from "gramio";
import type { PendingGroup, UserMode } from "../types";

// Request ID counter for requestChat buttons (signed 32-bit)
let requestIdCounter = 1;
export function nextRequestId(): number {
  const id = requestIdCounter;
  requestIdCounter = (requestIdCounter + 2) % 2147483647; // +2 to reserve pairs (group/channel)
  return id;
}

// Reply keyboard with requestChat buttons for native Telegram picker
export function groupPickerKeyboard(requestId: number): Keyboard {
  return new Keyboard()
    .requestChat("Выбрать группу", requestId, {
      chat_is_channel: false,
      request_title: true,
      request_username: true,
    })
    .row()
    .requestChat("Выбрать канал", requestId + 1, {
      chat_is_channel: true,
      request_title: true,
      request_username: true,
    })
    .row()
    .text("Готово")
    .oneTime()
    .resized();
}

// Inline keyboard for invite link prompt
export function inviteLinkKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("Пропустить", JSON.stringify({ action: "skip_invite_link" }))
    .row()
    .text("Отмена", JSON.stringify({ action: "cancel" }));
}

// Show pending groups with remove buttons
export function pendingGroupsKeyboard(groups: PendingGroup[]): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const g of groups) {
    const icon = g.isChannel ? "📢" : "👥";
    kb.text(
      `❌ ${icon} ${g.title || g.id}`,
      JSON.stringify({ action: "remove_pending", id: g.id })
    );
    kb.row();
  }
  return kb;
}

/**
 * Confirmation keyboard for subscription creation
 * Both modes: Confirm + Correct + Cancel
 * Advanced mode adds: manual keyword editing
 */
export const confirmKeyboard = (queryId: string, mode: UserMode = "advanced") => {
  const kb = new InlineKeyboard()
    .text("Подтвердить", JSON.stringify({ action: "confirm", id: queryId }))
    .text("🤖 Скорректировать", JSON.stringify({ action: "correct_pending", id: queryId }));

  if (mode === "advanced") {
    kb.row();
    kb.text("✏️ + слова", JSON.stringify({ action: "edit_positive_pending" }));
    kb.text("✏️ − слова", JSON.stringify({ action: "edit_negative_pending" }));
  }

  kb.row();
  kb.text("Отмена", JSON.stringify({ action: "cancel", id: queryId }));

  return kb;
};

export const subscriptionKeyboard = (
  subscriptionId: number,
  hasNegativeKeywords: boolean,
  hasDisabledNegative: boolean,
  mode: UserMode = "advanced",
  isPaused: boolean = false
) => {
  const kb = new InlineKeyboard();

  // Editing buttons only for advanced mode
  if (mode === "advanced") {
    kb.text(
      "✏️ + слова",
      JSON.stringify({ action: "edit_positive", id: subscriptionId })
    )
      .text(
        "✏️ − слова",
        JSON.stringify({ action: "edit_negative", id: subscriptionId })
      )
      .row()
      .text(
        "✏️ Описание",
        JSON.stringify({ action: "edit_description", id: subscriptionId })
      )
      .row();

    // Toggle button only if there are negative keywords (active or disabled)
    if (hasNegativeKeywords || hasDisabledNegative) {
      kb.text(
        hasNegativeKeywords ? "🚫 Откл. искл." : "✅ Вкл. искл.",
        JSON.stringify({ action: "toggle_negative", id: subscriptionId })
      );
      kb.row();
    }
  }

  // Pause/Resume button available in all modes
  kb.text(
    isPaused ? "▶️ Возобновить" : "⏸️ Пауза",
    JSON.stringify({ action: isPaused ? "resume" : "pause", id: subscriptionId })
  ).row();

  // AI edit button available in all modes
  kb.text(
    "🤖 Скорректировать с ИИ",
    JSON.stringify({ action: "regenerate_sub", id: subscriptionId })
  )
    .text(
      "❌ Удалить",
      JSON.stringify({ action: "disable", id: subscriptionId })
    );

  return kb;
};

export const backKeyboard = () =>
  new InlineKeyboard().text("Назад", JSON.stringify({ action: "back" }));

// Groups selection keyboard (for subscription creation)
export function groupsKeyboard(
  groups: { id: number; title: string }[],
  selectedIds: Set<number>,
  regionPresets?: Array<{
    id: number;
    region_name: string;
    groupIds: number[];
  }>
): InlineKeyboard {
  const kb = new InlineKeyboard();

  // Region presets at the top (if available)
  if (regionPresets && regionPresets.length > 0) {
    for (const preset of regionPresets) {
      // Check how many preset groups are available to user and selected
      const availablePresetGroups = preset.groupIds.filter((id) =>
        groups.some((g) => g.id === id)
      );
      const selectedPresetGroups = availablePresetGroups.filter((id) =>
        selectedIds.has(id)
      );
      const allSelected =
        availablePresetGroups.length > 0 &&
        selectedPresetGroups.length === availablePresetGroups.length;

      const icon = allSelected ? "✅" : "📂";
      kb.text(
        `${icon} ${preset.region_name} (${availablePresetGroups.length})`,
        JSON.stringify({ action: "toggle_preset", id: preset.id })
      );
      kb.row();
    }
  }

  // Individual groups
  for (const group of groups) {
    const isSelected = selectedIds.has(group.id);
    const label = isSelected ? `✅ ${group.title}` : group.title;
    kb.text(label, JSON.stringify({ action: "toggle_group", id: group.id }));
    kb.row();
  }

  kb.text("Выбрать все", JSON.stringify({ action: "select_all_groups" }));
  kb.text("Снять все", JSON.stringify({ action: "deselect_all_groups" }));
  kb.row();

  const hasSelected = selectedIds.size > 0;
  if (hasSelected) {
    kb.text(
      `Готово (${selectedIds.size})`,
      JSON.stringify({ action: "confirm_groups" })
    );
  } else {
    kb.text("Пропустить", JSON.stringify({ action: "skip_groups" }));
  }
  kb.row();
  kb.text("Отмена", JSON.stringify({ action: "cancel" }));

  return kb;
}

// Keyboard for clarification questions
export function skipQuestionKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text(
    "Пропустить →",
    JSON.stringify({ action: "skip_question" })
  );
}

// Keyboard for AI editing flow (after proposed changes shown)
export function aiEditKeyboard(subscriptionId: number): InlineKeyboard {
  return new InlineKeyboard()
    .text(
      "Применить",
      JSON.stringify({ action: "apply_ai_edit", id: subscriptionId })
    )
    .text(
      "Отмена",
      JSON.stringify({ action: "cancel_ai_edit", id: subscriptionId })
    );
}

// Keyboard for initial AI editing prompt (no "Apply" since no changes yet)
export function aiEditStartKeyboard(subscriptionId: number): InlineKeyboard {
  return new InlineKeyboard().text(
    "↩️ Назад",
    JSON.stringify({ action: "cancel_ai_edit", id: subscriptionId })
  );
}

// Keyboard for initial AI correction prompt (no "Apply" since no changes yet)
export function pendingAiCorrectionStartKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("↩️ Назад", JSON.stringify({ action: "cancel_pending_ai" }));
}

// Keyboard for AI correction of pending subscription (after AI response)
export function pendingAiEditKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("✅ Применить", JSON.stringify({ action: "apply_pending_ai" }))
    .text("↩️ Назад", JSON.stringify({ action: "cancel_pending_ai" }));
}

// Submenu for editing positive/negative keywords (add/remove choice)
export function keywordEditSubmenu(
  type: "positive" | "negative",
  subscriptionId: number
): InlineKeyboard {
  return new InlineKeyboard()
    .text("Добавить", JSON.stringify({ action: `add_${type}`, id: subscriptionId }))
    .text("Удалить", JSON.stringify({ action: `remove_${type}`, id: subscriptionId }))
    .row()
    .text("↩️ Назад", JSON.stringify({ action: "back_to_sub", id: subscriptionId }));
}

// Submenu for editing keywords during confirmation (pending subscription)
export function keywordEditSubmenuPending(
  type: "positive" | "negative"
): InlineKeyboard {
  return new InlineKeyboard()
    .text("Добавить", JSON.stringify({ action: `add_${type}_pending` }))
    .text("Удалить", JSON.stringify({ action: `remove_${type}_pending` }))
    .row()
    .text("↩️ Назад", JSON.stringify({ action: "back_to_confirm" }));
}

// Keyboard for removing keywords (shows each keyword as a button)
export function removeKeywordsKeyboard(
  keywords: string[],
  type: "positive" | "negative",
  subscriptionId: number | null // null for pending subscription
): InlineKeyboard {
  const kb = new InlineKeyboard();
  const isPending = subscriptionId === null;

  // Show keywords as buttons (max 3 per row for readability)
  for (let i = 0; i < keywords.length; i++) {
    const keyword = keywords[i];
    if (!keyword) continue;
    const action = isPending
      ? { action: "rm_kw_pending", type, idx: i }
      : { action: "rm_kw", type, id: subscriptionId, idx: i };
    kb.text(`❌ ${keyword}`, JSON.stringify(action));
    // New row every 2 keywords
    if ((i + 1) % 2 === 0) kb.row();
  }

  // Ensure we're on a new row before adding control buttons
  if (keywords.length % 2 !== 0) kb.row();

  const backAction = isPending
    ? { action: "back_to_confirm" }
    : { action: "back_to_sub", id: subscriptionId };
  kb.text("✅ Готово", JSON.stringify(backAction));

  return kb;
}

// =====================================================
// Rating examples keyboard
// =====================================================

/**
 * Keyboard for rating a single example message
 * Used during subscription creation to calibrate keywords
 */
export function ratingKeyboard(exampleIndex: number, totalExamples: number): InlineKeyboard {
  return new InlineKeyboard()
    .text("🔥 Горячо", JSON.stringify({ action: "rate_hot", idx: exampleIndex }))
    .text("☀️ Тепло", JSON.stringify({ action: "rate_warm", idx: exampleIndex }))
    .text("❄️ Холодно", JSON.stringify({ action: "rate_cold", idx: exampleIndex }))
    .row()
    .text(
      `Пропустить (${exampleIndex + 1}/${totalExamples})`,
      JSON.stringify({ action: "skip_rating" })
    );
}

// =====================================================
// Settings keyboard
// =====================================================

/**
 * Keyboard for /settings command
 * Allows user to toggle between normal and advanced modes
 */
export function settingsKeyboard(currentMode: UserMode): InlineKeyboard {
  const kb = new InlineKeyboard();

  if (currentMode === "normal") {
    kb.text("📊 Обычный режим ✓", JSON.stringify({ action: "noop" }));
    kb.text("🔬 Продвинутый", JSON.stringify({ action: "set_mode_advanced" }));
  } else {
    kb.text("📊 Обычный", JSON.stringify({ action: "set_mode_normal" }));
    kb.text("🔬 Продвинутый ✓", JSON.stringify({ action: "noop" }));
  }

  return kb;
}

// =====================================================
// Forward analysis keyboards
// =====================================================

/**
 * Actions keyboard for forward analysis (when message was rejected)
 * Used for each subscription analysis result
 * Note: callback_data has 64 byte limit, so keys are shortened
 */
export function forwardActionsKeyboard(
  subscriptionId: number,
  messageId: number,
  groupId: number,
  rejectionKeyword?: string | null
): InlineKeyboard {
  // If rejected by negative keyword - show "remove keyword" button
  if (rejectionKeyword) {
    return new InlineKeyboard().text(
      `🗑 Убрать "${rejectionKeyword}"`,
      JSON.stringify({ a: "rm_neg", s: subscriptionId, kw: rejectionKeyword })
    );
  }

  // Otherwise show expand + AI buttons
  return new InlineKeyboard()
    .text(
      "🔧 Расширить",
      JSON.stringify({ a: "exp", s: subscriptionId, m: messageId, g: groupId })
    )
    .text(
      "✏️ С ИИ",
      JSON.stringify({ a: "ai_fwd", s: subscriptionId })
    );
}

/**
 * Keyboard for "Analyze" button when message not found in DB
 * Text will be extracted from reply_to_message in callback handler
 */
export function analyzeForwardKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text(
    "🔍 Проанализировать",
    JSON.stringify({ action: "analyze_forward" })
  );
}

/**
 * Keyboard to suggest adding unmonitored group
 */
export function addGroupKeyboard(chatId: number, title?: string): InlineKeyboard {
  return new InlineKeyboard().text(
    "➕ Добавить группу",
    JSON.stringify({
      action: "add_group_quick",
      id: chatId,
      title: title || "Неизвестная группа",
    })
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//                       GROUP METADATA KEYBOARDS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Yes/No/Skip keyboard for marketplace question
 */
export function marketplaceKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("Да", JSON.stringify({ action: "metadata_marketplace", value: true }))
    .text("Нет", JSON.stringify({ action: "metadata_marketplace", value: false }))
    .row()
    .text("Пропустить →", JSON.stringify({ action: "metadata_skip" }));
}

/**
 * Skip-only keyboard for text input questions (country/city/currency)
 */
export function metadataSkipKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text("Пропустить →", JSON.stringify({ action: "metadata_skip" }));
}

/**
 * Keyboard for pre-filled value confirmation
 * Shows checkmark button with value, and Change/Skip options
 */
export function metadataPrefilledKeyboard(value: string, displayLabel: string): InlineKeyboard {
  return new InlineKeyboard()
    .text(`✓ ${displayLabel}`, JSON.stringify({ action: "metadata_confirm", value }))
    .row()
    .text("Изменить", JSON.stringify({ action: "metadata_change" }))
    .text("Пропустить →", JSON.stringify({ action: "metadata_skip" }));
}

/**
 * Keyboard for pre-filled currency confirmation (includes currency code)
 */
export function metadataCurrencyKeyboard(currencyCode: string, displayLabel: string): InlineKeyboard {
  return new InlineKeyboard()
    .text(`✓ ${displayLabel} (${currencyCode})`, JSON.stringify({ action: "metadata_confirm", value: currencyCode }))
    .row()
    .text("Изменить", JSON.stringify({ action: "metadata_change" }))
    .text("Пропустить →", JSON.stringify({ action: "metadata_skip" }));
}

// ═══════════════════════════════════════════════════════════════════════════════
//                       DELETION FEEDBACK KEYBOARDS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Keyboard for "Did you manage to buy?" question after subscription deletion
 */
export function feedbackOutcomeKeyboard(subscriptionId: number): InlineKeyboard {
  return new InlineKeyboard()
    .text("✅ Да", JSON.stringify({ action: "feedback_outcome", id: subscriptionId, outcome: "bought" }))
    .text("❌ Нет", JSON.stringify({ action: "feedback_outcome", id: subscriptionId, outcome: "not_bought" }))
    .text("🤷 Всё сложно", JSON.stringify({ action: "feedback_outcome", id: subscriptionId, outcome: "complicated" }));
}

/**
 * Keyboard for requesting review text (with "Not this time" option)
 */
export function feedbackReviewKeyboard(subscriptionId: number): InlineKeyboard {
  return new InlineKeyboard()
    .text("Не в этот раз", JSON.stringify({ action: "skip_feedback", id: subscriptionId }));
}

// ═══════════════════════════════════════════════════════════════════════════════
//                       PREMIUM / MONETIZATION KEYBOARDS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Main premium keyboard with upgrade options
 */
export function premiumKeyboard(currentPlan: string): InlineKeyboard {
  const kb = new InlineKeyboard();

  // Show upgrade options based on current plan
  if (currentPlan === "free") {
    kb.text("Basic — 50⭐/мес", JSON.stringify({ action: "upgrade", plan: "basic" }));
    kb.row();
    kb.text("Pro — 150⭐/мес", JSON.stringify({ action: "upgrade", plan: "pro" }));
    kb.row();
    kb.text("Business — 500⭐/мес", JSON.stringify({ action: "upgrade", plan: "business" }));
  } else if (currentPlan === "basic") {
    kb.text("Pro — 150⭐/мес", JSON.stringify({ action: "upgrade", plan: "pro" }));
    kb.row();
    kb.text("Business — 500⭐/мес", JSON.stringify({ action: "upgrade", plan: "business" }));
  } else if (currentPlan === "pro") {
    kb.text("Business — 500⭐/мес", JSON.stringify({ action: "upgrade", plan: "business" }));
  }
  // Business users don't see upgrade buttons

  return kb;
}

/**
 * Analyze button with price (shown in notifications)
 */
export function analyzeButtonKeyboard(
  messageId: number,
  groupId: number,
  price: number,
  subscriptionId?: number
): InlineKeyboard {
  const kb = new InlineKeyboard();

  const priceLabel = price === 0 ? "🔍 Анализ" : `🔍 Анализ — ${price}⭐`;
  kb.text(priceLabel, JSON.stringify({
    action: "analyze_product",
    m: messageId,
    g: groupId,
    s: subscriptionId
  }));

  return kb;
}

/**
 * "Miss" feedback button for notifications
 */
export function notificationFeedbackKeyboard(
  messageId: number,
  groupId: number,
  subscriptionId: number
): InlineKeyboard {
  return new InlineKeyboard()
    .text("👎 Мимо", JSON.stringify({
      action: "miss_feedback",
      m: messageId,
      g: groupId,
      s: subscriptionId
    }));
}

// =====================================================
// Promotion keyboards
// =====================================================

/**
 * Promote product button (shown to message author or admin)
 */
export function promoteProductKeyboard(
  messageId: number,
  groupId: number,
  isAdmin: boolean = false
): InlineKeyboard {
  const kb = new InlineKeyboard();

  if (isAdmin) {
    // Admin can promote for free
    kb.text("🚀 Продвинуть (админ)", JSON.stringify({
      action: "promote_product_admin",
      m: messageId,
      g: groupId
    }));
  } else {
    // Regular user pays 100⭐ for 3 days
    kb.text("🚀 Продвинуть — 100⭐", JSON.stringify({
      action: "promote_product",
      m: messageId,
      g: groupId
    }));
  }

  return kb;
}

/**
 * Promote group button (for group admins or bot admin)
 */
export function promoteGroupKeyboard(
  groupId: number,
  isAdmin: boolean = false
): InlineKeyboard {
  const kb = new InlineKeyboard();

  if (isAdmin) {
    kb.text("🚀 Продвинуть группу (админ)", JSON.stringify({
      action: "promote_group_admin",
      g: groupId
    }));
  } else {
    // 300⭐ for 3 days
    kb.text("🚀 Продвинуть группу — 300⭐", JSON.stringify({
      action: "promote_group",
      g: groupId
    }));
  }

  return kb;
}

/**
 * Promotion duration selection
 */
export function promotionDurationKeyboard(
  type: "product" | "group",
  targetId: number,
  groupId?: number,
  isAdmin: boolean = false
): InlineKeyboard {
  const kb = new InlineKeyboard();

  const prices = type === "product"
    ? { d3: 100, d7: 200, d30: 500 }
    : { d3: 300, d7: 600, d30: 1500 };

  if (isAdmin) {
    // Admin gets free promotions with duration selection
    kb.text("3 дня", JSON.stringify({
      action: `buy_promo_${type}`,
      id: targetId,
      g: groupId,
      days: 3,
      admin: true
    }));
    kb.text("7 дней", JSON.stringify({
      action: `buy_promo_${type}`,
      id: targetId,
      g: groupId,
      days: 7,
      admin: true
    }));
    kb.text("30 дней", JSON.stringify({
      action: `buy_promo_${type}`,
      id: targetId,
      g: groupId,
      days: 30,
      admin: true
    }));
  } else {
    kb.text(`3 дня — ${prices.d3}⭐`, JSON.stringify({
      action: `buy_promo_${type}`,
      id: targetId,
      g: groupId,
      days: 3
    }));
    kb.text(`7 дней — ${prices.d7}⭐`, JSON.stringify({
      action: `buy_promo_${type}`,
      id: targetId,
      g: groupId,
      days: 7
    }));
    kb.row();
    kb.text(`30 дней — ${prices.d30}⭐`, JSON.stringify({
      action: `buy_promo_${type}`,
      id: targetId,
      g: groupId,
      days: 30
    }));
  }

  kb.row();
  kb.text("❌ Отмена", JSON.stringify({ action: "cancel_promo" }));

  return kb;
}

// =====================================================
// Region Presets keyboards
// =====================================================

/**
 * Keyboard for /presets command — list of available presets
 */
export function presetsListKeyboard(
  presets: Array<{
    id: number;
    region_code: string;
    region_name: string;
    group_count: number;
    hasAccess: boolean;
  }>
): InlineKeyboard {
  const kb = new InlineKeyboard();

  for (const preset of presets) {
    const icon = preset.hasAccess ? "✅" : "🔒";
    const label = `${icon} ${preset.region_name} (${preset.group_count} групп)`;
    kb.text(label, JSON.stringify({ action: "preset_info", id: preset.id }));
    kb.row();
  }

  return kb;
}

/**
 * Keyboard for preset details — buy options
 */
export function presetBuyKeyboard(
  presetId: number,
  hasAccess: boolean
): InlineKeyboard {
  const kb = new InlineKeyboard();

  if (hasAccess) {
    kb.text("✅ Доступ активен", JSON.stringify({ action: "noop" }));
  } else {
    kb.text("🔓 Навсегда — 1000⭐", JSON.stringify({
      action: "buy_preset",
      id: presetId,
      type: "lifetime"
    }));
    kb.row();
    kb.text("📅 На месяц — 300⭐", JSON.stringify({
      action: "buy_preset",
      id: presetId,
      type: "subscription"
    }));
  }

  kb.row();
  kb.text("« Назад", JSON.stringify({ action: "presets_list" }));

  return kb;
}

/**
 * Keyboard for selecting region (country) before creating subscription
 */
export function regionSelectionKeyboard(
  countries: Array<{ country_code: string; country_name: string }>
): InlineKeyboard {
  const kb = new InlineKeyboard();

  for (const country of countries) {
    kb.text(country.country_name, JSON.stringify({ action: "select_region", code: country.country_code }));
    kb.row();
  }

  // "Other" button for users from unlisted countries
  kb.text("🌍 Другой", JSON.stringify({ action: "select_region", code: "other" }));

  return kb;
}

/**
 * Keyboard for selecting preset as group source when creating subscription
 */
export function presetSelectionKeyboard(
  presets: Array<{
    id: number;
    region_name: string;
    group_count: number;
    hasAccess: boolean;
  }>
): InlineKeyboard {
  const kb = new InlineKeyboard();

  for (const preset of presets) {
    if (preset.hasAccess) {
      kb.text(
        `📦 ${preset.region_name} (${preset.group_count})`,
        JSON.stringify({ action: "use_preset", id: preset.id })
      );
      kb.row();
    }
  }

  kb.text("Выбрать группы вручную", JSON.stringify({ action: "select_groups_manual" }));

  return kb;
}

// =====================================================
// Publication keyboards
// =====================================================

/**
 * Main /publish menu keyboard
 */
export function publishMenuKeyboard(hasSession: boolean): InlineKeyboard {
  const kb = new InlineKeyboard();

  if (hasSession) {
    kb.text("📝 Создать объявление", JSON.stringify({ action: "create_publication" }));
    kb.row();
    kb.text("📋 Мои публикации", JSON.stringify({ action: "my_publications" }));
    kb.row();
    kb.text("🔌 Отключить аккаунт", JSON.stringify({ action: "disconnect_account" }));
  } else {
    kb.text("🔗 Подключить Telegram", JSON.stringify({ action: "connect_telegram" }));
  }

  return kb;
}

/**
 * Preset selection for publication
 */
export function publishPresetKeyboard(
  presets: Array<{ id: number; region_name: string; group_count: number }>
): InlineKeyboard {
  const kb = new InlineKeyboard();

  for (const preset of presets) {
    kb.text(
      `📦 ${preset.region_name} (${preset.group_count} групп)`,
      JSON.stringify({ action: "publish_to_preset", id: preset.id })
    );
    kb.row();
  }

  kb.text("❌ Отмена", JSON.stringify({ action: "cancel_publication" }));

  return kb;
}

/**
 * Publication confirmation keyboard
 */
export function publishConfirmKeyboard(publicationId: number): InlineKeyboard {
  return new InlineKeyboard()
    .text("✅ Опубликовать — 100⭐", JSON.stringify({ action: "confirm_publication", id: publicationId }))
    .row()
    .text("❌ Отмена", JSON.stringify({ action: "cancel_publication" }));
}

/**
 * Cancel auth keyboard
 */
export function cancelAuthKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("❌ Отмена", JSON.stringify({ action: "cancel_auth" }));
}

/**
 * Content input keyboard (for publication text + photos)
 */
export function contentInputKeyboard(hasContent: boolean = false): InlineKeyboard {
  const kb = new InlineKeyboard();
  if (hasContent) {
    kb.text("✅ Готово", JSON.stringify({ action: "content_done" }));
    kb.row();
  }
  kb.text("❌ Отмена", JSON.stringify({ action: "cancel_auth" }));
  return kb;
}
