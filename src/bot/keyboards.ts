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
  selectedIds: Set<number>
): InlineKeyboard {
  const kb = new InlineKeyboard();

  // DEBUG: Log keyboard generation
  console.log("[groupsKeyboard] Generating keyboard for groups:", groups.map(g => ({ id: g.id, title: g.title })));

  for (const group of groups) {
    const isSelected = selectedIds.has(group.id);
    const label = isSelected ? `✅ ${group.title}` : group.title;
    const callbackData = JSON.stringify({ action: "toggle_group", id: group.id });
    // DEBUG: Log each button
    console.log(`[groupsKeyboard] Button: "${label}" -> callback_data: ${callbackData}`);
    kb.text(label, callbackData);
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
