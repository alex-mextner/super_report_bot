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
  mode: UserMode = "advanced"
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
      .text(
        "🤖 Скорректировать с ИИ",
        JSON.stringify({ action: "regenerate_sub", id: subscriptionId })
      )
      .row();

    // Toggle button only if there are negative keywords (active or disabled)
    if (hasNegativeKeywords || hasDisabledNegative) {
      kb.text(
        hasNegativeKeywords ? "🚫 Откл. искл." : "✅ Вкл. искл.",
        JSON.stringify({ action: "toggle_negative", id: subscriptionId })
      );
    }
  }

  kb.text(
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

// Keyboard for AI correction of pending subscription
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
