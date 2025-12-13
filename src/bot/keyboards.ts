import { InlineKeyboard, Keyboard } from "gramio";
import type { PendingGroup, UserMode } from "../types";
import { type Locale, type Translator } from "../i18n/index.ts";

// Language selection keyboard (no translation needed - shows all languages)
export function languageKeyboard(currentLang?: Locale): InlineKeyboard {
  const kb = new InlineKeyboard();
  const check = (lang: Locale) => (currentLang === lang ? " ✓" : "");

  return kb
    .text(`🇷🇺 Русский${check("ru")}`, JSON.stringify({ a: "lang", l: "ru" }))
    .text(`🇬🇧 English${check("en")}`, JSON.stringify({ a: "lang", l: "en" }))
    .row()
    .text(`🇷🇸 Srpski${check("rs")}`, JSON.stringify({ a: "lang", l: "rs" }));
}

// Request ID counter for requestChat buttons (signed 32-bit)
let requestIdCounter = 1;
export function nextRequestId(): number {
  const id = requestIdCounter;
  requestIdCounter = (requestIdCounter + 2) % 2147483647;
  return id;
}

// Reply keyboard with requestChat buttons for native Telegram picker
export function groupPickerKeyboard(requestId: number, t: Translator): Keyboard {
  return new Keyboard()
    .requestChat(t("kb_select_group"), requestId, {
      chat_is_channel: false,
      request_title: true,
      request_username: true,
    })
    .row()
    .requestChat(t("kb_select_channel"), requestId + 1, {
      chat_is_channel: true,
      request_title: true,
      request_username: true,
    })
    .row()
    .text(t("kb_done"))
    .oneTime()
    .resized();
}

// Inline keyboard for invite link prompt
export function inviteLinkKeyboard(t: Translator): InlineKeyboard {
  return new InlineKeyboard()
    .text(t("kb_skip"), JSON.stringify({ action: "skip_invite_link" }))
    .row()
    .text(t("kb_cancel"), JSON.stringify({ action: "cancel" }));
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

// Basic confirmation keyboard for subscription creation
export const confirmKeyboard = (
  queryId: string,
  t: Translator,
  positiveCount?: number,
  negativeCount?: number
) => {
  const kb = new InlineKeyboard();

  // Add show keywords button if counts provided (normal mode)
  if (positiveCount !== undefined) {
    const label = negativeCount
      ? `${t("kb_show_keywords")} (${positiveCount}+${negativeCount})`
      : `${t("kb_show_keywords")} (${positiveCount})`;
    kb.text(label, JSON.stringify({ action: "show_pending_keywords" })).row();
  }

  kb.text(t("kb_confirm"), JSON.stringify({ action: "confirm", id: queryId }))
    .text(t("kb_adjust_ai"), JSON.stringify({ action: "correct_pending", id: queryId }))
    .row()
    .text(t("kb_cancel"), JSON.stringify({ action: "cancel", id: queryId }));

  return kb;
};

// Confirmation keyboard with keyword editing buttons (for advanced mode)
export const keywordEditConfirmKeyboard = (queryId: string, t: Translator) => {
  return new InlineKeyboard()
    .text(t("kb_confirm"), JSON.stringify({ action: "confirm", id: queryId }))
    .text(t("kb_adjust_ai"), JSON.stringify({ action: "correct_pending", id: queryId }))
    .row()
    .text(t("kb_add_words"), JSON.stringify({ action: "edit_positive_pending" }))
    .text(t("kb_remove_words"), JSON.stringify({ action: "edit_negative_pending" }))
    .row()
    .text(t("kb_cancel"), JSON.stringify({ action: "cancel", id: queryId }));
};

export const subscriptionKeyboard = (
  subscriptionId: number,
  hasNegativeKeywords: boolean,
  hasDisabledNegative: boolean,
  mode: UserMode,
  isPaused: boolean,
  positiveKeywordsCount: number,
  t: Translator
) => {
  const kb = new InlineKeyboard();

  if (mode === "advanced") {
    kb.text(t("kb_add_words"), JSON.stringify({ action: "edit_positive", id: subscriptionId }))
      .text(t("kb_remove_words"), JSON.stringify({ action: "edit_negative", id: subscriptionId }))
      .row()
      .text(t("kb_edit_description"), JSON.stringify({ action: "edit_description", id: subscriptionId }))
      .row();

    if (hasNegativeKeywords || hasDisabledNegative) {
      kb.text(
        hasNegativeKeywords ? t("kb_disable_negative") : t("kb_enable_negative"),
        JSON.stringify({ action: "toggle_negative", id: subscriptionId })
      );
      kb.row();
    }
  } else {
    kb.text(`${t("kb_show_keywords")} (${positiveKeywordsCount})`, JSON.stringify({ action: "show_keywords", id: subscriptionId })).row();
  }

  kb.text(t("kb_adjust_ai_full"), JSON.stringify({ action: "regenerate_sub", id: subscriptionId })).row();

  kb.text(
    isPaused ? t("kb_resume") : t("kb_pause"),
    JSON.stringify({ action: isPaused ? "resume" : "pause", id: subscriptionId })
  ).text(t("kb_delete"), JSON.stringify({ action: "disable", id: subscriptionId }));

  return kb;
};

export const backKeyboard = (t: Translator) =>
  new InlineKeyboard().text(t("kb_back"), JSON.stringify({ action: "back" }));

// Groups selection keyboard (for subscription creation)
export function groupsKeyboard(
  groups: { id: number; title: string }[],
  selectedIds: Set<number>,
  regionPresets: Array<{ id: number; region_name: string; groupIds: number[] }> | undefined,
  t: Translator
): InlineKeyboard {
  const kb = new InlineKeyboard();

  // Collect all preset group IDs to hide them from main list
  const presetGroupIds = new Set(regionPresets?.flatMap((p) => p.groupIds) ?? []);

  // Show presets at the top with 📂 icon
  if (regionPresets && regionPresets.length > 0) {
    for (const preset of regionPresets) {
      const selectedPresetGroups = preset.groupIds.filter((id) => selectedIds.has(id));
      const allSelected = preset.groupIds.length > 0 && selectedPresetGroups.length === preset.groupIds.length;

      const icon = allSelected ? "✅" : "📂";
      kb.text(`${icon} ${preset.region_name} (${preset.groupIds.length})`, JSON.stringify({ action: "toggle_preset", id: preset.id }));
      kb.row();
    }
  }

  // Show only groups that are NOT in any preset
  for (const group of groups) {
    if (presetGroupIds.has(group.id)) continue;
    const isSelected = selectedIds.has(group.id);
    const label = isSelected ? `✅ ${group.title}` : group.title;
    kb.text(label, JSON.stringify({ action: "toggle_group", id: group.id }));
    kb.row();
  }

  kb.text(t("kb_select_all"), JSON.stringify({ action: "select_all_groups" }));
  kb.text(t("kb_deselect_all"), JSON.stringify({ action: "deselect_all_groups" }));
  kb.row();

  const hasSelected = selectedIds.size > 0;
  if (hasSelected) {
    kb.text(t("kb_done_count", { n: selectedIds.size }), JSON.stringify({ action: "confirm_groups" }));
  } else {
    kb.text(t("kb_skip"), JSON.stringify({ action: "skip_groups" }));
  }
  kb.row();
  kb.text(t("kb_cancel"), JSON.stringify({ action: "cancel" }));

  return kb;
}

// Keyboard for clarification questions
export function skipQuestionKeyboard(t: Translator): InlineKeyboard {
  return new InlineKeyboard().text(t("kb_skip_arrow"), JSON.stringify({ action: "skip_question" }));
}

// Keyboard for AI editing flow (after proposed changes shown)
export function aiEditKeyboard(subscriptionId: number, t: Translator): InlineKeyboard {
  return new InlineKeyboard()
    .text(t("kb_apply"), JSON.stringify({ action: "apply_ai_edit", id: subscriptionId }))
    .text(t("kb_cancel"), JSON.stringify({ action: "cancel_ai_edit", id: subscriptionId }))
    .row()
    .text(t("kb_manual_ai_edit"), JSON.stringify({ action: "manual_ai_edit", id: subscriptionId }));
}

// Keyboard for initial AI editing prompt
export function aiEditStartKeyboard(subscriptionId: number, t: Translator): InlineKeyboard {
  return new InlineKeyboard().text(`↩️ ${t("kb_back")}`, JSON.stringify({ action: "cancel_ai_edit", id: subscriptionId }));
}

// Keyboard for initial AI correction prompt
export function pendingAiCorrectionStartKeyboard(t: Translator): InlineKeyboard {
  return new InlineKeyboard().text(`↩️ ${t("kb_back")}`, JSON.stringify({ action: "cancel_pending_ai" }));
}

// Keyboard for AI correction of pending subscription (after AI response)
export function pendingAiEditKeyboard(t: Translator): InlineKeyboard {
  return new InlineKeyboard()
    .text(t("kb_apply_check"), JSON.stringify({ action: "apply_pending_ai" }))
    .text(`↩️ ${t("kb_back")}`, JSON.stringify({ action: "cancel_pending_ai" }));
}

// Submenu for editing positive/negative keywords (add/remove choice)
export function keywordEditSubmenu(type: "positive" | "negative", subscriptionId: number, t: Translator): InlineKeyboard {
  return new InlineKeyboard()
    .text(t("kb_add"), JSON.stringify({ action: `add_${type}`, id: subscriptionId }))
    .text(t("kb_remove"), JSON.stringify({ action: `remove_${type}`, id: subscriptionId }))
    .row()
    .text(`↩️ ${t("kb_back")}`, JSON.stringify({ action: "back_to_sub", id: subscriptionId }));
}

// Submenu for editing keywords during confirmation (pending subscription)
export function keywordEditSubmenuPending(type: "positive" | "negative", t: Translator): InlineKeyboard {
  return new InlineKeyboard()
    .text(t("kb_add"), JSON.stringify({ action: `add_${type}_pending` }))
    .text(t("kb_remove"), JSON.stringify({ action: `remove_${type}_pending` }))
    .row()
    .text(`↩️ ${t("kb_back")}`, JSON.stringify({ action: "back_to_confirm" }));
}

// Keyboard for removing keywords (shows each keyword as a button)
export function removeKeywordsKeyboard(
  keywords: string[],
  type: "positive" | "negative",
  subscriptionId: number | null,
  t: Translator
): InlineKeyboard {
  const kb = new InlineKeyboard();
  const isPending = subscriptionId === null;

  for (let i = 0; i < keywords.length; i++) {
    const keyword = keywords[i];
    if (!keyword) continue;
    const action = isPending
      ? { action: "rm_kw_pending", type, idx: i }
      : { action: "rm_kw", type, id: subscriptionId, idx: i };
    kb.text(`❌ ${keyword}`, JSON.stringify(action));
    if ((i + 1) % 2 === 0) kb.row();
  }

  if (keywords.length % 2 !== 0) kb.row();

  const backAction = isPending ? { action: "back_to_confirm" } : { action: "back_to_sub", id: subscriptionId };
  kb.text(`✅ ${t("kb_done")}`, JSON.stringify(backAction));

  return kb;
}

// Rating examples keyboard
export function ratingKeyboard(exampleIndex: number, totalExamples: number, t: Translator): InlineKeyboard {
  return new InlineKeyboard()
    .text(t("kb_rate_hot"), JSON.stringify({ action: "rate_hot", idx: exampleIndex }))
    .text(t("kb_rate_warm"), JSON.stringify({ action: "rate_warm", idx: exampleIndex }))
    .text(t("kb_rate_cold"), JSON.stringify({ action: "rate_cold", idx: exampleIndex }))
    .row()
    .text(t("kb_skip_rating", { n: exampleIndex + 1, total: totalExamples }), JSON.stringify({ action: "skip_rating" }));
}

// Settings keyboard
export function settingsKeyboard(currentMode: UserMode, t: Translator): InlineKeyboard {
  const kb = new InlineKeyboard();

  if (currentMode === "normal") {
    kb.text(`${t("kb_mode_normal")} ✓`, JSON.stringify({ action: "noop" }));
    kb.text(t("kb_mode_advanced"), JSON.stringify({ action: "set_mode_advanced" }));
  } else {
    kb.text(t("kb_mode_normal"), JSON.stringify({ action: "set_mode_normal" }));
    kb.text(`${t("kb_mode_advanced")} ✓`, JSON.stringify({ action: "noop" }));
  }

  return kb;
}

// Forward analysis keyboards
export function forwardActionsKeyboard(
  subscriptionId: number,
  messageId: number,
  groupId: number,
  rejectionKeyword: string | null | undefined,
  t: Translator
): InlineKeyboard {
  if (rejectionKeyword) {
    return new InlineKeyboard().text(
      t("kb_remove_keyword", { kw: rejectionKeyword }),
      JSON.stringify({ a: "rm_neg", s: subscriptionId, kw: rejectionKeyword })
    );
  }

  return new InlineKeyboard()
    .text(t("kb_expand"), JSON.stringify({ a: "exp", s: subscriptionId, m: messageId, g: groupId }))
    .text(t("kb_with_ai"), JSON.stringify({ a: "ai_fwd", s: subscriptionId }));
}

export function analyzeForwardKeyboard(t: Translator): InlineKeyboard {
  return new InlineKeyboard().text(t("kb_analyze"), JSON.stringify({ action: "analyze_forward" }));
}

export function addGroupKeyboard(chatId: number, title: string | undefined, t: Translator): InlineKeyboard {
  return new InlineKeyboard().text(
    `➕ ${t("kb_add_group")}`,
    JSON.stringify({ action: "add_group_quick", id: chatId, title: title || "Unknown" })
  );
}

// Deletion feedback keyboards
export function feedbackOutcomeKeyboard(subscriptionId: number, t: Translator): InlineKeyboard {
  return new InlineKeyboard()
    .text(`✅ ${t("kb_yes")}`, JSON.stringify({ action: "feedback_outcome", id: subscriptionId, outcome: "bought" }))
    .text(`❌ ${t("kb_no")}`, JSON.stringify({ action: "feedback_outcome", id: subscriptionId, outcome: "not_bought" }))
    .text("🤷", JSON.stringify({ action: "feedback_outcome", id: subscriptionId, outcome: "complicated" }));
}

export function feedbackReviewKeyboard(subscriptionId: number, t: Translator): InlineKeyboard {
  return new InlineKeyboard().text(t("kb_not_this_time"), JSON.stringify({ action: "skip_feedback", id: subscriptionId }));
}

// Premium / monetization keyboards
export function premiumKeyboard(currentPlan: string, t: Translator): InlineKeyboard {
  const kb = new InlineKeyboard();

  if (currentPlan === "free") {
    kb.text(t("kb_plan_basic"), JSON.stringify({ action: "upgrade", plan: "basic" }));
    kb.row();
    kb.text(t("kb_plan_pro"), JSON.stringify({ action: "upgrade", plan: "pro" }));
    kb.row();
    kb.text(t("kb_plan_business"), JSON.stringify({ action: "upgrade", plan: "business" }));
  } else if (currentPlan === "basic") {
    kb.text(t("kb_plan_pro"), JSON.stringify({ action: "upgrade", plan: "pro" }));
    kb.row();
    kb.text(t("kb_plan_business"), JSON.stringify({ action: "upgrade", plan: "business" }));
  } else if (currentPlan === "pro") {
    kb.text(t("kb_plan_business"), JSON.stringify({ action: "upgrade", plan: "business" }));
  }

  return kb;
}

export function analyzeButtonKeyboard(
  messageId: number,
  groupId: number,
  price: number,
  subscriptionId: number | undefined,
  t: Translator
): InlineKeyboard {
  const kb = new InlineKeyboard();
  const priceLabel = price === 0 ? t("kb_analyze_free") : t("kb_analyze_price", { n: price });
  kb.text(priceLabel, JSON.stringify({ action: "analyze_product", m: messageId, g: groupId, s: subscriptionId }));
  return kb;
}

export function notificationFeedbackKeyboard(
  messageId: number,
  groupId: number,
  subscriptionId: number,
  t: Translator
): InlineKeyboard {
  return new InlineKeyboard().text(t("kb_miss"), JSON.stringify({ action: "miss_feedback", m: messageId, g: groupId, s: subscriptionId }));
}

// Promotion keyboards
export function promoteProductKeyboard(messageId: number, groupId: number, isAdmin: boolean, t: Translator): InlineKeyboard {
  const kb = new InlineKeyboard();
  if (isAdmin) {
    kb.text(t("kb_promote_admin"), JSON.stringify({ action: "promote_product_admin", m: messageId, g: groupId }));
  } else {
    kb.text(t("kb_promote_price", { n: 100 }), JSON.stringify({ action: "promote_product", m: messageId, g: groupId }));
  }
  return kb;
}

export function promoteGroupKeyboard(groupId: number, isAdmin: boolean, t: Translator): InlineKeyboard {
  const kb = new InlineKeyboard();
  if (isAdmin) {
    kb.text(t("kb_promote_group_admin"), JSON.stringify({ action: "promote_group_admin", g: groupId }));
  } else {
    kb.text(t("kb_promote_group_price", { n: 300 }), JSON.stringify({ action: "promote_group", g: groupId }));
  }
  return kb;
}

export function promotionDurationKeyboard(
  type: "product" | "group",
  targetId: number,
  groupId: number | undefined,
  isAdmin: boolean,
  t: Translator
): InlineKeyboard {
  const kb = new InlineKeyboard();
  const prices = type === "product" ? { d3: 100, d7: 200, d30: 500 } : { d3: 300, d7: 600, d30: 1500 };

  if (isAdmin) {
    kb.text(t("kb_days_price", { days: "3", price: "0" }), JSON.stringify({ action: `buy_promo_${type}`, id: targetId, g: groupId, days: 3, admin: true }));
    kb.text(t("kb_days_price", { days: "7", price: "0" }), JSON.stringify({ action: `buy_promo_${type}`, id: targetId, g: groupId, days: 7, admin: true }));
    kb.text(t("kb_days_price", { days: "30", price: "0" }), JSON.stringify({ action: `buy_promo_${type}`, id: targetId, g: groupId, days: 30, admin: true }));
  } else {
    kb.text(t("kb_days_price", { days: "3", price: String(prices.d3) }), JSON.stringify({ action: `buy_promo_${type}`, id: targetId, g: groupId, days: 3 }));
    kb.text(t("kb_days_price", { days: "7", price: String(prices.d7) }), JSON.stringify({ action: `buy_promo_${type}`, id: targetId, g: groupId, days: 7 }));
    kb.row();
    kb.text(t("kb_days_price", { days: "30", price: String(prices.d30) }), JSON.stringify({ action: `buy_promo_${type}`, id: targetId, g: groupId, days: 30 }));
  }

  kb.row();
  kb.text(`❌ ${t("kb_cancel")}`, JSON.stringify({ action: "cancel_promo" }));

  return kb;
}

// Region Presets keyboards
export function presetsListKeyboard(
  presets: Array<{ id: number; region_code: string; region_name: string; group_count: number; hasAccess: boolean }>,
  t: Translator
): InlineKeyboard {
  const kb = new InlineKeyboard();

  for (const preset of presets) {
    const icon = preset.hasAccess ? "✅" : "🔒";
    const label = `${icon} ${preset.region_name} (${preset.group_count})`;
    kb.text(label, JSON.stringify({ action: "preset_info", id: preset.id }));
    kb.row();
  }

  return kb;
}

export function presetBuyKeyboard(presetId: number, hasAccess: boolean, t: Translator): InlineKeyboard {
  const kb = new InlineKeyboard();

  if (hasAccess) {
    kb.text(t("kb_access_active"), JSON.stringify({ action: "noop" }));
  } else {
    kb.text(t("kb_buy_lifetime", { n: 1000 }), JSON.stringify({ action: "buy_preset", id: presetId, type: "lifetime" }));
    kb.row();
    kb.text(t("kb_buy_month", { n: 300 }), JSON.stringify({ action: "buy_preset", id: presetId, type: "subscription" }));
  }

  kb.row();
  kb.text(`« ${t("kb_back")}`, JSON.stringify({ action: "presets_list" }));

  return kb;
}

export function regionSelectionKeyboard(countries: Array<{ country_code: string; country_name: string }>, t: Translator): InlineKeyboard {
  const kb = new InlineKeyboard();

  for (const country of countries) {
    kb.text(country.country_name, JSON.stringify({ action: "select_region", code: country.country_code }));
    kb.row();
  }

  kb.text(t("kb_other_region"), JSON.stringify({ action: "select_region", code: "other" }));

  return kb;
}

// Simple region keyboard: Belgrade / Novi Sad / Other (for new users)
export function simpleRegionKeyboard(t: Translator): InlineKeyboard {
  return new InlineKeyboard()
    .text(t("region_belgrade"), JSON.stringify({ action: "select_region", code: "rs_belgrade" }))
    .row()
    .text(t("region_novi_sad"), JSON.stringify({ action: "select_region", code: "rs_novi_sad" }))
    .row()
    .text(t("region_other"), JSON.stringify({ action: "select_region", code: "other" }));
}

export function presetSelectionKeyboard(
  presets: Array<{ id: number; region_name: string; group_count: number; hasAccess: boolean }>,
  t: Translator
): InlineKeyboard {
  const kb = new InlineKeyboard();

  for (const preset of presets) {
    if (preset.hasAccess) {
      kb.text(`📦 ${preset.region_name} (${preset.group_count})`, JSON.stringify({ action: "use_preset", id: preset.id }));
      kb.row();
    }
  }

  kb.text(t("kb_select_manual"), JSON.stringify({ action: "select_groups_manual" }));

  return kb;
}

// Publication keyboards
export function publishMenuKeyboard(hasSession: boolean, t: Translator): InlineKeyboard {
  const kb = new InlineKeyboard();

  if (hasSession) {
    kb.text(t("kb_create_publication"), JSON.stringify({ action: "create_publication" }));
    kb.row();
    kb.text(t("kb_my_publications"), JSON.stringify({ action: "my_publications" }));
    kb.row();
    kb.text(t("kb_disconnect"), JSON.stringify({ action: "disconnect_account" }));
  } else {
    kb.text(t("kb_connect_telegram"), JSON.stringify({ action: "connect_telegram" }));
  }

  return kb;
}

export function publishPresetKeyboard(
  presets: Array<{ id: number; region_name: string; group_count: number }>,
  t: Translator
): InlineKeyboard {
  const kb = new InlineKeyboard();

  for (const preset of presets) {
    kb.text(`📦 ${preset.region_name} (${preset.group_count})`, JSON.stringify({ action: "publish_to_preset", id: preset.id }));
    kb.row();
  }

  kb.text(`❌ ${t("kb_cancel")}`, JSON.stringify({ action: "cancel_publication" }));

  return kb;
}

export function publishConfirmKeyboard(publicationId: number, hasCredit: boolean, t: Translator): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  if (hasCredit) {
    keyboard.text(t("kb_use_free_pub"), JSON.stringify({ action: "use_pub_credit", id: publicationId }));
    keyboard.row();
  }

  keyboard.text(t("kb_publish_price", { n: 100 }), JSON.stringify({ action: "confirm_publication", id: publicationId }));
  keyboard.row();
  keyboard.text(`❌ ${t("kb_cancel")}`, JSON.stringify({ action: "cancel_publication" }));

  return keyboard;
}

export function cancelAuthKeyboard(t: Translator): InlineKeyboard {
  return new InlineKeyboard().text(`❌ ${t("kb_cancel")}`, JSON.stringify({ action: "cancel_auth" }));
}

export function contentInputKeyboard(hasContent: boolean, t: Translator): InlineKeyboard {
  const kb = new InlineKeyboard();
  if (hasContent) {
    kb.text(`✅ ${t("kb_done")}`, JSON.stringify({ action: "content_done" }));
    kb.row();
  }
  kb.text(`❌ ${t("kb_cancel")}`, JSON.stringify({ action: "cancel_auth" }));
  return kb;
}
