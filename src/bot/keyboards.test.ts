/**
 * KEYBOARDS — inline keyboards для Telegram бота
 *
 * Тесты проверяют ДЕЙСТВИЯ (callback actions), а не UI (текст кнопок, layout).
 * Это позволяет менять текст кнопок без поломки тестов.
 *
 * Каждый callback содержит JSON: { action: "confirm", id: "...", ... }
 * FSM и handlers обрабатывают actions, не зная про UI.
 *
 * Режимы:
 * - normal: упрощённый UI, только confirm/cancel/ai_correct
 * - advanced: полный UI с ручным редактированием keywords
 */

import { describe, test, expect } from "bun:test";
import {
  confirmKeyboard,
  keywordEditConfirmKeyboard,
  subscriptionKeyboard,
  backKeyboard,
  groupPickerKeyboard,
  inviteLinkKeyboard,
  pendingGroupsKeyboard,
  nextRequestId,
} from "./keyboards.ts";
import type { PendingGroup } from "../types.ts";
import { getTranslatorForLocale } from "../i18n/index.ts";

// Use Russian translator for tests
const tr = getTranslatorForLocale("ru");

describe("confirmKeyboard", () => {
  test("has all required actions for subscription confirmation flow", () => {
    const queryId = "user123_1234567890";
    const keyboard = confirmKeyboard(queryId, tr);
    const json = keyboard.toJSON();

    // Extract all callback actions from keyboard
    const allButtons = json.inline_keyboard.flat();
    const actions = allButtons.map((btn) => {
      const data = JSON.parse((btn as { callback_data: string }).callback_data);
      return data.action;
    });

    // Test behavior: keyboard must have these actions to support the flow
    // Don't care about exact button text or layout - just that actions exist
    expect(actions).toContain("confirm");
    expect(actions).toContain("correct_pending");
    expect(actions).toContain("cancel");
  });

  test("keywordEditConfirmKeyboard includes manual keyword editing actions", () => {
    const keyboard = keywordEditConfirmKeyboard("test_id", tr);
    const json = keyboard.toJSON();

    const allButtons = json.inline_keyboard.flat();
    const actions = allButtons.map((btn) => {
      const data = JSON.parse((btn as { callback_data: string }).callback_data);
      return data.action;
    });

    expect(actions).toContain("edit_positive_pending");
    expect(actions).toContain("edit_negative_pending");
  });

  test("basic confirmKeyboard excludes manual keyword editing", () => {
    const keyboard = confirmKeyboard("test_id", tr);
    const json = keyboard.toJSON();

    const allButtons = json.inline_keyboard.flat();
    const actions = allButtons.map((btn) => {
      const data = JSON.parse((btn as { callback_data: string }).callback_data);
      return data.action;
    });

    expect(actions).not.toContain("edit_positive_pending");
    expect(actions).not.toContain("edit_negative_pending");
  });

  test("all buttons have valid JSON callback data", () => {
    const keyboard = confirmKeyboard("test_id", tr);
    const json = keyboard.toJSON();

    for (const row of json.inline_keyboard) {
      for (const button of row) {
        expect(() => JSON.parse((button as { callback_data: string }).callback_data)).not.toThrow();
      }
    }
  });
});

describe("subscriptionKeyboard", () => {
  // Helper to extract actions from keyboard
  const getActions = (keyboard: ReturnType<typeof subscriptionKeyboard>) => {
    const json = keyboard.toJSON();
    return json.inline_keyboard.flat().map((btn) => {
      const data = JSON.parse((btn as { callback_data: string }).callback_data);
      return { action: data.action, id: data.id };
    });
  };

  test("always has disable action with subscription ID", () => {
    const actions = getActions(subscriptionKeyboard(42, false, false, "advanced", false, tr));
    expect(actions).toContainEqual({ action: "disable", id: 42 });
  });

  test("advanced mode has edit and regenerate actions", () => {
    const actions = getActions(subscriptionKeyboard(42, false, false, "advanced", false, tr));

    expect(actions).toContainEqual({ action: "edit_positive", id: 42 });
    expect(actions).toContainEqual({ action: "edit_negative", id: 42 });
    expect(actions).toContainEqual({ action: "edit_description", id: 42 });
    expect(actions).toContainEqual({ action: "regenerate_sub", id: 42 });
  });

  test("normal mode has no edit actions", () => {
    const actions = getActions(subscriptionKeyboard(42, false, false, "normal", false, tr));

    expect(actions).not.toContainEqual(expect.objectContaining({ action: "edit_positive" }));
    expect(actions).not.toContainEqual(expect.objectContaining({ action: "edit_negative" }));
  });

  test("toggle_negative action appears when has active negative keywords", () => {
    const actions = getActions(subscriptionKeyboard(42, true, false, "advanced", false, tr));
    expect(actions).toContainEqual({ action: "toggle_negative", id: 42 });
  });

  test("toggle_negative action appears when has disabled negative keywords", () => {
    const actions = getActions(subscriptionKeyboard(42, false, true, "advanced", false, tr));
    expect(actions).toContainEqual({ action: "toggle_negative", id: 42 });
  });

  test("toggle_negative action hidden when no negative keywords at all", () => {
    const actions = getActions(subscriptionKeyboard(42, false, false, "advanced", false, tr));
    expect(actions).not.toContainEqual(expect.objectContaining({ action: "toggle_negative" }));
  });
});

describe("backKeyboard", () => {
  test("has back action", () => {
    const keyboard = backKeyboard(tr);
    const json = keyboard.toJSON();

    const allButtons = json.inline_keyboard.flat();
    const actions = allButtons.map((btn) => {
      const data = JSON.parse((btn as { callback_data: string }).callback_data);
      return data.action;
    });

    expect(actions).toContain("back");
  });
});

describe("nextRequestId", () => {
  test("returns incrementing IDs", () => {
    const id1 = nextRequestId();
    const id2 = nextRequestId();
    expect(id2).toBe(id1 + 2); // +2 because we reserve pairs
  });

  test("returns positive integers", () => {
    const id = nextRequestId();
    expect(id).toBeGreaterThan(0);
    expect(Number.isInteger(id)).toBe(true);
  });
});

describe("groupPickerKeyboard", () => {
  test("creates reply keyboard with requestChat buttons", () => {
    const keyboard = groupPickerKeyboard(1, tr);
    const json = keyboard.toJSON();

    expect(json.keyboard).toBeDefined();
    expect(json.one_time_keyboard).toBe(true);
    expect(json.resize_keyboard).toBe(true);
  });

  test("has group and channel selection buttons", () => {
    const keyboard = groupPickerKeyboard(1, tr);
    const json = keyboard.toJSON();

    // First row: group button
    expect(json.keyboard[0]![0]!.text).toBe("Выбрать группу");
    expect(json.keyboard[0]![0]!.request_chat).toBeDefined();
    expect(json.keyboard[0]![0]!.request_chat!.chat_is_channel).toBe(false);

    // Second row: channel button
    expect(json.keyboard[1]![0]!.text).toBe("Выбрать канал");
    expect(json.keyboard[1]![0]!.request_chat).toBeDefined();
    expect(json.keyboard[1]![0]!.request_chat!.chat_is_channel).toBe(true);
  });

  test("has Готово button", () => {
    const keyboard = groupPickerKeyboard(1, tr);
    const json = keyboard.toJSON();

    // Third row: Готово
    expect(json.keyboard[2]![0]!.text).toBe("Готово");
  });

  test("uses provided requestId for group and requestId+1 for channel", () => {
    const requestId = 42;
    const keyboard = groupPickerKeyboard(requestId, tr);
    const json = keyboard.toJSON();

    expect(json.keyboard[0]![0]!.request_chat!.request_id).toBe(requestId);
    expect(json.keyboard[1]![0]!.request_chat!.request_id).toBe(requestId + 1);
  });
});

describe("inviteLinkKeyboard", () => {
  test("creates inline keyboard with skip and cancel buttons", () => {
    const keyboard = inviteLinkKeyboard(tr);
    const json = keyboard.toJSON();

    expect(json.inline_keyboard).toBeDefined();
    expect(json.inline_keyboard.length).toBe(2); // Two rows
  });

  test("has skip_invite_link action", () => {
    const keyboard = inviteLinkKeyboard(tr);
    const json = keyboard.toJSON();

    const skipButton = json.inline_keyboard[0]![0]!;
    expect(skipButton.text).toBe("Пропустить");

    const data = JSON.parse((skipButton as { callback_data: string }).callback_data);
    expect(data.action).toBe("skip_invite_link");
  });

  test("has cancel action", () => {
    const keyboard = inviteLinkKeyboard(tr);
    const json = keyboard.toJSON();

    const cancelButton = json.inline_keyboard[1]![0]!;
    expect(cancelButton.text).toBe("Отмена");

    const data = JSON.parse((cancelButton as { callback_data: string }).callback_data);
    expect(data.action).toBe("cancel");
  });
});

describe("pendingGroupsKeyboard", () => {
  test("creates buttons for each pending group", () => {
    const groups: PendingGroup[] = [
      { id: 1, title: "Group 1", needsInviteLink: false, isChannel: false },
      { id: 2, title: "Channel 1", needsInviteLink: false, isChannel: true },
    ];
    const keyboard = pendingGroupsKeyboard(groups);
    const json = keyboard.toJSON();

    expect(json.inline_keyboard.length).toBe(2);
  });

  test("shows group icon for groups and channel icon for channels", () => {
    const groups: PendingGroup[] = [
      { id: 1, title: "My Group", needsInviteLink: false, isChannel: false },
      { id: 2, title: "My Channel", needsInviteLink: false, isChannel: true },
    ];
    const keyboard = pendingGroupsKeyboard(groups);
    const json = keyboard.toJSON();

    expect(json.inline_keyboard[0]![0]!.text).toContain("👥");
    expect(json.inline_keyboard[0]![0]!.text).toContain("My Group");

    expect(json.inline_keyboard[1]![0]!.text).toContain("📢");
    expect(json.inline_keyboard[1]![0]!.text).toContain("My Channel");
  });

  test("has remove_pending action with group ID", () => {
    const groups: PendingGroup[] = [
      { id: 42, title: "Test Group", needsInviteLink: false, isChannel: false },
    ];
    const keyboard = pendingGroupsKeyboard(groups);
    const json = keyboard.toJSON();

    const data = JSON.parse((json.inline_keyboard[0]![0]! as { callback_data: string }).callback_data);
    expect(data.action).toBe("remove_pending");
    expect(data.id).toBe(42);
  });

  test("handles empty groups list", () => {
    const keyboard = pendingGroupsKeyboard([]);
    const json = keyboard.toJSON();

    expect(json.inline_keyboard.length).toBe(0);
  });

  test("uses group ID as fallback when title is undefined", () => {
    const groups: PendingGroup[] = [
      { id: 123, needsInviteLink: false, isChannel: false },
    ];
    const keyboard = pendingGroupsKeyboard(groups);
    const json = keyboard.toJSON();

    expect(json.inline_keyboard[0]![0]!.text).toContain("123");
  });
});
